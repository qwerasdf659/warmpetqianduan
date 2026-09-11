/**
 * 家庭地图 · 双向滚动 + 真实贴图 + 大厅 Spine 猫 + 分区点击。
 *
 * 坐标系与 docs/地图施工线框图.svg 一致：世界 1440×3600「世界像素」，左上原点、y 向下；
 * Cocos 节点是中心原点、y 向上，放置时统一过 rectLocal()/centerLocal() 转换。
 *
 * 贴图来源：优先 `resources/map/<层>/{wall|floor}`（将来的专属美术），
 * 缺失则兼底到工程已有的 `deco_tiles/wall|floor` 与 `shop/furn`（都已导入、可直接加载）。
 * 按**具体文件名**加载，不 loadDir 整个目录——deco_tiles 有 26MB、shop/furn ~10MB，
 * 整目录扫会把纹理内存打爆（规则：低端机纹理内存是大地图的关键约束）。
 *
 * 层级用容器节点固定：bg（占位色块兜底）→ art（墙/地/家具，异步到货）→ pet（猫）→ label（文字）。
 * 这样异步贴图无论何时到货都压不到文字上面。
 *
 * 猫：复用 spine/pet_cat/Cat（和主界面同一套），皮肤/动画/预乘按 spine-2d-pet 规则兜底，
 * 在大厅层内左右游走（Walk 默认朝左，往右翻 scale.x）。
 *
 * 交互：全屏输入层收手势，按位移阈值区分「拖动地图」与「点击分区」；点击命中分区回调 onOpenZone。
 */

import {
  _decorator,
  Component,
  Node,
  Sprite,
  SpriteFrame,
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
  fillRoundRect,
  fillRoundRectRim,
} from './widgets';

const { ccclass } = _decorator;

/**
 * 世界尺寸（世界像素）。
 *
 * 宽 2160 = 3 个视口宽（视口 720），横向余量 ±720（整整一屏），
 * 拖动才有「探索」的手感。1440 那版横向只有 ±360、且一个 600 宽的分区
 * 几乎占满整屏，拖满也还在同一分区里，实测让人误判成「拖不动」。
 */
const WORLD_W = 2160;
const WORLD_H = 3600;

/** 猫（复用主界面 Spine），皮肤/动画候选与规则一致 */
const CAT_PATH = 'spine/pet_cat/Cat';
const BASE_SCALE = 3;
const DEFAULT_SKIN = '007';
const IDLE_CANDIDATES = ['idle', 'Idle', 'Sit_Idle', 'Idle3', 'Sleep_A'];
const WALK_CANDIDATES = ['Walk', 'Walk2', 'Walk_2', 'walk'];

/** 楼层带：name + 世界 y 起点 + 高度 + 兜底墙纸/地板文件名（deco_tiles 下，已导入） */
interface FloorBand {
  name: string;
  key: string;
  y: number;
  h: number;
  wall: string;
  floor: string;
}

/**
 * 楼层带。墙纸/地板文件名是**看过 deco_tiles 缩略图对照表后挑的**暖木系，
 * 不是按编号猜的（早先猜的那批混进了冷色瓷砖，和「暖木小屋」完全不搭）。
 */
const FLOORS: FloorBand[] = [
  { name: '阁楼', key: 'attic', y: 0, h: 720, wall: 'FURN_386', floor: 'WoodBoard_Long_LightWarm' },
  { name: '3F', key: 'f3', y: 720, h: 960, wall: 'FURN_306', floor: 'EntranceFloor_Wood_LightWarm' },
  { name: '2F', key: 'f2', y: 1680, h: 960, wall: 'FURN_369', floor: 'WoodBoard_Long_Light' },
  { name: '1F', key: 'f1', y: 2640, h: 960, wall: 'FURN_140', floor: 'EntranceFloor_Wood_Light' },
];

/** 墙纸带占楼层高度的比例，其余为地板 */
const WALL_RATIO = 0.34;

