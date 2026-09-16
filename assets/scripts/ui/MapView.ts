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
 * - `MapActionBar.ts` 底部内联互动条（四种互动 + 属性条）
 * - 本文件负责组装、Spine 猫、点击命中、HUD 挂载
 *
 * 层级用容器节点固定：art（Graphics 全部）→ pet（猫）→ label（文字）→ input
 * → hud → actionBar。顺序即渲染层级，所以文字永远压在图形之上，
 * 而互动条要排在**输入层之后**（输入层铺满整屏，压在按钮上就点不动了）。
 */

import {
  _decorator,
  Component,
  Node,
  Label,
  UITransform,
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
import { MapActionBar } from './MapActionBar';
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
  private bubbleLabel: Label | null = null;
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
    // 互动条**最后挂**：兄弟次序即渲染层级，早挂会被输入层吃掉点击。
    // 同理它必须在 setupInput 之后 —— 输入层铺满整屏，压在按钮上就点不动了。
    this.buildActionBar();

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
    // 房间本体（墙/地/墙裙）永远显示 —— 它没有对应的贴图，不是兜底
    const room = makeGraphics('Room', parent);
    fillRoundRect(room, -L.vw / 2, -L.vh / 2, L.vw, L.vh, 0, COLOR.bg);
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
      }, (n) => this.onArtDone(!!n));
    });

    // 不再乘 1.15/1.1：`L.stair` 现在已按图的实际长宽比算好，
    // 再放大会让楼梯溢出到楼层之外
    placeArt(layer, 'map/props/prop_stairs', {
      w: L.stair.w, h: L.stair.h, x: L.stair.cx,
      y: L.stair.cy - L.stair.h / 2, anchor: 'bottom',
    }, (n) => this.onArtDone(!!n));
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
    petNode.setPosition(0, L.petY, 0);

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

    this.bubbleLabel = makeLabel('', bubble, { size: 22, color: COLOR.title, align: 'center' });
    this.bubbleLabel.node.setPosition(0, 0);
    this.bubbleNode = bubble;

    this.statusBarHost = new Node('PetStatus');
    this.statusBarHost.parent = parent;

    // 猫脚下的接地阴影。**要挂在宠物之前的兄弟位置**才会画在它下面，
    // 所以用 setSiblingIndex 塞到宠物节点前面 —— 兄弟次序即渲染层级。
    const shadow = makeNode('PetShadow', parent);
    paintPetShadow(makeGraphics('g', shadow), 62);
    shadow.setSiblingIndex(petNode.getSiblingIndex());
    this.petShadow = shadow;
  }

  /** 在地板 x 范围内随机走一段 → 站立 idle → 停一下 → 再走 */
  private catStep() {
    if (this.disposed || !this.catNode || !this.L) return;

    const L = this.L;
    const cur = this.catNode.position.x;
    const target = L.petMinX + Math.random() * (L.petMaxX - L.petMinX);
    const dir = target >= cur ? 1 : -1;
    const dur = Math.max(0.6, Math.abs(target - cur) / 70);

    const s = BASE_SCALE;
    // Walk 默认朝左，往右走(dir>0)才翻转
    this.catNode.setScale(dir > 0 ? -s : s, s, 1);
    if (this.catSkel && this.catWalk) this.catSkel.setAnimation(0, this.catWalk, true);

    tween(this.catNode)
      .to(dur, { position: new Vec3(target, L.petY, 0) }, { easing: 'linear' })
      .call(() => {
        if (this.catSkel && this.catIdle) this.catSkel.setAnimation(0, this.catIdle, true);
      })
      .delay(1 + Math.random() * 2)
      .call(() => this.catStep())
      .start();
  }

  // ---- 每帧：气泡/状态条跟随宠物 ----

  /**
   * 只跟 x 与固定的垂直偏移，**不读宠物的 scale** ——
   * 宠物靠翻 scale.x 换向，跟着它算会让气泡在转身时左右横跳。
   */
  update() {
    const pet = this.catNode;
    if (!pet || !pet.isValid || !this.L) return;

    // 偏移跟着 BASE_SCALE 走：猫从 1.6 倍缩到 0.85 倍后，
    // 原来 +108 的气泡会飘在猫头顶很高的空处
    const x = pet.position.x;
    if (this.bubbleNode && this.bubbleNode.isValid) {
      this.bubbleNode.setPosition(x, this.L.petY + 106 * BASE_SCALE, 0);
    }
    if (this.statusBarHost && this.statusBarHost.isValid) {
      this.statusBarHost.setPosition(x, this.L.petY - 10, 0);
    }
    if (this.petShadow && this.petShadow.isValid) {
      this.petShadow.setPosition(x, this.L.petY + 3, 0);
    }

    const sig = this.buildPetSig();
    if (sig === this.lastPetSig) return;
    this.lastPetSig = sig;
    this.refreshPetOverlay();
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
   * 气泡显示**最紧缺的那一项**需求（概念稿里是一条鱼 / 一滴水这种图标）。
   * 四项都健康时把气泡隐掉 —— 挂一个空白气泡比没有气泡更让人困惑。
   */
  private refreshPetOverlay() {
    const p = store.petView;
    const bubble = this.bubbleNode;
    const host = this.statusBarHost;

    if (!p) {
      if (bubble && bubble.isValid) bubble.active = false;
      return;
    }

    const needs = [
      { glyph: '🐟', lack: 100 - p.hunger, ratio: p.hunger / 100 },
      { glyph: '💧', lack: 100 - p.cleanliness, ratio: p.cleanliness / 100 },
      { glyph: '🎾', lack: 100 - p.mood, ratio: p.mood / 100 },
    ];
    needs.sort((a, b) => b.lack - a.lack);
    const worst = needs[0];

    if (bubble && bubble.isValid) {
      // 阈值 60：低于此才提需求，否则气泡会常驻、失去提示意义
      const show = worst.ratio < 0.6;
      bubble.active = show;
      if (show && this.bubbleLabel) this.bubbleLabel.string = worst.glyph;
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
    input.on(Node.EventType.TOUCH_START, () => {
      moved = 0;
    });
    input.on(Node.EventType.TOUCH_MOVE, (e: EventTouch) => {
      const world = this.worldRoot;
      if (!world) return;
      const d = e.getDelta();
      moved += Math.abs(d.x) + Math.abs(d.y);
      const nx = Math.max(L.minX, Math.min(L.maxX, world.position.x + d.x));
      // 只改 x：纵向不滚
      world.setPosition(nx, world.position.y, 0);

      // 撞边界要给反馈 —— 手势有输入但画面不动，不提示的话玩家以为「地图坏了」
      if (Math.abs(d.x) > 1 && nx === world.position.x) {
        this.flashEdge(d.x > 0 ? 'left' : 'right');
      }
    });
    input.on(Node.EventType.TOUCH_END, (e: EventTouch) => {
      // 位移超过阈值算拖动，不触发点击（和 panelKit 的 TAP_SLOP 保持一致）
      if (moved >= 12) return;
      const p = e.getUILocation();
      const world = this.worldRoot;
      if (!world) return;
      const tr = world.getComponent(UITransform);
      if (!tr) return;
      // 转到**世界节点**的局部空间：这样拖动之后命中依然正确。
      // 转 this.node 就错了 —— 那是不动的层，拖过之后会整体偏掉。
      const local = tr.convertToNodeSpaceAR(new Vec3(p.x, p.y, 0));
      this.handleTap(local.x, local.y);
    });
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
    const zone = this.L.zones.find((z: Zone) => hit(z, x, y));
    if (zone && this.onOpenZone) this.onOpenZone(zone.key);
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
   * 底部内联互动条（四种互动 + 三条属性条）。
   *
   * 这块以前是整屏的 `MainView`，靠点地板上那块铺满 `floorH` 的「大厅」分区进去。
   * 那条分区让**任何一次落在壁龛之外的点击都跳走**，而它换来的只是四个按钮 ——
   * 所以按钮搬到这里，大厅分区和「返回」按钮一起去掉（地图就是落地界面，
   * 没有可返回的上一层）。
   *
   * 互动成功后让地图上这只猫也演一下：没有反馈的话玩家分不清「点到了」和「没点到」。
   */
  private buildActionBar() {
    const host = makeNode('MapActionBar', this.node);
    const bar = host.addComponent(MapActionBar);
    bar.onReact = (action: PetAction) => this.reactCat(action);
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
