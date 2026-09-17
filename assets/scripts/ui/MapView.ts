/**
 * 家庭地图 · 单屏房间 + Spine 猫 + 分区点击。
 *
 * **单屏舞台，不滚动**（2026-09-14 定）。旧版是 2160×3600 的双向滚动大世界，
 * 换掉的原因见 `mapLayout.ts` 头部：概念稿的密度前提是「一屏看到整个房间」，
 * 大世界下一屏只有约 12% 面积，每个分区都孤零零占满整屏。
 *
 * 分工：
 * - `mapLayout.ts` 算布局与配色（一切 y 由可视高度现算，不写死）
 * - `mapRoom.ts` 画环境与装饰（墙、地、楼梯、窗帘、相框、地毯、花盆、气球、木马）
 * - `mapZones.ts` 画可点分区（壁龛 / 拱门 / 帐篷 / 药柜）
 * - 本文件负责组装、Spine 猫、点击命中、HUD 挂载、以及**点宠物互动**
 *
 * **互动改为「点宠物」触发**（2026-09-17）：原来底部有一条内联互动条
 * （`MapActionBar`，四按钮 + 属性条），现已移除。做哪种互动由猫头顶气泡
 * 当前显示的需求决定（饱食低→喂食 / 清洁低→洗澡 / 心情低→陪玩 / 都健康→抚摸），
 * 玩家点一下猫就完成对应功能，见 `interactWithPet` / `currentPetAction`。
 *
 * 层级用容器节点固定：art（Graphics 全部）→ pet（猫）→ label（文字）→ input
 * → hud。顺序即渲染层级，所以文字永远压在图形之上。
 */

import {
  _decorator,
  Component,
  Node,
  Label,
  Color,
  Graphics,
  UITransform,
  UIOpacity,
  view,
  EventTouch,
  resources,
  sp,
  Vec3,
  tween,
  Tween,
} from 'cc';
import {
  COLOR,
  makeNode,
  makeGraphics,
  makeLabel,
  outlineLabel,
  fillRoundRect,
  fillRoundRectRim,
  softShadow,
  floatText,
} from './widgets';
import { MapHud } from './MapHud';
import store from '../core/store';
import { computeLayout, hit, MAP_COLOR, PROPS } from './mapLayout';
import type { StageLayout, Zone } from './mapLayout';
import {
  paintRoom,
  paintStairs,
  paintWallDecor,
  paintFloorDecor,
  paintContactShadows,
  paintPetShadow,
} from './mapRoom';
// 牌面（现在是「留字横带」）画在分区图里，代码只叠文字，
// 所以不再需要 `paintSignPlate` / `signWidth`
import { paintZone, SIGN_H } from './mapZones';
import { placeArt } from './mapArt';
import { PetGrid } from './mapPathfind';
import type { Vec2, ObstacleBox } from './mapPathfind';
import { PROP_MASKS } from './mapPropMasks';
import { paintFish, paintDrop, paintYarn } from './mapIcons';
import { interact } from '../core/actions';
import { showError, toast, gainedText } from './toast';
import * as cooldown from '../core/cooldown';
import type { PetAction } from '../net/types';

const { ccclass } = _decorator;

/** 猫（复用主界面 Spine），皮肤/动画候选与 spine-2d-pet 规则一致 */
const CAT_PATH = 'spine/pet_cat/Cat';
/**
 * 猫的缩放。
 *
 * 素材整只约 106 骨骼单位高，1.6 倍在单屏里约 170px —— 实测占满整个地板、
 * 比旁边的木马大三倍，读成「一只巨猫挤在客厅里」。
 * 概念稿里宠物高度约等于地板高度的三分之一，对应 0.85 倍。
 */
const BASE_SCALE = 0.85;
const DEFAULT_SKIN = '007';
/**
 * 调试网格开关：画出寻路栅格（障碍格红色半透明 / 可走格绿色细线）+ 猫的当前路径。
 * 用来肉眼核对道具占位和猫的行走轨迹。**上线前置 false。**
 */
const DEBUG_GRID = false;
/** 长按宠物多久(秒)进入「拖动宠物」模式 */
const LONG_PRESS_SEC = 0.4;
/** 需求提示阈值：某项健康度低于此才在气泡里提示 */
const NEED_THRESHOLD = 0.5;
/** 多项需求同时偏低时，气泡轮流显示的间隔（秒） */
const NEED_CYCLE_SEC = 2.5;
const IDLE_CANDIDATES = ['idle', 'Idle', 'Sit_Idle', 'Idle3', 'Sleep_A'];
const WALK_CANDIDATES = ['Walk', 'Walk2', 'Walk_2', 'walk'];

/**
 * 互动动作 → 动画候选表，和 `PetStage.ACTION_ANIM` 保持一致。
 *
 * 这里**不做**前摇/后摇串播和刷毛 5 段递进（`PetStage` 那套）——
 * 地图上的猫同时在跑散步 tween，动画链越长越容易和走路打架。
 * 单段 + 接回 idle 已经够给出「点到了」的反馈。
 */
const ACTION_ANIM: Record<string, string[]> = {
  feed: ['Minigame_Treat_Correct', 'Knead', 'Sit_Lick_Hand'],
  bath: ['Minigame_Brush', 'Sit_Lick_Leg'],
  pet: ['Minigame_Belly_Rub', 'Minigame_Neck_Rub', 'Stand_Pat', 'Pers_Cuddly'],
  play: ['Int_Butterfly', 'Standing_Toy', 'A_Play', 'Pers_Playful'],
};

/** 顶部提示文案 */
const HINT_TEXT = '左右拖动查看 · 点招牌进入玩法';

/**
 * 招牌文字的**目标**字号（2026-09-16：19 → 23，放大 1.2 倍）。
 *
 * 只是目标：牌面装不下时 `placeSignOnArt` 会按牌面实测宽度回缩，
 * 所以实际字号可能小于这个值。想让字真的变大，得先把牌面做大 ——
 * 牌面现在只占屏宽 13.9%（竞品 22.8%），瓶颈在图里招牌画得太小。
 */
const SIGN_FONT = 23;
/** 回缩下限：再小就读不清了，宁可让字轻微出牌也不要缩到看不见 */
const SIGN_FONT_MIN = 17;

@ccclass('MapView')
export class MapView extends Component {
  /**
   * 点击某个分区回调（传分区 key），由 Main 注入以打开对应玩法。
   *
   * 曾有一个 `onBack`（回 MainView）。地图是落地界面、没有上一层，
   * 而互动已经内联到底部（`MapActionBar`），所以「返回」按钮和它一起去掉了。
   */
  onOpenZone: ((key: string) => void) | null = null;

  private L: StageLayout | null = null;
  /** 世界根节点，横向拖动就是改它的 x */
  private worldRoot: Node | null = null;
  private spriteLayer: Node | null = null;
  private petLayer: Node | null = null;
  /** 招牌层（牌面 + 文字），**常驻**，不随兜底层隐藏 */
  private signLayer: Node | null = null;
  private signHosts: Record<string, Node> = {};
  /** 代码兜底层，真图全部到齐后隐掉 */
  private fallbackNode: Node | null = null;
  private artTotal = 0;
  private artDone = 0;
  private artOk = 0;
  private hud: MapHud | null = null;
  private disposed = false;