/** 功能分区：key（点击路由用）+ name + 玩法 + 世界矩形 + 兜底家具文件名（shop/furn 下，已导入） */
interface Zone {
  key: string;
  name: string;
  sub: string;
  x: number;
  y: number;
  w: number;
  h: number;
  furn: string;
}

/**
 * 功能分区。世界宽 2160、视口 720，所以每个分区做成 **560 宽**并彼此拉开，
 * 这样任一分区都能独立居中看全（600 宽 + 1440 世界那版做不到，邻居总会挤进来）。
 * 家具文件名同样是看过 shop/furn 对照表后按主题挑的。
 */
const ZONES: Zone[] = [
  // 阁楼：花园阳台横贯整层（户外玩法：赛跑 / 兑换）
  { key: 'garden', name: '花园阳台', sub: '赛跑 / 兑换', x: 120, y: 80, w: 1920, h: 560, furn: 'FURN_121' },
  // 3F：育婴室（左）+ 商店储物（右）
  { key: 'nursery', name: '育婴室', sub: '扭蛋 / 新宠', x: 160, y: 780, w: 560, h: 800, furn: 'FURN_080' },
  { key: 'shop', name: '商店 / 储物', sub: '商店 / 换装', x: 1440, y: 780, w: 560, h: 800, furn: 'FURN_114' },
  // 2F：洗浴间（左）+ 护理室（右）
  { key: 'bath', name: '洗浴间', sub: '洗澡', x: 160, y: 1740, w: 560, h: 800, furn: 'FURN_045' },
  { key: 'care', name: '护理室', sub: '道具', x: 1440, y: 1740, w: 560, h: 800, furn: 'FURN_233' },
  // 1F：大厅客厅横贯整层（落地屏，宠物主活动区）
  { key: 'lobby', name: '大厅客厅', sub: '互动 + 家园装修', x: 120, y: 2700, w: 1920, h: 840, furn: 'FURN_006' },
];

/** 中央楼梯柱（世界矩形），落在世界正中、分隔左右两个分区 */
const STAIR = { x: 1000, y: 0, w: 160, h: 3600 };

/** 顶部提示常态文案（撞边界时会临时替换，随后还原） */
const HINT_TEXT = '上下左右拖动查看 · 点分区进入玩法';

@ccclass('MapView')
export class MapView extends Component {
  /** 返回主界面回调，由 Main 注入 */
  onBack: (() => void) | null = null;
  /** 点击某个分区回调（传分区 key），由 Main 注入以打开对应玩法 */
  onOpenZone: ((key: string) => void) | null = null;

  private mapRoot: Node | null = null;
  private artLayer: Node | null = null;
  private petLayer: Node | null = null;
  private labelLayer: Node | null = null;

  private vw = 0;
  private vh = 0;

  private minX = 0;
  private maxX = 0;
  private minY = 0;
  private maxY = 0;

  private dragging = false;
  private disposed = false;

  private hintLabel: Label | null = null;
  private lastEdgeAt = 0;

  // 猫
  private catNode: Node | null = null;
  private catSkel: sp.Skeleton | null = null;
  private catIdle = '';
  private catWalk = '';
  private catBaseY = 0;