  // 宠物头顶气泡与脚下状态条（跟随宠物 x，但不受其缩放/翻转影响）
  private bubbleNode: Node | null = null;
  /** 气泡里的图标层（每次刷新按最紧缺的需求重画） */
  private bubbleIconHost: Node | null = null;
  /** 上一次画的需求 key，没变就不重画气泡图标 */
  private bubbleNeed = '';
  /** 当前低于阈值（<50%）的需求，缺得越多排越前；多个时在 update() 里轮流显示 */
  private lowNeeds: string[] = [];
  /** 轮流显示的当前下标 */
  private needCycleIdx = 0;
  /** 轮流显示的计时器（秒） */
  private needCycleTimer = 0;
  private statusBarHost: Node | null = null;
  /** 猫脚下的接地阴影，跟随宠物 x */
  private petShadow: Node | null = null;
  /** 顶部提示文案，撞边界时临时替换 */
  private hintLabel: Label | null = null;
  private lastEdgeAt = 0;
  /** 上一次画的状态签名，变了才重画 */
  private lastPetSig = '';

  // 猫
  private catNode: Node | null = null;
  private catSkel: sp.Skeleton | null = null;
  private catIdle = '';
  private catWalk = '';
  /** 骨架里所有动画名。`reactCat` 按互动动作挑动画时查它（写死名字会静默不播） */
  private catAnims: string[] = [];
  /** 点宠物互动的进行中标志（按 action key），防连点重复发请求 */
  private actionBusy: Record<string, boolean> = {};
  /** 满地板寻路栅格（标了立体家具障碍，猫按它绕行） */
  private petGrid: PetGrid | null = null;
  /**
   * 立体家具的实际渲染节点，寻路障碍从它们的真实边界推导（不靠布局表重算）。
   * `solid`=true 的是实心落地结构（护理室店面/楼梯），挡住大部分高度；
   * 其余细高家具只挡底座。
   */
  private obstacleNodes: Array<{ node: Node; art: string }> = [];
  /** 防抖：道具是并发加载的，收齐一批再重建一次栅格 */
  private gridRebuildScheduled = false;
  /** 长按拖动宠物状态 */
  private draggingPet = false;
  private longPressTimer = 0;
  private longPressArmed = false;
  /** 调试网格叠加层（画栅格 + 障碍格 + 猫当前路径），随地图一起拖动 */
  private debugLayer: Node | null = null;
  private debugPathG: Graphics | null = null;

  onLoad() {
    const L = computeLayout();
    this.L = L;

    // 世界根节点：**所有会跟着拖动的内容都挂在它下面**。
    // HUD / 提示 / 返回按钮挂在 this.node 上，才不会跟着滚走。
    const world = makeNode('WorldRoot', this.node, L.worldW, L.vh);
    this.worldRoot = world;

    const artLayer = makeNode('ArtLayer', world);
    // 接地阴影层：**必须在 SpriteLayer 之前**，否则阴影会盖在家具上面
    const shadowLayer = makeNode('ShadowLayer', world);
    paintContactShadows(makeGraphics('shadows', shadowLayer), L);
    // 贴图层在 Graphics 之上、宠物之下：图盖住代码绘制的结构，但不能盖住猫
    this.spriteLayer = makeNode('SpriteLayer', world);
    this.petLayer = makeNode('PetLayer', world);
    // 招牌在猫之上：猫会走到壁龛前面，但招牌钉在墙上、应当始终可读
    this.signLayer = makeNode('SignLayer', world);

    // 兜底轮廓和真图分成两个 Graphics：真图全部到货后把兜底那层隐掉。
    // 不隐的话两层会叠出双描边（截图里洗浴间的褐色拱框就是露在图外面的兜底），
    // 而它本身是**加载失败时的唯一画面**，所以不能不画、只能事后隐。
    this.paintStage(artLayer, L);
    // 招牌要在 loadArt 之前建好：图的回调里会调 placeSign 调整它的位置
    this.buildSigns(L);
    this.loadArt(L);
    this.buildCat(L);
    this.setupInput(L);
    this.buildHint(L);
    this.buildHud();

    // 初始位置**不要贴在边界上**：贴边的话往那个方向拖完全没反应，
    // 玩家第一感受就是「地图坏了」（旧的滚动版踩过这个坑）。
    // 偏左一点起步 → 左右都能立刻拖动，且默认露出护理室那一侧。
    world.setPosition(L.maxX * 0.45, 0, 0);
  }

  onDestroy() {
    this.disposed = true;
    if (this.catNode) Tween.stopAllByTarget(this.catNode);
  }

  /**
   * 画整个舞台。**一个 Graphics 画完所有色块**，保证合批（规则要求整屏 DrawCall ≤ 50）。
   * 调用顺序即叠放顺序，装饰必须在房间之后、分区之前。
   */
  private paintStage(parent: Node, L: StageLayout) {
    // 房间本体（墙/地/墙裙）永远显示 —— 它没有对应的贴图，不是兜底。
    //
    // ⚠️ 打底色必须按**世界宽 worldW** 铺，不是屏幕宽 vw。
    // 这个 Graphics 挂在 worldRoot 下、会跟着地图横向拖动；只铺一屏宽(vw)的话，
    // 拖到最左/最右时它的边缘离开屏幕对侧，露出后面的空白（相机清屏的深色）——
    // 就是「拖到边角落有褐色缺口」。墙/地板本来就按 worldW 铺，这里对齐即可。
    // 横向留一点余量(+TILE*2)，纵向从屏幕底一直铺到顶，彻底不漏边。
    const room = makeGraphics('Room', parent);
    const bgW = L.worldW + 120;
    fillRoundRect(room, -bgW / 2, -L.vh / 2, bgW, L.vh, 0, COLOR.bg);
    paintRoom(room, L);

    // 有贴图对应的那部分单独一层，图到齐后整层隐掉（见 onArtDone）
    const fb = makeGraphics('Fallback', parent);
    this.fallbackNode = fb.node;
    paintStairs(fb, L.stair);
    paintWallDecor(fb, L);
    paintFloorDecor(fb, L);
    L.zones.forEach((z) => paintZone(fb, z));
  }

  /**
   * 每张图到货时调一次；全部到齐才隐掉兜底层。
   *
   * 用计数而不是「第一张到货就隐」：图是并发加载的，先到的那张隐掉兜底后，
   * 还没到的那几处会变成空白，比双描边更糟。
   */
  private onArtDone(ok: boolean) {
    this.artDone++;
    if (ok) this.artOk++;
    if (this.artDone < this.artTotal) return;
    // 只有**全部成功**才隐兜底。有任何一张失败就保留整层 ——
    // 少数几处的双描边可以接受，空白不行。
    if (this.artOk === this.artTotal && this.fallbackNode && this.fallbackNode.isValid) {
      this.fallbackNode.active = false;
    }
  }

  /**
   * 真实美术图。全部盖在代码绘制之上，**加载失败时下面那层仍然出画面**。
   *
   * 分区图给的目标框要**扣掉招牌高度**：招牌和文字始终由代码画（图里的字号
   * 我们控制不了），图只负责招牌以下的门面部分。
   */
  private loadArt(L: StageLayout) {
    const layer = this.spriteLayer;
    if (!layer) return;

    const zoneArts = L.zones.filter((z) => !!z.art);
    // 先把总数算全再发起加载：分母不对的话最后一张到货时 done < total，
    // 兜底层就永远隐不掉
    this.artTotal = zoneArts.length + PROPS.length + 1; // +1 = 楼梯

    zoneArts.forEach((z) => {
      // **不再扣 SIGN_H**：招牌已经画进图里了，图的高度就是「门面 + 招牌」的整体。
      // 扣掉的话图会被压扁、招牌那部分挤在顶上。
      placeArt(layer, `map/alcoves/${z.art}`, {
        w: z.w, h: z.h, x: z.cx, y: z.cy - z.h / 2, anchor: 'bottom',
      }, (n) => {
        // 文字要落到图上那块空白牌面的中心，所以必须等图到货、
        // 知道它的实际渲染尺寸之后才能定位
        if (n && n.isValid) this.placeSignOnArt(z, n);
        // 护理室店面是落地大件（key='care'），也要当障碍 —— 用它的实际节点边界
        if (n && n.isValid && z.key === 'care' && z.art) {
          this.obstacleNodes.push({ node: n, art: z.art });
          this.rebuildGridSoon();
        }
        this.onArtDone(!!n);
      });
    });

    this.loadProps(L);
  }

  /**
   * 环境道具，按 `PROPS` 表落位。
   *
   * 用表驱动而不是一句句写：道具会不断增删（这是让房间「像有人住」的主要手段），
   * 散着写迟早有两个道具叠在同一处而没人发现。加道具只改 `mapLayout.PROPS`。
   *
   * 楼梯单独处理 —— 它的位置由 `L.stair` 给（要和代码绘制的楼梯对齐），
   * 不是自由摆放的装饰。
   */
  private loadProps(L: StageLayout) {
    const layer = this.spriteLayer;
    if (!layer) return;

    const floorH = L.wallBottom - L.bottom;

    PROPS.forEach((p) => {
      // rx 是**世界**比例，不是视口比例 —— 用 vw 会让右半边的道具全挤到中间
      const x = -L.worldW / 2 + L.worldW * p.rx;
      // 墙上挂件以 **wallBottom** 为基准、跨整个墙高。
      // 挂件和分区是**横向错开**的（不再叠在分区上方），所以可以共用墙高；
      // 避免重叠靠 rx 排在分区之间的缝隙里，由 check-overlap.mjs 校验。
      const base = p.on === 'wall' ? L.wallBottom : L.bottom;
      const span = p.on === 'wall' ? L.top - L.wallBottom : floorH;
      const y = base + span * p.ry;
      // `art` 省略时等于 key —— 通用道具（绿植/坐垫）一图多用，不必重复出图
      placeArt(layer, `map/props/prop_${p.art || p.key}`, {
        w: p.w, h: p.h, x, y, anchor: p.anchor || 'center',
      }, (n) => {
        // 立体家具（非 flat 的地面道具）→ 收集它的**实际渲染节点**，
        // 稍后用真实边界重建寻路障碍（不靠布局表的目标框重算，避免和缩放后
        // 的实际尺寸对不上 —— 那正是「护理室上面两行标错」的根因）。
        if (n && n.isValid && p.on === 'floor' && !p.flat) {
          this.obstacleNodes.push({ node: n, art: `prop_${p.art || p.key}` });
          this.rebuildGridSoon();
        }
        this.onArtDone(!!n);
      });
    });

    // 不再乘 1.15/1.1：`L.stair` 现在已按图的实际长宽比算好，
    // 再放大会让楼梯溢出到楼层之外
    placeArt(layer, 'map/props/prop_stairs', {
      w: L.stair.w, h: L.stair.h, x: L.stair.cx,
      y: L.stair.cy - L.stair.h / 2, anchor: 'bottom',
    }, (n) => {
      // 楼梯是落地大件 → 障碍，用实际节点边界
      // 楼梯也走统一的「按图 alpha 遮罩」路线（prop_stairs 的遮罩就是斜楼梯形状）
      if (n && n.isValid) {
        this.obstacleNodes.push({ node: n, art: 'prop_stairs' });
        this.rebuildGridSoon();
      }
      this.onArtDone(!!n);
    });
  }

  // ---- 文字：分区名 + 副标题 ----

  /**
   * 分区招牌的**文字**。牌面本身已经画进分区图里了，这里只叠字。
   *
   * 改成这样的原因：代码画的牌面是同一块棕木牌，压在浴室(蓝瓷砖)、
   * 花园(绿藤)、育婴室(粉帐篷)三个完全不同的门面上 ——
   * 那个棕色是整屏最深最突兀的一块，读成「一大块棕色直接贴上去」。
   * 竞品每块牌子的材质都随门面（且藤蔓和牌子有互相遮挡、两块牌面取色不同，
   * 说明是画进图里的），所以我们也把牌子交给美术图，代码只管文字。
   *
   * 位置由图上量出来的 `z.plate` 决定（见 `mapLayout.Zone.plate`），
   * 图到货后在 `placeSignOnArt` 里按图的实际渲染尺寸换算。
   * 图没到货时先按分区顶边放一个兜底位置 —— 不放的话文字会堆在原点。
   */
  private buildSigns(L: StageLayout) {
    const parent = this.signLayer;
    if (!parent) return;

    L.zones.forEach((z) => {
      const host = makeNode(`Sign_${z.key}`, parent, 60, SIGN_H);
      // 兜底位置：图没到货时按分区顶边放。
      // clamp 到 HUD 下缘之下 —— 壁龛高度反复调过（110→174→268→201），
      // `z.cy + z.h/2` 一度算到 y=406 而屏幕顶只有 423。
      const signY = Math.min(z.cy + z.h / 2 - SIGN_H / 2, L.top - SIGN_H / 2 - 6);
      host.setPosition(z.cx, signY, 0);
      this.signHosts[z.key] = host;

      // 只有文字，没有 Graphics 牌面 —— 牌子在图里。
      //
      // **描边宽度 1，不能再大。** 描边宽 3 时相邻笔画的描边会糊在一起，
      // 把字与字之间的牌面全填满 —— 实测整条扫描线上最亮只出现一次 249、
      // 其余全在 102~168，读成「一片棕色背影」（用户原话）。
      // 竞品的同一条线上 240/237/224 反复出现，说明笔画之间是干净的牌面色。
      //
      // ⚠️ 这是「按指标调参」的反面教材：宽度从 2 加到 3 时
      // 「过渡像素占比」从 29.2% 涨到 56.4%，看着像改好了，
      // 涨的其实是糊成一片的棕色。**指标涨了不等于画面对了，必须回头看图。**
      //
      // 现在字体本身是圆体 Bold、笔画已经有肉，描边只需要一点点用来
      // 压住牌面的浅色、避免字发飘，不再承担「加重」的任务。
      // **白字 + 深棕描边**，对齐竞品实测（量法见 `MAP_COLOR.signInk`）。
      // 横带底色各不相同（粉布 217 / 绿藤 219 / 木色 190），
      // 白字配深描边在这三种底上都成立。
      // 描边只给 1：宽了会让相邻笔画糊成一片，读成「一坨棕色」（踩过）。
      const name = makeLabel(z.name, host, {
        size: SIGN_FONT, color: MAP_COLOR.signInk, align: 'center', bold: true,
      });
      name.node.setPosition(0, 0);
      outlineLabel(name, MAP_COLOR.signText, 1);

      // 副标题挂在分区下沿外侧，不进招牌节点（它不跟着招牌移动）。
      // 它压在**地板**上（分区下沿已越界到地板），所以也要描边，
      // 否则浅色小字落在浅色地板上几乎读不出来。
      const sub = makeLabel(z.sub, parent, { size: 12, color: COLOR.text, align: 'center' });
      sub.node.setPosition(z.cx, z.cy - z.h / 2 - 12);
      // 12 号字更小、笔画更密，描边只能给 1 —— 给 2 会整块糊成一坨
      outlineLabel(sub, MAP_COLOR.subOutline, 1);
    });
  }