  onLoad() {
    const size = view.getVisibleSize();
    this.vw = size.width;
    this.vh = size.height;

    const root = makeNode('MapRoot', this.node, WORLD_W, WORLD_H);
    this.mapRoot = root;
    // convertToNodeSpaceAR 依赖锚点与尺寸，显式钉住（默认值虽也是 0.5 但别依赖隐式）
    const rtr = root.getComponent(UITransform);
    if (rtr) {
      rtr.setAnchorPoint(0.5, 0.5);
      rtr.setContentSize(WORLD_W, WORLD_H);
    }

    // 层级容器：顺序即渲染层级，异步贴图到货后仍压不到文字/猫之上
    const bgLayer = makeNode('BgLayer', root);
    this.artLayer = makeNode('ArtLayer', root);
    this.petLayer = makeNode('PetLayer', root);
    this.labelLayer = makeNode('LabelLayer', root);

    this.buildFallback(bgLayer);
    this.buildArt();
    this.buildLabels();
    this.buildCat();

    this.maxX = Math.max(0, (WORLD_W - this.vw) / 2);
    this.minX = -this.maxX;
    this.maxY = Math.max(0, (WORLD_H - this.vh) / 2);
    this.minY = -this.maxY;

    // 初始停在 1F 大厅，但**故意留出半屏余量、不贴到 maxY**。
    // 贴在边界上的话「手指往上滑」那一半手势会完全没反应（clamp 挡住），
    // 玩家的第一感受就是「地图拖不动」——实测踩过，这不是手感问题而是可用性问题。
    // 横向同理留出余量：x=0 是世界正中（楼梯柱），偏一点才能立刻感到左右都能拖。
    const startY = this.clampY(this.maxY - this.vh * 0.5);
    const startX = this.clampX(-this.vw * 0.4);
    root.setPosition(startX, startY, 0);

    this.setupDrag();
    this.buildHint();
    this.buildBackButton();
  }

  onDestroy() {
    this.disposed = true;
    if (this.catNode) Tween.stopAllByTarget(this.catNode);
  }

  private spineReady(): boolean {
    return !!(
      sp &&
      (sp as unknown as { Skeleton?: unknown }).Skeleton &&
      (sp as unknown as { SkeletonData?: unknown }).SkeletonData
    );
  }

  // ---- 坐标转换：世界(左上原点,y向下) → MapRoot 局部(中心原点,y向上) ----

  /** 世界矩形 → 节点局部矩形（返回**左下角**坐标，供 Graphics.roundRect 用） */
  private rectLocal(x: number, y: number, w: number, h: number) {
    return { x: x - WORLD_W / 2, y: WORLD_H / 2 - y - h, w, h };
  }

  /** 世界矩形中心 → 节点局部中心 */
  private centerLocal(x: number, y: number, w: number, h: number): [number, number] {
    return [x + w / 2 - WORLD_W / 2, WORLD_H / 2 - (y + h / 2)];
  }

  // ---- 占位兜底（贴图到货前 / 加载失败时的最终形态） ----

  private buildFallback(parent: Node) {
    const g = makeGraphics('Fallback', parent);
    fillRoundRect(g, -WORLD_W / 2, -WORLD_H / 2, WORLD_W, WORLD_H, 0, COLOR.bg);
    FLOORS.forEach((f, i) => {
      const r = this.rectLocal(0, f.y, WORLD_W, f.h);
      fillRoundRect(g, r.x, r.y, r.w, r.h, 0, i % 2 ? COLOR.panelLight : COLOR.track);
    });
    const s = this.rectLocal(STAIR.x, STAIR.y, STAIR.w, STAIR.h);
    fillRoundRect(g, s.x, s.y, s.w, s.h, 0, COLOR.disabled);
    ZONES.forEach((z) => {
      const r = this.rectLocal(z.x, z.y, z.w, z.h);
      fillRoundRectRim(g, r.x, r.y, r.w, r.h, 24, COLOR.panel, 4, COLOR.accent);
    });
  }

  // ---- 真实贴图：墙纸 / 地板 / 家具 ----

  private buildArt() {
    FLOORS.forEach((f) => {
      const wallH = f.h * WALL_RATIO;
      const floorH = f.h - wallH;
      // 墙纸带
      this.loadFrame(`map/${f.key}/wall/spriteFrame`, `deco_tiles/wall/${f.wall}/spriteFrame`, (frame) => {
        if (frame) this.addBand(0, f.y, WORLD_W, wallH, frame);
      });
      // 地板带
      this.loadFrame(`map/${f.key}/floor/spriteFrame`, `deco_tiles/floor/${f.floor}/spriteFrame`, (frame) => {
        if (frame) this.addBand(0, f.y + wallH, WORLD_W, floorH, frame);
      });
    });

    // 每个分区一件家具，坐落在该层地板上，当作可点入口的视觉锚
    ZONES.forEach((z) => {
      this.loadFrame(`map/${z.key}/furn/spriteFrame`, `shop/furn/${z.furn}/spriteFrame`, (frame) => {
        if (frame) this.addFurniture(z, frame);
      });
    });
  }