  /**
   * 图到货后把文字落到**图上那块空白牌面**的中心。
   *
   * 换算用图的**实际渲染尺寸**（`placeArt` 等比缩放过，通常小于分区框），
   * 不能用 `z.w`/`z.h` —— 那是目标框，图往往比它小，用它算会偏。
   *
   * `plate.cy` 是从图**顶部**往下的比例，而节点坐标是中心原点、y 向上，
   * 所以要 `artTop - artH * cy`。这个方向很容易写反，写反的表现是
   * 文字跑到图的下半部分（压在浴缸/草地上）。
   */
  private placeSignOnArt(z: Zone, artNode: Node) {
    const host = this.signHosts[z.key];
    if (!host || !host.isValid || !this.L) return;
    const tr = artNode.getComponent(UITransform);
    if (!tr) return;

    const artW = tr.width;
    const artH = tr.height;
    const artTop = artNode.position.y + artH / 2;

    // 没量过牌面的分区退回「贴图顶边」的老行为，保证仍有画面
    const p = z.plate;
    if (!p) {
      const y = Math.min(artTop - SIGN_H / 2 + 6, this.L.top - SIGN_H / 2 - 6);
      host.setPosition(host.position.x, y, 0);
      return;
    }

    const x = artNode.position.x + (p.cx - 0.5) * artW;
    const y = artTop - artH * p.cy;
    host.setPosition(x, y, 0);

    // 字号按牌面实测宽度定。牌面宽度是画死的（图里那块奶白区），
    // 三字名（洗浴间）和四字名（宠物花园）需要的宽度差三分之一，
    // 而四张图的牌面宽占比也不同（0.325~0.560），所以必须逐个算。
    //
    // **下限 17 而不是 13**：缩到 13 号在手机上根本读不清，
    // 那时宁可让字轻微出牌 —— 招牌的作用是让玩家认出入口，可读性优先。
    const label = host.getComponentInChildren(Label);
    if (label) {
      // 留 4% 边距即可（原来 8%）。牌面本来就小，边距吃掉的是字的空间；
      // 竞品的字左右几乎顶到牌边。
      const avail = artW * p.w * 0.96;
      const fit = Math.floor(avail / z.name.length);
      // 不超过目标字号、不低于下限
      label.fontSize = Math.max(SIGN_FONT_MIN, Math.min(SIGN_FONT, fit));
      label.lineHeight = label.fontSize + 4;
    }
  }

  // ---- Spine 猫 ----

  /**
   * 大厅的猫。挂载兜底和 PetStage 完全一样（空 default 皮肤 → setSkin、
   * premultipliedAlpha = false、动画名取候选表、朝向翻 scale.x）——
   * 规则 `spine-2d-pet` 明确写了别因为「只是背景里走两步」就省掉，
   * 省掉的结果是整只不可见或一片白框。
   */
  private buildCat(L: StageLayout) {
    if (!this.petLayer || !this.spineReady()) return;

    const petNode = makeNode('MapPet', this.petLayer);
    this.catNode = petNode;
    // 满地板寻路栅格。障碍从道具**实际渲染节点**的边界推导（见 rebuildGrid），
    // 此刻道具可能还没加载完，先建一个无障碍的栅格让猫能动，加载完再 rebuild。
    this.petGrid = new PetGrid(L, this.collectObstacleBoxes());
    if (DEBUG_GRID) this.buildDebugGrid();
    const spawn = this.petGrid.randomFreePoint() || { x: 0, y: L.petY };
    petNode.setPosition(spawn.x, spawn.y, 0);

    resources.load(CAT_PATH, sp.SkeletonData, (err, data) => {
      if (this.disposed || !petNode.isValid) return;
      if (err || !data) {
        console.warn('[MapView] Spine 猫加载失败，地图内先无猫', err);
        return;
      }
      const skel = petNode.addComponent(sp.Skeleton);
      skel.skeletonData = data;
      skel.premultipliedAlpha = false; // 59 猫包是直通道 PNG，预乘会出白框
      this.catSkel = skel;

      const runtime = data.getRuntimeData && data.getRuntimeData();
      const anims = runtime && runtime.animations ? runtime.animations.map((a) => a.name) : [];
      const skins = runtime && runtime.skins ? runtime.skins.map((s) => s.name) : [];
      this.catAnims = anims;
      this.catIdle = IDLE_CANDIDATES.find((n) => anims.indexOf(n) >= 0) || '';
      this.catWalk = WALK_CANDIDATES.find((n) => anims.indexOf(n) >= 0) || '';

      // 空 default 皮肤兜底：选 007，没有就取第一个编号皮肤
      const numeric = skins.filter((n) => /^\d+$/.test(n));
      const skin = skins.indexOf(DEFAULT_SKIN) >= 0 ? DEFAULT_SKIN : numeric[0] || '';
      if (skin) skel.setSkin(skin);

      petNode.setScale(BASE_SCALE, BASE_SCALE, 1);
      if (this.catIdle) skel.setAnimation(0, this.catIdle, true);

      this.buildPetOverlay(petNode);
      if (this.catWalk) this.catStep();
    });
  }

  private spineReady(): boolean {
    return !!(
      sp &&
      (sp as unknown as { Skeleton?: unknown }).Skeleton &&
      (sp as unknown as { SkeletonData?: unknown }).SkeletonData
    );
  }