  /** 先试专属美术 map/<...>，缺失则兼底到已导入的 deco/shop 资源 */
  private loadFrame(mapPath: string, fallbackPath: string, cb: (f: SpriteFrame | null) => void) {
    resources.load(mapPath, SpriteFrame, (_e, f) => {
      if (this.disposed) return;
      if (f) {
        cb(f as SpriteFrame);
        return;
      }
      resources.load(fallbackPath, SpriteFrame, (_e2, f2) => {
        if (this.disposed) return;
        cb((f2 as SpriteFrame) || null);
      });
    });
  }

  /** 平铺贴图带（墙/地）：TILED 让贴块按原尺寸重复，不拉伸糊掉 */
  private addBand(wx: number, wy: number, w: number, h: number, frame: SpriteFrame) {
    if (!this.artLayer) return;
    const r = this.rectLocal(wx, wy, w, h);
    const node = makeNode('band', this.artLayer, w, h);
    node.setPosition(r.x + w / 2, r.y + h / 2, 0);
    const s = node.addComponent(Sprite);
    s.sizeMode = Sprite.SizeMode.CUSTOM;
    s.type = Sprite.Type.TILED;
    s.spriteFrame = frame;
  }

  /**
   * 家具精灵：保持长宽比，坐落在分区底部（地板上）。
   *
   * 尺寸**直接从 SpriteFrame 读原始宽高**、用 CUSTOM 模式显式设 contentSize，
   * 不要在赋值 spriteFrame 之后去读 UITransform.height——那一帧组件尺寸还没更新，
   * 会算出错误的 scale（表现为家具忽大忽小或飘在半空）。
   */
  private addFurniture(z: Zone, frame: SpriteFrame) {
    if (!this.artLayer) return;

    const rect = frame.rect;
    const srcW = rect.width || 200;
    const srcH = rect.height || 200;

    // 目标高度：占分区高度的 45%，同时不超过分区宽度的 60%（细高与扁宽都能放下）
    const maxH = z.h * 0.45;
    const maxW = z.w * 0.6;
    const scale = Math.min(maxH / srcH, maxW / srcW);
    const w = srcW * scale;
    const h = srcH * scale;

    const node = makeNode('furn', this.artLayer, w, h);
    const s = node.addComponent(Sprite);
    s.sizeMode = Sprite.SizeMode.CUSTOM;
    s.type = Sprite.Type.SIMPLE;
    s.spriteFrame = frame;
    const tr = node.getComponent(UITransform);
    if (tr) tr.setContentSize(w, h);

    const [cx] = this.centerLocal(z.x, z.y, z.w, z.h);
    const bottomLocal = WORLD_H / 2 - (z.y + z.h);
    // 坐在分区底部往上 32（贴地板，不悬空）
    node.setPosition(cx, bottomLocal + h / 2 + 32, 0);
  }

  // ---- 文字：楼层名 + 分区名 ----

  private buildLabels() {
    const parent = this.labelLayer;
    if (!parent) return;

    FLOORS.forEach((f) => {
      const [, cy] = this.centerLocal(0, f.y, 0, f.h);
      const lbl = makeLabel(f.name, parent, { size: 34, color: COLOR.dim, bold: true });
      lbl.node.setPosition(-WORLD_W / 2 + 44, cy + f.h / 2 - 44);
    });

    ZONES.forEach((z) => {
      const [cx, cy] = this.centerLocal(z.x, z.y, z.w, z.h);
      const name = makeLabel(z.name, parent, { size: 46, color: COLOR.title, align: 'center', bold: true });
      name.node.setPosition(cx, cy + z.h / 2 - 60);
      const sub = makeLabel(z.sub, parent, { size: 28, color: COLOR.text, align: 'center' });
      sub.node.setPosition(cx, cy + z.h / 2 - 108);
    });
  }

  // ---- 大厅的 Spine 猫 ----