  /**
   * 宠物头顶的需求气泡 + 脚下的状态条（概念稿中间那只猫的两个附件）。
   *
   * 挂在**宠物节点的父层**而不是宠物节点自己：宠物节点会被 setScale(±1.6) 翻转，
   * 挂在它下面的话气泡会跟着缩放、走右边时文字还会镜像反转。
   */
  private buildPetOverlay(petNode: Node) {
    const parent = petNode.parent;
    if (!parent) return;

    const bw = 56;
    const bh = 40;
    const bubble = makeNode('PetBubble', parent, bw, bh);
    const bg = makeGraphics('bg', bubble);
    softShadow(bg, -bw / 2, -bh / 2, bw, bh, 15, 4);
    fillRoundRectRim(bg, -bw / 2, -bh / 2, bw, bh, 15, MAP_COLOR.bubble, 2, MAP_COLOR.line);
    // 尖角：一个小圆当指向宠物的引线（Graphics 没有三角）
    bg.fillColor = MAP_COLOR.bubble;
    bg.circle(0, -bh / 2 - 4, 6);
    bg.fill();

    // 气泡里画**矢量图标**（鱼 / 水滴 / 毛线球），不是 emoji 字符。
    // 旧版塞 `🐟💧🎾`：界面用的是子集化字体，emoji 不在子集里 → 渲染成空白、
    // 且不报错（规则 `ui-font-subset`「新字变空白/方框」）。即便用系统字体，
    // emoji 字形也由系统决定，安卓低端机整个缺字（规则 `map-scroll-view`：图标别用 emoji）。
    this.bubbleIconHost = makeNode('icon', bubble, 24, 24);
    this.bubbleIconHost.setPosition(0, 2);
    // 轮播切换时靠这个组件做淡入淡出（改 opacity，不动节点树）
    this.bubbleIconHost.addComponent(UIOpacity);
    this.bubbleNode = bubble;

    this.statusBarHost = new Node('PetStatus');
    this.statusBarHost.parent = parent;

    // 猫脚下的接地阴影。**要挂在宠物之前的兄弟位置**才会画在它下面，
    // 所以用 setSiblingIndex 塞到宠物节点前面 —— 兄弟次序即渲染层级。
    const shadow = makeNode('PetShadow', parent);
    paintPetShadow(makeGraphics('g', shadow), 62);
    shadow.setSiblingIndex(petNode.getSiblingIndex());
    this.petShadow = shadow;

    // **建完立刻刷一次**，不依赖 update 的 sig 时序（规则 `ui-runtime-verification`
    // 「首刷不能只靠签名变化」）：如果宠物数据在建气泡时就已到位，首帧 sig 直接等于
    // 最终值、被当成 lastPetSig 存下，`sig === lastPetSig` 命中、refreshPetOverlay
    // 再也不跑 → 气泡图标一直没画（实测 need='' iconKids=0，手动调 refresh 才出）。
    this.refreshPetOverlay();
  }

  /**
   * 满地板 2D 游走：随机选一个空位 → A* 找一条绕开家具的路 → 沿路点逐段走 →
   * 到了停下 idle 一会儿 → 再走。看起来像活的、懂得避障。
   *
   * 逐段走用 `tween` 串联：每段单独设时长（按段长），并在每段起点按走向翻朝向
   * （Walk 素材默认朝左，往右走翻 scale.x）。整条路径播放期间保持 Walk 动画，
   * 全部走完才接回 idle。
   */
  private catStep() {
    if (this.disposed || !this.catNode || !this.L || !this.petGrid) return;
    // 正在被玩家拖动时不自己走（否则和手指打架）；松手后 endDragPet 会重启散步
    if (this.draggingPet) return;

    const pet = this.catNode;
    const from: Vec2 = { x: pet.position.x, y: pet.position.y };
    const dest = this.petGrid.randomFreePoint();
    if (!dest) { this.scheduleOnce(() => this.catStep(), 1.5); return; }

    const path = this.petGrid.findPath(from, dest);
    if (!path.length) { this.scheduleOnce(() => this.catStep(), 1 + Math.random()); return; }

    if (DEBUG_GRID) this.drawDebugPath(from, path);
    if (this.catSkel && this.catWalk) this.catSkel.setAnimation(0, this.catWalk, true);

    const s = BASE_SCALE;
    const SPEED = 70; // px/s，和旧版一致
    let t = tween(pet);
    // 逐段：时长和朝向都从**连续路点**算（不能读运行时 position，
    // 因为 tween 链是同步搭好的、那时 position 还没动，读到的全是起点）。
    let prev = from;
    for (const wp of path) {
      const dx = wp.x - prev.x;
      const dist = Math.hypot(wp.x - prev.x, wp.y - prev.y);
      const dur = Math.max(0.2, dist / SPEED);
      const flipRight = dx > 0.5;
      const flipLeft = dx < -0.5;
      t = t
        .call(() => {
          // Walk 默认朝左；往右走翻正。几乎纯竖直移动(dx≈0)时保持上一朝向。
          if (flipRight) pet.setScale(-s, s, 1);
          else if (flipLeft) pet.setScale(s, s, 1);
        })
        .to(dur, { position: new Vec3(wp.x, wp.y, 0) }, { easing: 'linear' });
      prev = wp;
    }
    t.call(() => {
      if (this.catSkel && this.catIdle) this.catSkel.setAnimation(0, this.catIdle, true);
    })
      .delay(1 + Math.random() * 2)
      .call(() => this.catStep())
      .start();
  }

  // ---- 调试网格 ----

  /**
   * 画寻路栅格叠加：障碍格填红色半透明、可走格描绿色细线，方便肉眼核对
   * 道具占位（障碍是家具包围盒按猫半径膨胀后的格子）。挂在 worldRoot 下、
   * 随地图一起拖动，画在宠物层之前（不挡猫）。DEBUG_GRID=false 时不建。
   */
  private buildDebugGrid() {
    if (!this.petGrid || !this.worldRoot) return;
    const layer = makeNode('DebugGrid', this.worldRoot);
    // 排在宠物层之前，别盖住猫
    if (this.petLayer) layer.setSiblingIndex(this.petLayer.getSiblingIndex());
    this.debugLayer = layer;

    const g = makeGraphics('grid', layer);
    const { cell, cols, rows } = this.petGrid.debugInfo;
    // 数字标签单独挂一个子节点层，压在方格之上
    const numHost = makeNode('gridNums', layer);
    this.petGrid.forEachCell((c, r, blocked, center) => {
      const x = center.x - cell / 2;
      const y = center.y - cell / 2;
      if (blocked) {
        // 障碍格：红色半透明填充
        g.fillColor = new Color(220, 90, 80, 90);
        g.rect(x + 1, y + 1, cell - 2, cell - 2);
        g.fill();
      } else {
        // 可行走格：蓝色半透明方格填充（用户要求）
        g.fillColor = new Color(80, 150, 230, 80);
        g.rect(x + 1, y + 1, cell - 2, cell - 2);
        g.fill();
      }
      // 编号：从**左到右、上到下**、从 1 递增。
      // 栅格 r=0 在底部，所以顶行是 r=rows-1 → 顶左编号 1。
      const num = (rows - 1 - r) * cols + c + 1;
      const lbl = makeLabel(String(num), numHost, {
        size: 9, color: COLOR.text, align: 'center',
      });
      lbl.node.setPosition(center.x, center.y, 0);
    });

    // 路径单独一层，每次走新路重画
    const pg = makeGraphics('path', layer);
    this.debugPathG = pg;
  }

  /** 画猫这一趟的路径折线（起点 + 各路点），红点标目标 */
  private drawDebugPath(from: Vec2, path: Vec2[]) {
    const g = this.debugPathG;
    if (!g || !g.isValid) return;
    g.clear();
    // 路径用橙色，和蓝色可走格区分开
    g.lineWidth = 3;
    g.strokeColor = new Color(240, 140, 40, 240);
    g.moveTo(from.x, from.y);
    for (const wp of path) g.lineTo(wp.x, wp.y);
    g.stroke();
    // 目标点画个小圆
    const end = path[path.length - 1];
    g.fillColor = new Color(240, 140, 40, 240);
    g.circle(end.x, end.y, 5);
    g.fill();
  }

  // ---- 障碍：从道具实际渲染边界推导 ----

  /**
   * 从已收集的道具节点读**真实渲染边界** → 障碍框（世界坐标）。
   * 这些节点都挂在 worldRoot 下（和寻路同一空间），position 就是世界坐标，
   * UITransform 的 width/height 是 placeArt 缩放后的**实际尺寸**，所以障碍
   * 和画面永远对得上 —— 以后用户自行放的道具也自动生成正确障碍，零手调。
   */
  private collectObstacleBoxes(): ObstacleBox[] {
    const boxes: ObstacleBox[] = [];
    for (const o of this.obstacleNodes) {
      const n = o.node;
      if (!n || !n.isValid) continue;
      const tr = n.getComponent(UITransform);
      if (!tr) continue;
      boxes.push({
        cx: n.position.x, cy: n.position.y, hw: tr.width / 2, hh: tr.height / 2,
        // 按图的 alpha 遮罩标障碍的**整体真实形状**（用户要求「按整体」）。
        // 遮罩由构建期脚本从 PNG 自动生成（PROP_MASKS），运营加新图重跑即可、零手配。
        mask: this.maskFor(o.art),
      });
    }
    return boxes;
  }

  /** 由道具图名取 alpha 遮罩，返回 (u,v)→是否实体 的采样函数；无遮罩返回 undefined（退回矩形底座） */
  private maskFor(art: string): ((u: number, v: number) => boolean) | undefined {
    const m = PROP_MASKS[art];
    if (!m) return undefined;
    const cols = m.cols;
    const rows = m.rows;
    const nrows = rows.length;
    return (u: number, v: number) => {
      // u,v ∈ [0,1]，v 自上而下（rows[0] 是图最上一行）
      const c = Math.max(0, Math.min(cols - 1, Math.floor(u * cols)));
      const r = Math.max(0, Math.min(nrows - 1, Math.floor(v * nrows)));
      return rows[r].charCodeAt(c) === 49; // '1'
    };
  }

  /** 防抖重建栅格：道具并发加载，收到一批回调只在下一帧重建一次 */
  private rebuildGridSoon() {
    if (this.gridRebuildScheduled) return;
    this.gridRebuildScheduled = true;
    this.scheduleOnce(() => {
      this.gridRebuildScheduled = false;
      this.rebuildGrid();
    }, 0);
  }

  /** 用当前障碍框重建寻路栅格，并刷新调试网格 */
  private rebuildGrid() {
    if (this.disposed || !this.L) return;
    this.petGrid = new PetGrid(this.L, this.collectObstacleBoxes());
    if (DEBUG_GRID) {
      if (this.debugLayer && this.debugLayer.isValid) this.debugLayer.destroy();
      this.debugLayer = null;
      this.debugPathG = null;
      this.buildDebugGrid();
    }
  }

  // ---- 每帧：气泡/状态条跟随宠物 ----

  /**
   * 只跟 x 与固定的垂直偏移，**不读宠物的 scale** ——
   * 宠物靠翻 scale.x 换向，跟着它算会让气泡在转身时左右横跳。
   */
  update(dt: number) {
    const pet = this.catNode;
    if (!pet || !pet.isValid || !this.L) return;

    // 长按待命中：累计按住时长，到点进入拖动宠物模式
    if (this.longPressArmed && !this.draggingPet) {
      this.longPressTimer += dt;
      if (this.longPressTimer >= LONG_PRESS_SEC) this.beginDragPet();
    }

    // 猫现在满地板 2D 游走，y 会变 —— 气泡/状态条/阴影要跟**当前 x 和 y**，
    // 不能再用固定的 L.petY（否则猫走到后排时这些附件还留在原来那条线上）。
    // 偏移跟着 BASE_SCALE 走：猫从 1.6 缩到 0.85 后，原来 +108 的气泡会飘太高。
    const x = pet.position.x;
    const y = pet.position.y;
    if (this.bubbleNode && this.bubbleNode.isValid) {
      this.bubbleNode.setPosition(x, y + 106 * BASE_SCALE, 0);
    }
    if (this.statusBarHost && this.statusBarHost.isValid) {
      this.statusBarHost.setPosition(x, y - 10, 0);
    }
    if (this.petShadow && this.petShadow.isValid) {
      this.petShadow.setPosition(x, y + 3, 0);
    }

    const sig = this.buildPetSig();
    if (sig !== this.lastPetSig) {
      this.lastPetSig = sig;
      this.refreshPetOverlay();
    }

    // 多项需求同时偏低时轮流显示：计时到点就切下一项、淡出旧图标再淡入新的。
    // 只有一项（或没有）时不用切，计时器保持归零。
    if (this.lowNeeds.length > 1) {
      this.needCycleTimer += dt;
      if (this.needCycleTimer >= NEED_CYCLE_SEC) {
        this.needCycleTimer = 0;
        this.needCycleIdx = (this.needCycleIdx + 1) % this.lowNeeds.length;
        this.fadeToNeed(this.lowNeeds[this.needCycleIdx]);
      }
    }
  }

  /** 轮播切换：淡出当前图标 → 换成新需求 → 淡入 */
  private fadeToNeed(need: string) {
    const host = this.bubbleIconHost;
    if (!host || !host.isValid) return;
    const op = host.getComponent(UIOpacity);
    if (!op) {
      this.showBubbleNeed(need);
      return;
    }
    Tween.stopAllByTarget(op);
    tween(op)
      .to(0.18, { opacity: 0 })
      .call(() => this.showBubbleNeed(need))
      .to(0.18, { opacity: 255 })
      .start();
  }

  /** 只把「看得出来的变化」编进签名：四项属性各取整 */
  private buildPetSig(): string {
    const p = store.petView;
    if (!p) return 'none';
    return [
      Math.round(p.hunger),
      Math.round(p.cleanliness),
      Math.round(p.mood),
      Math.round(p.stamina / 5),
    ].join(',');
  }

  /**
   * 刷新气泡内容与状态条。
   *
   * 气泡显示**所有低于阈值（<50%）的需求**：只有一项就固定显示它；
   * 多项同时偏低时，把它们收进 `lowNeeds`，由 update() 每 NEED_CYCLE_SEC 轮流切一个。
   * 三项都健康时把气泡隐掉 —— 挂一个空白气泡比没有气泡更让人困惑。
   */
  private refreshPetOverlay() {
    const p = store.petView;
    const bubble = this.bubbleNode;
    const host = this.statusBarHost;

    if (!p) {
      if (bubble && bubble.isValid) bubble.active = false;
      this.lowNeeds = [];
      return;
    }

    // need 决定画哪个图标；ratio 是该项的健康度（越低越紧缺）
    const needs = [
      { need: 'hunger', ratio: p.hunger / 100 },
      { need: 'clean', ratio: p.cleanliness / 100 },
      { need: 'play', ratio: p.mood / 100 },
    ];
    // 缺得越多排越前 → 轮流显示时从最紧缺的开始
    needs.sort((a, b) => a.ratio - b.ratio);
    const worst = needs[0];

    // 低于阈值的都收进来；用于气泡的轮流显示
    const low = needs.filter((n) => n.ratio < NEED_THRESHOLD).map((n) => n.need);
    // 集合变了才重置轮播下标与计时，避免每次刷新都跳回第一项
    if (low.join(',') !== this.lowNeeds.join(',')) {
      this.lowNeeds = low;
      this.needCycleIdx = 0;
      this.needCycleTimer = 0;
      // 可能有一次轮播淡出没走完就换了集合，把图标透明度收回来
      const op = this.bubbleIconHost?.getComponent(UIOpacity);
      if (op) {
        Tween.stopAllByTarget(op);
        op.opacity = 255;
      }
    }

    if (bubble && bubble.isValid) {
      const show = this.lowNeeds.length > 0;
      bubble.active = show;
      if (show) {
        // 从当前下标取要显示的需求（可能是轮播到的某一项）
        const cur = this.lowNeeds[Math.min(this.needCycleIdx, this.lowNeeds.length - 1)];
        this.showBubbleNeed(cur);
      } else {
        this.bubbleNeed = '';
      }
    }

    if (host && host.isValid) {
      host.removeAllChildren();
      const w = 76;
      const h = 9;
      const g = makeGraphics('g', host);
      fillRoundRect(g, -w / 2, -h / 2, w, h, h / 2, MAP_COLOR.skirt);
      const r = Math.max(0, Math.min(1, worst.ratio));
      if (r > 0) {
        fillRoundRect(g, -w / 2, -h / 2, w * r, h, h / 2, r <= 0.2 ? COLOR.danger : COLOR.accent);
      }
    }
  }