  private buildCat() {
    if (!this.petLayer || !this.spineReady()) return;

    const lobby = ZONES.find((z) => z.key === 'lobby');
    if (!lobby) return;

    const petNode = makeNode('MapPet', this.petLayer);
    this.catNode = petNode;
    // 落在大厅地板上（世界 y 取分区底部略上方），x 落在大厅中心
    this.catBaseY = WORLD_H / 2 - (lobby.y + lobby.h - 120);
    const [lobbyCx] = this.centerLocal(lobby.x, lobby.y, lobby.w, lobby.h);
    petNode.setPosition(lobbyCx, this.catBaseY, 0);

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
      this.catIdle = IDLE_CANDIDATES.find((n) => anims.indexOf(n) >= 0) || '';
      this.catWalk = WALK_CANDIDATES.find((n) => anims.indexOf(n) >= 0) || '';

      // 空 default 皮肤兜底：选 007，没有就取第一个编号皮肤
      const numeric = skins.filter((n) => /^\d+$/.test(n));
      const skin = skins.indexOf(DEFAULT_SKIN) >= 0 ? DEFAULT_SKIN : numeric[0] || '';
      if (skin) skel.setSkin(skin);

      petNode.setScale(BASE_SCALE, BASE_SCALE, 1);
      if (this.catIdle) skel.setAnimation(0, this.catIdle, true);

      if (this.catWalk) this.catStep();
    });
  }

  /** 在大厅 x 范围内随机走一段 → 到点站立 idle → 停一下 → 再走 */
  private catStep() {
    if (this.disposed || !this.catNode) return;

    // 游走范围跟着大厅分区算，别写死数字（世界宽改过一次，硬编码会静默错位）
    const lobby = ZONES.find((z) => z.key === 'lobby');
    const pad = 200;
    const leftLocal = (lobby ? lobby.x + pad : pad) - WORLD_W / 2;
    const rightLocal = (lobby ? lobby.x + lobby.w - pad : WORLD_W - pad) - WORLD_W / 2;
    const cur = this.catNode.position.x;
    const target = leftLocal + Math.random() * (rightLocal - leftLocal);
    const dir = target >= cur ? 1 : -1;
    const dur = Math.max(0.6, Math.abs(target - cur) / 140);

    const s = BASE_SCALE;
    // Walk 默认朝左，往右走(dir>0)才翻转
    this.catNode.setScale(dir > 0 ? -s : s, s, 1);
    if (this.catSkel && this.catWalk) this.catSkel.setAnimation(0, this.catWalk, true);

    tween(this.catNode)
      .to(dur, { position: new Vec3(target, this.catBaseY, 0) }, { easing: 'linear' })
      .call(() => {
        if (this.catSkel && this.catIdle) this.catSkel.setAnimation(0, this.catIdle, true);
      })
      .delay(1 + Math.random() * 2)
      .call(() => this.catStep())
      .start();
  }

  // ---- 固定 HUD（不随地图滚动） ----

  private buildHint() {
    const hint = makeLabel(HINT_TEXT, this.node, {
      size: 20,
      color: COLOR.title,
      align: 'center',
      bold: true,
    });
    hint.node.setPosition(0, this.vh / 2 - 40);
    this.hintLabel = hint;
  }

  private buildBackButton() {
    const w = 128;
    const h = 56;
    const btn = makeNode('MapBack', this.node, w, h);
    btn.setPosition(-this.vw / 2 + 12 + w / 2, this.vh / 2 - 12 - h / 2);

    const g = makeGraphics('bg', btn);
    fillRoundRectRim(g, -w / 2, -h / 2, w, h, h / 2, COLOR.accent, 3);

    const lbl = makeLabel('返回', btn, { size: 24, color: COLOR.accentText, align: 'center', bold: true });
    lbl.node.setPosition(0, 0);

    btn.on(Node.EventType.TOUCH_END, () => {
      if (this.onBack) this.onBack();
    });
  }

  // ---- 手势：区分拖动与点击 ----

  private setupDrag() {
    const input = makeNode('MapInput', this.node, this.vw, this.vh);
    input.setPosition(0, 0);
    // 必须显式设非零 contentSize，否则触摸命中不到（规则：骨骼/Graphics 不撑 UITransform）。
    // 宽高各留一点余量，避免边缘手势落到热区之外。
    const itr = input.getComponent(UITransform);
    if (itr) {
      itr.setAnchorPoint(0.5, 0.5);
      itr.setContentSize(this.vw + 8, this.vh + 8);
    }

    let moved = 0;
    input.on(Node.EventType.TOUCH_START, () => {
      this.dragging = true;
      moved = 0;
    });
    input.on(Node.EventType.TOUCH_MOVE, (e: EventTouch) => {
      if (!this.dragging || !this.mapRoot) return;
      const d = e.getDelta();
      moved += Math.abs(d.x) + Math.abs(d.y);
      const p = this.mapRoot.position;
      const nx = this.clampX(p.x + d.x);
      const ny = this.clampY(p.y + d.y);
      this.mapRoot.setPosition(nx, ny, 0);

      // 撞到边界时给一次提示：手势有输入但画面不动，不提示的话玩家会以为「地图坏了」
      const blockedX = Math.abs(d.x) > 1 && nx === p.x;
      const blockedY = Math.abs(d.y) > 1 && ny === p.y;
      if (blockedX || blockedY) this.flashEdge(blockedY ? (d.y > 0 ? 'top' : 'bottom') : 'side');
    });
    input.on(Node.EventType.TOUCH_END, (e: EventTouch) => {
      this.dragging = false;
      if (moved < 12) {
        const p = e.getUILocation();
        this.handleTap(p.x, p.y);
      }
    });
    input.on(Node.EventType.TOUCH_CANCEL, () => {
      this.dragging = false;
    });
  }

  /**
   * 边界提示：到头了就在提示条上说一句，1 秒内不重复刷。
   * 「有输入但画面不动」如果毫无反馈，玩家的判断是坏了而不是到边了。
   */
  private flashEdge(where: 'top' | 'bottom' | 'side') {
    const now = Date.now();
    if (now - this.lastEdgeAt < 1000) return;
    this.lastEdgeAt = now;
    const text =
      where === 'top' ? '已经到最上层了' : where === 'bottom' ? '已经到最下层了' : '已经到边界了';
    if (this.hintLabel) this.hintLabel.string = text;
    this.scheduleOnce(() => {
      if (!this.disposed && this.hintLabel) this.hintLabel.string = HINT_TEXT;
    }, 1.2);
  }

  /**
   * 屏幕点 → 世界坐标 → 命中分区 → 回调。
   *
   * 坐标换算**交给引擎的 convertToNodeSpaceAR**（和 PetStage 里已验证可用的写法一致），
   * 不要自己拿「屏幕中心为原点」去手算：`getUILocation()` 给的是**左下角为原点**的
   * UI 坐标，手算时少减/多减半屏都不会报错，只会让命中判定整体偏移半个屏幕——
   * 实测症状是「点屏幕任何高度都命中同一个分区」。
   */
  private handleTap(uiX: number, uiY: number) {
    const root = this.mapRoot;
    if (!root) return;
    const tr = root.getComponent(UITransform);
    if (!tr) return;

    // 转到 MapRoot 自己的局部空间（锚点中心、y 向上）
    const local = tr.convertToNodeSpaceAR(new Vec3(uiX, uiY, 0));
    // 局部 → 世界模型（左上原点、y 向下）
    const worldX = local.x + WORLD_W / 2;
    const worldY = WORLD_H / 2 - local.y;

    const zone = ZONES.find(
      (z) => worldX >= z.x && worldX <= z.x + z.w && worldY >= z.y && worldY <= z.y + z.h,
    );
    if (zone && this.onOpenZone) this.onOpenZone(zone.key);
  }

  private clampX(x: number): number {
    return Math.max(this.minX, Math.min(this.maxX, x));
  }

  private clampY(y: number): number {
    return Math.max(this.minY, Math.min(this.maxY, y));
  }
}