  /**
   * 显示指定需求的气泡图标。
   *
   * 需求项变化、**或图标层还是空的**时才重画（加「图标层为空」是保险：
   * 万一首刷时序错开、图标没画上，下一次会补画，而不是因为 `bubbleNeed`
   * 已被设值就永远跳过）。
   */
  private showBubbleNeed(need: string) {
    const iconHost = this.bubbleIconHost;
    const iconMissing = !iconHost || !iconHost.isValid || iconHost.children.length === 0;
    if (this.bubbleNeed === need && !iconMissing) return;
    this.bubbleNeed = need;
    this.drawBubbleIcon(need);
  }

  /** 按最紧缺的需求画气泡图标：饱食→鱼、清洁→水滴、心情→毛线球 */
  private drawBubbleIcon(need: string) {
    const host = this.bubbleIconHost;
    if (!host || !host.isValid) return;
    host.removeAllChildren();
    const g = makeGraphics('g', host);
    const r = 11;
    if (need === 'hunger') paintFish(g, r);
    else if (need === 'clean') paintDrop(g, r);
    else paintYarn(g, r);
  }

  // ---- 交互：点击命中分区 ----

  /**
   * 输入层：**横向拖动 + 点击命中**，用位移阈值区分两者。
   *
   * 世界宽 1.6 屏（竞品也是横向可平移的），所以拖动回来了；
   * 纵向仍然不滚 —— 竖着拖会破坏「墙在上、地在下」的稳定构图。
   *
   * **必须显式设非零 contentSize**，否则触摸命中不到（Graphics 不撑 UITransform）。
   * 诡异之处是**拖动照样能用**（靠 TOUCH_MOVE 的 delta，对尺寸不敏感），
   * 所以症状是「能拖但点不动」。
   */
  private setupInput(L: StageLayout) {
    const input = makeNode('MapInput', this.node, L.vw, L.vh);
    input.setPosition(0, 0);
    const itr = input.getComponent(UITransform);
    if (itr) {
      itr.setAnchorPoint(0.5, 0.5);
      itr.setContentSize(L.vw + 8, L.vh + 8);
    }

    let moved = 0;
    input.on(Node.EventType.TOUCH_START, (e: EventTouch) => {
      moved = 0;
      this.draggingPet = false;
      this.longPressArmed = false;
      // 按在猫身上 → 起长按计时（LONG_PRESS_SEC 后进入拖动宠物模式）
      const local = this.toWorldLocal(e);
      if (local && this.hitPet(local.x, local.y)) {
        this.longPressArmed = true;
        this.longPressTimer = 0;
      }
    });
    input.on(Node.EventType.TOUCH_MOVE, (e: EventTouch) => {
      const world = this.worldRoot;
      if (!world) return;
      const d = e.getDelta();
      moved += Math.abs(d.x) + Math.abs(d.y);

      // 拖动宠物模式：猫跟手指走（吸附到可走点在松手时做），不平移地图
      if (this.draggingPet) {
        const local = this.toWorldLocal(e);
        if (local && this.catNode && this.catNode.isValid) {
          this.catNode.setPosition(local.x, local.y, 0);
        }
        return;
      }
      // 手指移动超过阈值就取消长按待命（变成普通拖地图）
      if (moved >= 12) this.longPressArmed = false;

      const nx = Math.max(L.minX, Math.min(L.maxX, world.position.x + d.x));
      world.setPosition(nx, world.position.y, 0); // 只改 x：纵向不滚
      if (Math.abs(d.x) > 1 && nx === world.position.x) {
        this.flashEdge(d.x > 0 ? 'left' : 'right');
      }
    });
    input.on(Node.EventType.TOUCH_END, (e: EventTouch) => {
      if (this.draggingPet) { this.endDragPet(e); return; }
      this.longPressArmed = false;
      // 位移超过阈值算拖动，不触发点击（和 panelKit 的 TAP_SLOP 保持一致）
      if (moved >= 12) return;
      const local = this.toWorldLocal(e);
      if (local) this.handleTap(local.x, local.y);
    });
    input.on(Node.EventType.TOUCH_CANCEL, (e: EventTouch) => {
      if (this.draggingPet) this.endDragPet(e);
      this.longPressArmed = false;
    });
  }

  /** UI 触点 → worldRoot 局部坐标（和宠物/道具同一空间）。拖动后命中仍正确。 */
  private toWorldLocal(e: EventTouch): { x: number; y: number } | null {
    const world = this.worldRoot;
    if (!world) return null;
    const tr = world.getComponent(UITransform);
    if (!tr) return null;
    const p = e.getUILocation();
    const local = tr.convertToNodeSpaceAR(new Vec3(p.x, p.y, 0));
    return { x: local.x, y: local.y };
  }

  /** 进入拖动宠物模式：停掉散步 tween，气泡等附件会在 update 里继续跟随。 */
  private beginDragPet() {
    if (!this.catNode || !this.catNode.isValid) return;
    this.draggingPet = true;
    this.longPressArmed = false;
    // 停掉散步/互动 tween，避免和手指拖动打架
    Tween.stopAllByTarget(this.catNode);
    // 播 idle（被拎起来的猫不走路）
    if (this.catSkel && this.catIdle) this.catSkel.setAnimation(0, this.catIdle, true);
    if (DEBUG_GRID && this.debugPathG) this.debugPathG.clear();
  }

  /** 松手：把猫吸附到最近的可走点，然后恢复自由散步。 */
  private endDragPet(e: EventTouch) {
    this.draggingPet = false;
    const pet = this.catNode;
    if (!pet || !pet.isValid || !this.petGrid) return;
    const local = this.toWorldLocal(e);
    const cur = local || { x: pet.position.x, y: pet.position.y };
    // findPath 的起点会自动吸附到最近可走格；借它把落点纠正到合法位置
    const snapped = this.petGrid.snapToFree(cur.x, cur.y);
    pet.setPosition(snapped.x, snapped.y, 0);
    // 隔一会儿再自己走，别一松手立刻窜出去
    this.scheduleOnce(() => this.catStep(), 0.8);
  }

  /**
   * 边界提示：到头了就在提示条上说一句，1 秒内不重复刷。
   * 「有输入但画面不动」如果毫无反馈，玩家的判断是坏了而不是到边了。
   */
  private flashEdge(where: 'left' | 'right') {
    const now = Date.now();
    if (now - this.lastEdgeAt < 1000) return;
    this.lastEdgeAt = now;
    if (this.hintLabel) {
      this.hintLabel.string = where === 'left' ? '已经到最左边了' : '已经到最右边了';
    }
    this.scheduleOnce(() => {
      if (!this.disposed && this.hintLabel) this.hintLabel.string = HINT_TEXT;
    }, 1.2);
  }

  /**
   * 命中检测。**没命中任何分区就什么都不做**（不是「回落到大厅」）。
   *
   * 这里以前会命中一块铺满整个地板的「大厅」分区 → 整屏切到 MainView，
   * 结果是点空地板也跳走。空点击不做事是对的：地图本身就是可看的内容。
   */
  private handleTap(x: number, y: number) {
    if (!this.L) return;
    // 先判断是否点在宠物身上 → 执行互动（喂食/洗澡/陪玩/抚摸，按头顶需求）。
    // 分区命中在后：宠物在地板中段，一般不和壁龛重叠，但先判宠物更符合直觉。
    if (this.hitPet(x, y)) {
      this.interactWithPet();
      return;
    }
    const zone = this.L.zones.find((z: Zone) => hit(z, x, y));
    if (zone && this.onOpenZone) this.onOpenZone(zone.key);
  }

  /**
   * 宠物命中：猫是 Spine、不撑 UITransform，所以按它的**运行时 x + 布局 petY**
   * 圈一个矩形手动判定，不依赖节点尺寸（同 spine-2d-pet「骨骼渲染不撑 UITransform」）。
   * 命中框比猫略大一圈，手指点起来才不费劲。
   */
  private hitPet(x: number, y: number): boolean {
    const pet = this.catNode;
    if (!pet || !pet.isValid) return false;
    // 用猫的**当前** position（满地板游走，y 一直在变），不能用固定 L.petY
    const cx = pet.position.x;
    const cy = pet.position.y;
    const halfW = 70;   // 猫约 90px 高、稍窄，命中框给宽松点
    const halfH = 80;
    return x >= cx - halfW && x <= cx + halfW && y >= cy - 20 && y <= cy + halfH;
  }

  // ---- 固定 HUD ----

  private buildHint(L: StageLayout) {
    const hint = makeLabel(HINT_TEXT, this.node, {
      size: 17, color: COLOR.dim, align: 'center',
    });
    hint.node.setPosition(0, L.top + 14);
    // 存引用：撞边界时要临时改文案（flashEdge）
    this.hintLabel = hint;
  }

  /**
   * 点宠物执行互动（取代原来的底部互动条）。
   *
   * 做哪件事由**猫头顶气泡当前显示的需求**决定：
   * - 饱食低 → 喂食、清洁低 → 洗澡、心情低 → 陪玩（多项低时气泡在轮播，
   *   点到哪个就做哪个，和玩家看到的图标一致）；
   * - 三项都健康（气泡隐藏）→ 抚摸（日常撸猫，涨亲密度）。
   *
   * 冷却中**静默不做事、不弹提示**。原来那条「还要等 15s」的 toast 是给
   * 底部常驻按钮用的（按钮一直亮着像能点，冷却不提示就像坏了）；改成点宠物
   * 之后没有那种「按了没反应」的按钮了，冷却时安安静静不响应才自然
   * （尤其点一只没需求的猫时，玩家根本不知道有什么在冷却，弹提示反而突兀）。
   *
   * 网络链路和原 `MapActionBar.onInteract` 一致：发请求 → 按返回值播表现。
   * 服务端才是权威，本地只负责不发明知会失败的请求。
   */
  private async interactWithPet() {
    const action = this.currentPetAction();
    if (this.actionBusy[action]) return;

    // 冷却中：静默返回，不弹「还要等 Ns」
    if (!cooldown.isReady(store.activePetId, action)) return;

    this.actionBusy[action] = true;
    const res = await interact(action);
    this.actionBusy[action] = false;

    if (!res.ok) {
      showError(res.error);
      return;
    }

    this.reactCat(action);

    const gained = gainedText(res.data.gained);
    // 飘字放在猫头顶上方 —— 用猫当前 y（满地板游走），不是固定 petY
    const pet = this.catNode;
    const y = pet && pet.isValid ? pet.position.y + 140 : (this.L ? this.L.petY + 140 : 0);
    if (gained) floatText(this.node, gained, COLOR.ok, y);
    if (res.data.capped) toast('今日收益已达上限，明天再来');
    if (res.data.levelUp) floatText(this.node, '升级啦！', COLOR.warn, y + 30);
  }

  /**
   * 当前该做哪种互动：跟着气泡显示的需求走。
   * `lowNeeds` 为空（三项都健康、气泡隐藏）时回落到抚摸。
   * need 的命名和 `refreshPetOverlay` 一致：hunger/clean/play。
   */
  private currentPetAction(): PetAction {
    const need = this.lowNeeds.length
      ? this.lowNeeds[Math.min(this.needCycleIdx, this.lowNeeds.length - 1)]
      : '';
    if (need === 'hunger') return 'feed';
    if (need === 'clean') return 'bath';
    if (need === 'play') return 'play';
    return 'pet';
  }

  /**
   * 互动后的猫：挤压一下 + 播对应动画，播完接回 idle。
   *
   * 比 `PetStage.react` 简化 —— 地图上的猫在散步 tween 里，直接 `Tween.stopAllByTarget`
   * 会把散步一起停掉，所以只缩放不动位置，散步继续跑。
   */
  private reactCat(action: PetAction) {
    const pet = this.catNode;
    if (!pet || !pet.isValid) return;

    // 只播动画，不碰 tween：位置由 catStep 的 tween 管着，
    // 在这里 stopAllByTarget 会把散步永久停掉（猫再也不动了）。
    const skel = this.catSkel;
    if (skel) {
      const cands = ACTION_ANIM[action] || [];
      const main = cands.find((n) => this.catAnims.indexOf(n) >= 0);
      if (main) {
        skel.setAnimation(0, main, false);
        // 排队接回 idle，不用自己算时长（Spine 会按顺序接着播）
        if (this.catIdle) skel.addAnimation(0, this.catIdle, true, 0);
      }
    }
  }

  /**
   * 固定 HUD（头像/货币/右侧按钮/底部入口）。
   *
   * **必须最后挂**：兄弟节点次序即渲染层级，早挂会被输入层盖住。
   */
  private buildHud() {
    const host = makeNode('MapHud', this.node);
    const hud = host.addComponent(MapHud);
    // HUD 的入口路由借用分区回调这条已有链路，Main 那边统一认领，
    // 不给 HUD 单开一套注入 —— 两套路由迟早会漏掉一个 key。
    hud.onEntry = (key) => {
      if (this.onOpenZone) this.onOpenZone(key);
    };
    this.hud = hud;
  }
}
