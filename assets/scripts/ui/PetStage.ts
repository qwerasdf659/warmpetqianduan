/**
 * 2D 宠物舞台（Spine 骨骼）。
 *
 * 优先加载 Spine 骨骼资源（带 idle 动画）；资源缺失或引擎未编入 spine 模块时，
 * 退回用 Graphics 画的占位宠物。**任何一条路径都必须出画面**——舞台是主视觉，
 * 空一块比丑一点糟得多。
 *
 * 迁移说明（3D → 2D，见 docs/06 §3.4 / §5）：
 *   旧版是 3D：单开一个透视相机清屏、平行光、GLB + builtin-toon 描边。
 *   新版是纯 2D：宠物是 Canvas 下的 UI 节点挂 sp.Skeleton，和其余 UI 同层渲染，
 *   不再需要第二个相机，UI 相机恢复默认清屏。
 */

import {
  _decorator,
  Component,
  Node,
  UITransform,
  Layers,
  Color,
  Vec3,
  tween,
  Tween,
  resources,
  Sprite,
  SpriteFrame,
  Graphics,
  Camera,
  Canvas,
  view,
  sp,
  EventTouch,
} from 'cc';
import { COLOR, makeLabel } from './widgets';
import { randomCustomer } from './showcaseData';
import store from '../core/store';
import type { PetStage as PetGrowthStage } from '../net/types';

const { ccclass } = _decorator;

/** 占位配色，对齐奶茶米色系（docs/06 §2.2）。毛色比背景深一档，靠明度差把轮廓拉出来。 */
const FUR = new Color(217, 190, 150, 255); // #D9BE96
const FUR_DARK = new Color(196, 168, 126, 255); // #C4A87E
const OUTLINE = new Color(74, 55, 40, 255); // #4A3728

/** 成长阶段只改缩放，不换骨架（docs/06 §5.7） */
const STAGE_SCALE: Record<PetGrowthStage, number> = { baby: 0.72, teen: 0.86, adult: 1.0 };

/** 幼崽动作更碎更快，用 Spine 的 timeScale 实现 */
const STAGE_SPEED: Record<PetGrowthStage, number> = { baby: 1.15, teen: 1.0, adult: 1.0 };

/**
 * species → Spine 骨架资源名。后端目前返回 "default"，认不出就走兜底。
 * 兜底用拟人主宠：它是养成核心，也是唯一保证有全套动画的骨架（docs/06 §5.1）。
 */
const SPECIES_SKELETON: Record<string, string> = { cat: 'pet_cat/Cat', dog: 'pet_dog' };
// 临时（玩法验证）：pet_humanoid / pet_dog 骨架还没到位，兜底先指向已导入的 59 猫包，
// 保证 mock 返回 default species 时也能直接看到骨骼动画。真实主宠到位后改回 'pet_humanoid'。
const FALLBACK_SKELETON = 'pet_cat/Cat';

/** Spine 资源统一放在 resources/spine/ 下，运行时按名字加载 SkeletonData 子资源 */
const SPINE_DIR = 'spine';
/**
 * 动画名兜底候选：自研主宠会统一用小写 idle/happy；接入的现成素材（如 59 猫包）
 * 用的是 Idle / Pers_Playful 这类命名。按顺序取第一个存在的，省得逐个改素材。
 */
const IDLE_CANDIDATES = ['Sleep_A', 'idle', 'Idle', 'Sit_Idle', 'Idle3'];
const HAPPY_CANDIDATES = ['happy', 'Pers_Playful', 'A_Play', 'Stand_Pat'];
/** 散步用：走路动画 + 到点停下的站立 idle（不用 Sleep，睡着走看着怪） */
const WALK_CANDIDATES = ['Walk', 'Walk2', 'Walk_2', 'walk'];
const WANDER_IDLE_CANDIDATES = ['Idle', 'Sit_Idle', 'idle', 'Stretch'];
/** 拖拽用：被拎起来的过渡动作 + 被抱住的循环姿势 */
const HOLD_PICK_CANDIDATES = ['Stand_Hold_Pick_Up', 'Floor_Hold_Pick_Up', 'X_Chair_Pick_Up'];
const HOLD_LOOP_CANDIDATES = ['Stand_Hold', 'Floor_Hold', 'Stand_Hold_Hug', 'Stand_Hold_Sleep'];

/** 散步左右端点（UI 坐标，屏幕中心为 0）与各段时长（秒） */
const WANDER_LEFT = -180;
const WANDER_RIGHT = 180;
const WANDER_CENTER = 0;
/** 骨架加载完是否自动开始散步（无需点按钮） */
const AUTO_WANDER = true;

/** 宠物可点/可拖区域（节点局部尺寸，会再乘宠物缩放），要盖住整只猫 */
const PET_HIT_W = 180;
const PET_HIT_H = 150;

/**
 * 四个互动按钮各自的动作候选（按顺序取第一个骨架里存在的）。
 * 只用不依赖家具/道具皮肤的独立动画，换任何皮肤都不会缺件；找不到就退回通用 happy。
 */
const ACTION_ANIM: Record<string, string[]> = {
  feed: ['Knead', 'Sit_Lick_Hand', 'Minigame_Treat_Correct'],
  bath: ['Sit_Lick_Leg', 'Minigame_Brush'],
  pet: ['Stand_Pat', 'Pers_Cuddly'],
  play: ['Standing_Toy', 'A_Play', 'Pers_Playful'],
};

/** 素材没有 default 皮肤时，挂载后必须显式选一套皮肤，否则骨架没有任何附件、整只不可见 */
const DEFAULT_SKIN = '007';

/** 骨架显示基准缩放，成长缩放在此之上再乘。59 猫包骨骼原生只有 ~106 单位高，放到 1280 视口里太小，先放大一档。 */
const BASE_SCALE = 3;

/**
 * 可循环切换的场景。前四个是成品房间背景（resources/bg/ 下的整图）；
 * 'deco' 是「装修间」——墙/地板由可换的贴块实时铺，用来演示家园装修。
 */
const ROOM_SCENES = ['bg_kitchen', 'bg_greenhouse', 'bg_workshop', 'bg_room'];
const DECO_SCENE = 'deco';
const BG_LIST = [...ROOM_SCENES, DECO_SCENE];
const BG_NAME = BG_LIST[0];

/**
 * 每个场景的前景遮挡层（在 resources/bg_layers/ 下），叠在猫之上做出层次。
 * 宽高比很扁的当作底部整幅前景条铺满宽度；否则当定位道具、锚在底部居中。
 */
const FG_MAP: Record<string, string> = {
  bg_kitchen: 'Kitchen_Table',
  bg_greenhouse: 'Greenhouse_Foreground',
  bg_workshop: 'Workshop_Table',
};

/**
 * 从素材包批量导入的舞台道具（互动家具 + 站点 + 特效），路径都是 spine/<名>/<名>。
 * 「换家具」按钮循环切换：none → 依次每个 → none。原生大小/锚点各不相同，展示用统一缩放。
 */
const PROP_LIST = [
  'Fishbowl/Fishbowl',
  'Yarn_Basket/Yarn_Basket',
  'Butterfly_Toy/Butterfly_Toy',
  'RockFountain/RockFountain',
  'FURN_220/FURN_220',
  'Jukebox/Jukebox',
  'Arcade_Machine/Arcade_Machine',
  'Arcade_Cabinet/Arcade_Cabinet',
  'Heater/Heater',
  'FirePlace/FirePlace',
  'Porthole/Porthole',
  'FURN_219/FURN_219',
  'FURN_394/FURN_394',
  'TV/TV',
  'Karaoke/Karaoke',
  'Whack_A_Mouse/Whack_A_Mouse',
  'Feeding_Station/Feeding_Station',
  'ToyBox/ToyBox',
  'Fortune_Cat/Fortune_Cat',
  'Chest/Chest',
  'CraftingStation/CraftingStation',
  'KitchenBowl/KitchenBowl',
  'Greenhouse/Greenhouse',
  'Customer/Customer',
  'Mouse/Mouse',
  'Curtain/Curtain',
  'Effect/Effect',
  'Feeding_Effect/Feeding_Effect',
];
/** 帽子/饰品贴图 + 挂载到的骨骼名（2D 挂点：让一个 Sprite 每帧跟随该骨骼） */
const HAT_RES = 'deco/hat_heart/spriteFrame';
const HAT_BONE = 'Head';
/**
 * 帽子相对头骨的偏移与缩放（都在骨架局部空间）。
 * 缩放是「目标世界缩放」，实际会再除以宠物的放大倍数（父节点 3 倍），
 * 否则帽子会被连带放大到糊脸。偏移让它落在头顶而不是盖在脸上。
 */
const HAT_OFFSET_Y = 52;
const HAT_SCALE = 0.5;

@ccclass('PetStage')
export class PetStage extends Component {
  private petNode: Node | null = null;
  private bgNode: Node | null = null;
  private skeleton: sp.Skeleton | null = null;
  private placeholder: Graphics | null = null;
  private disposed = false;

  /** 挂载时按素材实际动画名解析出来的 idle / happy，react() 与状态同步都用这两个 */
  private idleAnim = '';
  private happyAnim = '';
  /** 骨架里所有动画名，react() 按互动动作挑动画时查它 */
  private animNames: string[] = [];
  /** 散步：走路 / 停顿站立动画，以及是否正在散步 */
  private walkAnim = '';
  private wanderIdle = '';
  private wandering = false;
  /** 拖拽用：被拎起 / 被抱住动画 */
  private holdPickAnim = '';
  private holdLoopAnim = '';
  /** 是否正在被拖拽 */
  private dragging = false;

  /** 背景 Sprite 与当前场景下标，供 cycleBackground 复用同一个节点只换图 */
  private bgSprite: Sprite | null = null;
  private bgIndex = 0;
  /** 前景遮挡层（叠在猫之上），随场景切换 */
  private fgNode: Node | null = null;
  private fgSprite: Sprite | null = null;
  /** 装修间地板层（墙由背景 Sprite 兼任），以及墙纸/地板贴块与当前下标 */
  private floorNode: Node | null = null;
  private floorSprite: Sprite | null = null;
  private wallTiles: SpriteFrame[] = [];
  private floorTiles: SpriteFrame[] = [];
  private wallIndex = 0;
  private floorIndex = 0;
  private decoLoaded = false;
  /** 顾客节点（Customer Spine + 名牌），toggleCustomer 控制 */
  private customerNode: Node | null = null;
  /** 全部可切换皮肤（编号皮肤）与当前下标 */
  private skinList: string[] = [];
  private skinIndex = 0;
  /** 帽子节点与它跟随的骨骼；update() 每帧把帽子对齐到骨骼世界位姿 */
  private hatNode: Node | null = null;
  private hatBone: ReturnType<sp.Skeleton['findBone']> | null = null;
  /** 当前舞台道具节点与它在 PROP_LIST 里的下标（-1 = 无） */
  private furnNode: Node | null = null;
  private propIndex = -1;

  /** 当前成长阶段缩放，react() 的挤压动画要从这个基准出发，而不是写死的 1 */
  private baseScale = 1;
  /** UI 预留给宠物那块区域的中心（frameTo 传入） */
  private centerY = 0;

  /**
   * 整个 onLoad 包在 try 里：MainView 是先挂本组件、再建 UI 的，
   * 这里一抛异常，后面的属性条和按钮就全都不会创建，界面只剩一片底色。
   * 舞台再重要也只是主视觉，不能连带把可操作的界面一起带走。
   */
  onLoad() {
    try {
      this.setupBackground();
      this.createPetNode();
      this.loadPet();
      store.on('pet', this.syncFromStore, this);
    } catch (err) {
      console.error('[PetStage] 2D 舞台初始化失败，界面继续可用', err);
    }
  }

  onDestroy() {
    this.disposed = true;
    store.off('pet', this.syncFromStore);
    if (this.petNode) Tween.stopAllByTarget(this.petNode);
    if (this.furnNode && this.furnNode.isValid) this.furnNode.destroy();
    if (this.customerNode && this.customerNode.isValid) this.customerNode.destroy();
    if (this.fgNode && this.fgNode.isValid) this.fgNode.destroy();
    if (this.bgNode && this.bgNode.isValid) this.bgNode.destroy();
    if (this.petNode && this.petNode.isValid) this.petNode.destroy();
  }

  // ---- 背景 ----

  /**
   * 恢复 UI 相机默认清屏（旧 3D 版把它改成了「只清深度」给 3D 相机让位），
   * 并铺一张全屏房间背景。背景失败时留纯色底，不影响宠物。
   */
  private setupBackground() {
    const scene = this.node.scene;
    const canvas = scene && scene.getComponentInChildren(Canvas);
    const cam = canvas && canvas.cameraComponent;
    if (cam) {
      cam.clearFlags = Camera.ClearFlag.SOLID_COLOR;
      cam.clearColor = COLOR.bg;
    }

    const size = view.getVisibleSize();
    const bg = new Node('StageBackground');
    bg.layer = Layers.Enum.UI_2D;
    const tr = bg.addComponent(UITransform);
    tr.setContentSize(size.width, size.height);
    bg.parent = this.node;
    // 背景要在最底层，宠物和 UI 都叠在它之上
    bg.setSiblingIndex(0);
    this.bgNode = bg;

    const sprite = bg.addComponent(Sprite);
    sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    sprite.type = Sprite.Type.SIMPLE;
    this.bgSprite = sprite;

    // 装修间地板层：只在 'deco' 场景显示，铺满屏幕下部。排在背景之上、宠物之下。
    const floor = new Node('DecoFloor');
    floor.layer = Layers.Enum.UI_2D;
    const floorTr = floor.addComponent(UITransform);
    floorTr.setContentSize(size.width, size.height * 0.4);
    floor.parent = this.node;
    floor.setSiblingIndex(1);
    floor.setPosition(0, -size.height / 2 + (size.height * 0.4) / 2, 0);
    const floorSprite = floor.addComponent(Sprite);
    floorSprite.sizeMode = Sprite.SizeMode.CUSTOM;
    floorSprite.type = Sprite.Type.SIMPLE;
    floor.active = false;
    this.floorNode = floor;
    this.floorSprite = floorSprite;

    // 前景层：排在宠物之后（更上层），但在 MainView 的 UI 之前
    const fg = new Node('StageForeground');
    fg.layer = Layers.Enum.UI_2D;
    fg.addComponent(UITransform);
    fg.parent = this.node;
    fg.setSiblingIndex(3);
    const fgSprite = fg.addComponent(Sprite);
    fgSprite.sizeMode = Sprite.SizeMode.TRIMMED;
    fgSprite.type = Sprite.Type.SIMPLE;
    this.fgNode = fg;
    this.fgSprite = fgSprite;

    this.bgIndex = Math.max(0, BG_LIST.indexOf(BG_NAME));
    this.applyBackground(BG_LIST[this.bgIndex]);
  }

  /** 按场景加载/隐藏前景遮挡层，并把它锚到屏幕底部。 */
  private applyForeground(bgName: string) {
    const fg = this.fgNode;
    const sprite = this.fgSprite;
    if (!fg || !sprite) return;
    const res = FG_MAP[bgName];
    if (!res) {
      fg.active = false;
      return;
    }
    resources.load(`bg_layers/${res}/spriteFrame`, SpriteFrame, (err, frame) => {
      if (this.disposed || !fg.isValid) return;
      if (err || !frame) {
        fg.active = false;
        return;
      }
      sprite.spriteFrame = frame;
      const w = frame.rect.width;
      const h = frame.rect.height;
      const size = view.getVisibleSize();
      // 很扁的当底部前景条铺满宽度；否则当道具，取屏高 ~46% 高
      const scale = w / h > 3 ? size.width / w : (size.height * 0.46) / h;
      fg.setScale(scale, scale, 1);
      // 默认锚点 0.5，让贴图底边贴屏幕底
      fg.setPosition(0, -size.height / 2 + (h * scale) / 2, 0);
      fg.active = true;
    });
  }

  /** 只换图不重建节点：cycleBackground 和初始化共用 */
  private applyBackground(name: string) {
    const sprite = this.bgSprite;
    if (!sprite) return;

    // 装修间：墙由背景 Sprite 铺整幅墙纸、地板由 floor 层铺，前景隐藏
    if (name === DECO_SCENE) {
      if (this.fgNode) this.fgNode.active = false;
      if (this.floorNode) this.floorNode.active = true;
      this.applyDecoTiles();
      return;
    }

    if (this.floorNode) this.floorNode.active = false;
    sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    resources.load(`bg/${name}/spriteFrame`, SpriteFrame, (err, frame) => {
      if (this.disposed || !this.bgNode || !this.bgNode.isValid) return;
      if (err || !frame) {
        // 软失败不死亡：拿不到背景图就保留相机纯色底
        console.warn(`[PetStage] 背景 ${name} 加载失败，保留纯色底`, err);
        return;
      }
      sprite.spriteFrame = frame;
    });
    this.applyForeground(name);
  }

  /** 首次进装修间时扫目录拿到全部墙纸/地板贴块（目录即「可选项清单」）。 */
  private ensureDecoTiles(cb: () => void) {
    if (this.decoLoaded) {
      cb();
      return;
    }
    resources.loadDir('deco_tiles/wall', SpriteFrame, (e1, walls) => {
      this.wallTiles = (walls as SpriteFrame[]) || [];
      resources.loadDir('deco_tiles/floor', SpriteFrame, (e2, floors) => {
        this.floorTiles = (floors as SpriteFrame[]) || [];
        this.decoLoaded = true;
        cb();
      });
    });
  }

  /** 把当前墙纸/地板贴到墙层与地板层。 */
  private applyDecoTiles() {
    this.ensureDecoTiles(() => {
      if (this.disposed) return;
      if (this.bgSprite && this.wallTiles.length) {
        this.bgSprite.spriteFrame = this.wallTiles[this.wallIndex % this.wallTiles.length];
      }
      if (this.floorSprite && this.floorTiles.length) {
        this.floorSprite.spriteFrame = this.floorTiles[this.floorIndex % this.floorTiles.length];
      }
    });
  }

  /** 换墙纸（只在装修间可见效果）。 */
  public cycleWallpaper(dir = 1) {
    this.ensureDecoTiles(() => {
      if (!this.wallTiles.length) return;
      this.wallIndex = (this.wallIndex + dir + this.wallTiles.length) % this.wallTiles.length;
      if (BG_LIST[this.bgIndex] === DECO_SCENE) this.applyDecoTiles();
    });
  }

  /** 换地板（只在装修间可见效果）。 */
  public cycleFloor(dir = 1) {
    this.ensureDecoTiles(() => {
      if (!this.floorTiles.length) return;
      this.floorIndex = (this.floorIndex + dir + this.floorTiles.length) % this.floorTiles.length;
      if (BG_LIST[this.bgIndex] === DECO_SCENE) this.applyDecoTiles();
    });
  }

  /** 循环切换场景背景（展示用）。 */
  public cycleBackground(dir = 1) {
    if (!BG_LIST.length) return;
    this.bgIndex = (this.bgIndex + dir + BG_LIST.length) % BG_LIST.length;
    this.applyBackground(BG_LIST[this.bgIndex]);
  }

  // ---- 宠物本体 ----

  private createPetNode() {
    const node = new Node('Pet');
    node.layer = Layers.Enum.UI_2D;
    const tr = node.addComponent(UITransform);
    // 给一个可点区域，否则触摸系统命中不到（骨骼渲染不撑 UITransform 尺寸）。
    // 尺寸是节点局部值，会再乘上宠物缩放(~3)，覆盖住整只猫。
    tr.setContentSize(PET_HIT_W, PET_HIT_H);
    node.parent = this.node;
    // 层级：背景(0) < 装修地板(1) < 宠物(2) < 前景(3) < MainView 的 UI(4+)
    node.setSiblingIndex(2);
    this.petNode = node;
    this.setupDrag(node);
  }

  /**
   * 让宠物可被拖到任意位置。
   * 触摸落点是 UI 世界坐标，转成父节点(Main)局部坐标再 setPosition。
   * 一开始拖就停掉自动散步，松手后停在手指处。
   */
  private setupDrag(node: Node) {
    const toLocal = (e: EventTouch) => {
      const ui = e.getUILocation();
      const parentTr = this.node.getComponent(UITransform);
      if (!parentTr) return null;
      return parentTr.convertToNodeSpaceAR(new Vec3(ui.x, ui.y, 0));
    };

    node.on(Node.EventType.TOUCH_START, (e: EventTouch) => {
      this.dragging = true;
      // 拖动期间不散步：停掉位移 tween，播「被拎起来 → 被抱住」
      this.stopWander();
      this.playHeld();
      const p = toLocal(e);
      if (p) node.setPosition(p.x, p.y, 0);
    }, this);

    node.on(Node.EventType.TOUCH_MOVE, (e: EventTouch) => {
      if (!this.dragging) return;
      const p = toLocal(e);
      if (p) node.setPosition(p.x, p.y, 0);
    }, this);

    const end = () => {
      if (!this.dragging) return;
      this.dragging = false;
      // 松手后从落点继续散步：以当前高度作为新的散步基准
      this.centerY = node.position.y;
      this.startWander();
    };
    node.on(Node.EventType.TOUCH_END, end, this);
    node.on(Node.EventType.TOUCH_CANCEL, end, this);
  }

  /** 停止散步：停位移 tween、复位缩放，不改动画（由调用方接着设）。 */
  private stopWander() {
    const pet = this.petNode;
    if (!pet) return;
    this.wandering = false;
    Tween.stopAllByTarget(pet);
    const s = Math.abs(this.baseScale) || 1;
    pet.setScale(s, s, 1);
  }

  /** 若未在散步则开始散步（拖放后恢复用）。 */
  private startWander() {
    if (!this.wandering && this.walkAnim) this.toggleWander();
  }

  /** 播「被拎起来」过渡，再接「被抱住」循环；缺失就退回站立 idle。 */
  private playHeld() {
    const skel = this.skeleton;
    if (!skel) return;
    if (this.holdPickAnim) {
      skel.setAnimation(0, this.holdPickAnim, false);
      if (this.holdLoopAnim) skel.addAnimation(0, this.holdLoopAnim, true, 0);
    } else if (this.holdLoopAnim) {
      skel.setAnimation(0, this.holdLoopAnim, true);
    } else if (this.wanderIdle) {
      skel.setAnimation(0, this.wanderIdle, true);
    }
  }

  private spineReady(): boolean {
    return !!(sp && (sp as unknown as { Skeleton?: unknown }).Skeleton && (sp as unknown as { SkeletonData?: unknown }).SkeletonData);
  }

  private loadPet() {
    const species = (store.petView && store.petView.species) || '';
    const name = SPECIES_SKELETON[species] || FALLBACK_SKELETON;

    // 引擎没编入 spine 模块（sp 为空）时直接走占位，别让 resources.load 拿一个
    // undefined 的类型去炸。等 settings/v2/packages/engine.json 开了 spine 并重导引擎
    // 后，这里才会真正加载骨架。
    if (!this.spineReady()) {
      console.warn('[PetStage] 引擎未编入 spine 模块，先用占位宠物。开启后需重新导入引擎');
      this.buildPlaceholder();
      this.syncFromStore();
      return;
    }

    resources.load(`${SPINE_DIR}/${name}`, sp.SkeletonData, (err, data) => {
      if (this.disposed) return;
      if (err || !data) {
        console.warn(`[PetStage] Spine 骨架 ${name} 加载失败，退回占位宠物`, err);
        this.buildPlaceholder();
        this.syncFromStore();
        return;
      }
      this.mountSkeleton(data);
      this.syncFromStore();
      // 默认自动散步：等 syncFromStore 设好基准缩放后再起步，朝向翻转才对
      if (AUTO_WANDER && this.walkAnim && !this.wandering) this.toggleWander();
    });
  }

  private mountSkeleton(data: sp.SkeletonData) {
    const pet = this.petNode;
    if (!pet) return;

    const skel = pet.addComponent(sp.Skeleton);
    skel.skeletonData = data;
    // 59 猫包的 PNG 是直通道(straight)alpha、未预乘：若按预乘混合，各部件透明边(RGB=白/α=0)
    // 会被算成实心白，一堆白矩形叠一起就是「四分五裂」的白框。自研素材若导出为预乘图集再改回 true。
    skel.premultipliedAlpha = false;
    this.skeleton = skel;

    const runtime = data.getRuntimeData && data.getRuntimeData();
    const animNames = runtime && runtime.animations ? runtime.animations.map((a) => a.name) : [];
    this.animNames = animNames;
    this.idleAnim = IDLE_CANDIDATES.find((n) => animNames.indexOf(n) >= 0) || '';
    this.happyAnim = HAPPY_CANDIDATES.find((n) => animNames.indexOf(n) >= 0) || '';
    this.walkAnim = WALK_CANDIDATES.find((n) => animNames.indexOf(n) >= 0) || '';
    this.wanderIdle = WANDER_IDLE_CANDIDATES.find((n) => animNames.indexOf(n) >= 0) || this.idleAnim;
    this.holdPickAnim = HOLD_PICK_CANDIDATES.find((n) => animNames.indexOf(n) >= 0) || '';
    this.holdLoopAnim = HOLD_LOOP_CANDIDATES.find((n) => animNames.indexOf(n) >= 0) || '';

    // 没有 default 皮肤的素材必须显式选皮肤，否则骨架没有任何附件、整只不可见
    const skinNames = runtime && runtime.skins ? runtime.skins.map((s) => s.name) : [];
    // 只收编号皮肤（001/002…），它们是整只完整皮肤；带斜杠的是部件子皮肤，不单独切
    this.skinList = skinNames.filter((n) => /^\d+$/.test(n));
    this.skinIndex = Math.max(0, this.skinList.indexOf(DEFAULT_SKIN));
    if (skinNames.indexOf(DEFAULT_SKIN) >= 0) {
      skel.setSkin(DEFAULT_SKIN);
    }

    // idle 循环播放。找不到 idle 时不硬塞，避免抛异常，交给日志排查
    if (this.idleAnim) {
      skel.setAnimation(0, this.idleAnim, true);
    } else {
      console.warn(`[PetStage] 骨架 ${data.name} 里找不到 idle 类动画（试过 ${IDLE_CANDIDATES.join('/')}），宠物会停在初始姿势`);
    }
  }

  /**
   * 占位宠物：Spine 资源还没到位时，用 Graphics 画一只简笔猫。
   * 没有骨骼，用节点级 tween 造出呼吸感——静止的图看着像贴纸，一点起伏就"活"了。
   */
  private buildPlaceholder() {
    const pet = this.petNode;
    if (!pet) return;

    const g = pet.addComponent(Graphics);
    this.placeholder = g;

    // 身体
    g.fillColor = FUR;
    g.ellipse(0, -6, 66, 52);
    g.fill();
    // 头
    g.circle(0, 58, 46);
    g.fill();
    // 耳朵（两个三角）
    g.moveTo(-40, 92);
    g.lineTo(-16, 58);
    g.lineTo(-52, 62);
    g.close();
    g.fill();
    g.moveTo(40, 92);
    g.lineTo(16, 58);
    g.lineTo(52, 62);
    g.close();
    g.fill();
    // 尾巴
    g.fillColor = FUR_DARK;
    g.ellipse(64, -18, 22, 12);
    g.fill();
    // 眼睛 + 鼻子
    g.fillColor = OUTLINE;
    g.circle(-16, 60, 6);
    g.fill();
    g.circle(16, 60, 6);
    g.fill();
    g.circle(0, 44, 4);
    g.fill();

    tween(pet)
      .repeatForever(
        tween<Node>()
          .to(1.4, { scale: new Vec3(this.baseScale * 1.03, this.baseScale * 0.97, 1) }, { easing: 'sineInOut' })
          .to(1.4, { scale: new Vec3(this.baseScale, this.baseScale, 1) }, { easing: 'sineInOut' }),
      )
      .start();
  }

  // ---- 取景与状态同步 ----

  /**
   * 把宠物摆到 UI 预留出来的那块空当中心。
   *
   * 旧 3D 版这里是移相机；2D 版直接移宠物节点。UI 坐标屏幕中心为 0、向上为正，
   * 正好可以直接当节点的 y。
   *
   * @param centerY    预留区域中心（UI 坐标）
   * @param _viewportH 当前可视高度（2D 下暂不需要，保留签名与调用方兼容）
   */
  public frameTo(centerY: number, _viewportH: number) {
    this.centerY = centerY;
    if (this.petNode) this.petNode.setPosition(0, centerY, 0);
  }

  private syncFromStore() {
    const pet = store.petView;
    const petNode = this.petNode;
    if (!pet || !petNode) return;

    const scale = STAGE_SCALE[pet.stage] || 1;
    this.baseScale = scale * BASE_SCALE;
    petNode.setScale(this.baseScale, this.baseScale, 1);

    if (this.skeleton) {
      this.skeleton.timeScale = STAGE_SPEED[pet.stage] || 1;
    }
  }

  // ---- 互动反馈 ----

  /**
   * 互动时晃一下，给点即时反馈。
   * 传入互动动作（feed/bath/pet/play）时优先播该动作对应的动画，播完接回 idle；
   * 不传或对应动画缺失就退回通用 happy。
   */
  public react(action?: string) {
    const pet = this.petNode;
    if (!pet) return;

    const base = this.baseScale;
    const squash = new Vec3(base * 1.12, base * 0.9, 1);
    const restore = new Vec3(base, base, 1);
    Tween.stopAllByTarget(pet);
    tween(pet)
      .to(0.1, { scale: squash }, { easing: 'quadOut' })
      .to(0.22, { scale: restore }, { easing: 'backOut' })
      .call(() => {
        // 占位宠物没骨骼，晃完把呼吸动画接回去
        if (!this.skeleton && !this.disposed) this.resumePlaceholderIdle();
      })
      .start();

    if (this.skeleton) {
      const cands = (action && ACTION_ANIM[action]) || [];
      const name = cands.find((n) => this.animNames.indexOf(n) >= 0) || this.happyAnim;
      if (name) {
        this.skeleton.setAnimation(0, name, false);
        if (this.idleAnim) this.skeleton.addAnimation(0, this.idleAnim, true, 0);
      }
    }
  }

  private resumePlaceholderIdle() {
    const pet = this.petNode;
    if (!pet || this.skeleton) return;
    tween(pet)
      .repeatForever(
        tween<Node>()
          .to(1.4, { scale: new Vec3(this.baseScale * 1.03, this.baseScale * 0.97, 1) }, { easing: 'sineInOut' })
          .to(1.4, { scale: new Vec3(this.baseScale, this.baseScale, 1) }, { easing: 'sineInOut' }),
      )
      .start();
  }

  // ---- 展示能力：换皮肤 / 家具 / 帽子挂点 ----

  /** 循环切换到下一/上一只猫（编号皮肤）。换皮后重播 idle，确保新皮附件刷新。 */
  public cycleSkin(dir = 1): string {
    const skel = this.skeleton;
    if (!skel || !this.skinList.length) return '';
    this.skinIndex = (this.skinIndex + dir + this.skinList.length) % this.skinList.length;
    const name = this.skinList[this.skinIndex];
    skel.setSkin(name);
    if (this.idleAnim) skel.setAnimation(0, this.idleAnim, true);
    return name;
  }

  /**
   * 循环切换舞台道具：每点一次换 PROP_LIST 里的下一个（家具 / 站点 / 特效），
   * 走到末尾再点一次清空。每个道具直接循环播它自己的第一个动画。
   */
  public cycleProp() {
    // 先移除当前道具
    if (this.furnNode) {
      if (this.furnNode.isValid) this.furnNode.destroy();
      this.furnNode = null;
    }
    // 推进下标：-1(无) → 0..N-1 → -1
    this.propIndex = this.propIndex + 1 >= PROP_LIST.length ? -1 : this.propIndex + 1;
    if (this.propIndex < 0 || !this.spineReady()) return;

    const res = PROP_LIST[this.propIndex];
    const node = new Node('Prop');
    node.layer = Layers.Enum.UI_2D;
    node.addComponent(UITransform);
    node.parent = this.node;
    // 背景之上、宠物旁边的地面高度
    node.setSiblingIndex(1);
    node.setPosition(210, this.centerY - 150, 0);
    node.setScale(1.4, 1.4, 1);
    this.furnNode = node;

    resources.load(`${SPINE_DIR}/${res}`, sp.SkeletonData, (err, data) => {
      if (this.disposed || !node.isValid) return;
      if (err || !data) {
        console.warn(`[PetStage] 道具 ${res} 加载失败，跳过`, err);
        node.destroy();
        this.furnNode = null;
        return;
      }
      const skel = node.addComponent(sp.Skeleton);
      skel.skeletonData = data;
      skel.premultipliedAlpha = false;
      // 道具动画名未知，直接取第一个循环播
      const rt = data.getRuntimeData && data.getRuntimeData();
      const anims = rt && rt.animations ? rt.animations.map((a) => a.name) : [];
      if (anims.length) skel.setAnimation(0, anims[0], true);
    });
  }

  // ---- 散步（自动来回走动）----

  /** 走某一段：先转向+起步走，位移到位后停下站立。dir<0 向左（翻转朝向），dir>0 向右。 */
  private walkSegment(x: number, dir: number, dur: number) {
    return tween<Node>()
      .call(() => this.faceWalk(dir))
      .to(dur, { position: new Vec3(x, this.centerY, 0) }, { easing: 'linear' })
      .call(() => this.pauseIdle());
  }

  /** 转向并起步走：按方向翻转 scale.x（走路动画默认朝右），播 Walk。 */
  private faceWalk(dir: number) {
    const pet = this.petNode;
    const skel = this.skeleton;
    if (!pet) return;
    const s = Math.abs(this.baseScale) || 1;
    // Walk 动画默认朝左，所以往右走(dir>0)才翻转
    pet.setScale(dir >= 0 ? -s : s, s, 1);
    if (skel && this.walkAnim) skel.setAnimation(0, this.walkAnim, true);
  }

  /** 到点停下时播站立 idle（不是睡觉）。 */
  private pauseIdle() {
    const skel = this.skeleton;
    if (skel && this.wanderIdle) skel.setAnimation(0, this.wanderIdle, true);
  }

  /**
   * 开/关「自动散步」：中间 → 左 → 右 → 回中间，循环往复。
   * 走动用 Walk 动画 + 节点位移，到端点停一下换站立 idle。再点一次停下、回中间、恢复原待机。
   */
  public toggleWander() {
    const pet = this.petNode;
    const skel = this.skeleton;
    if (!pet) return;

    if (this.wandering) {
      this.wandering = false;
      Tween.stopAllByTarget(pet);
      const s = Math.abs(this.baseScale) || 1;
      pet.setScale(s, s, 1);
      pet.setPosition(WANDER_CENTER, this.centerY, 0);
      if (skel && this.idleAnim) skel.setAnimation(0, this.idleAnim, true);
      return;
    }

    if (!skel || !this.walkAnim) {
      console.warn('[PetStage] 骨架没有 Walk 动画，无法散步');
      return;
    }
    this.wandering = true;
    Tween.stopAllByTarget(pet);
    tween(pet)
      .repeatForever(
        tween<Node>()
          .then(this.walkSegment(WANDER_LEFT, -1, 1.4))
          .delay(0.6)
          .then(this.walkSegment(WANDER_RIGHT, 1, 2.6))
          .delay(0.6)
          .then(this.walkSegment(WANDER_CENTER, -1, 1.4))
          .delay(0.8),
      )
      .start();
  }

  /**
   * 戴上/摘下帽子（2D 挂点演示）。
   * Spine 没有 3D 那种 socket，这里的做法是：建一个挂帽子贴图的子节点，
   * 在 update() 里每帧读头骨的世界位姿，把节点对齐过去——效果等价于挂点。
   */
  public toggleHat() {
    if (this.hatNode) {
      if (this.hatNode.isValid) this.hatNode.destroy();
      this.hatNode = null;
      this.hatBone = null;
      return;
    }
    const pet = this.petNode;
    const skel = this.skeleton;
    if (!pet || !skel) return;
    const bone = skel.findBone(HAT_BONE);
    if (!bone) {
      console.warn(`[PetStage] 找不到骨骼 ${HAT_BONE}，无法挂帽子`);
      return;
    }
    this.hatBone = bone;

    const node = new Node('Hat');
    node.layer = Layers.Enum.UI_2D;
    node.addComponent(UITransform);
    node.parent = pet;
    // 扣掉父节点（宠物）的放大倍数，得到真正的目标世界大小
    const s = HAT_SCALE / (this.baseScale || 1);
    node.setScale(s, s, 1);
    const sprite = node.addComponent(Sprite);
    sprite.sizeMode = Sprite.SizeMode.TRIMMED;
    resources.load(HAT_RES, SpriteFrame, (err, frame) => {
      if (!node.isValid) return;
      if (err || !frame) {
        console.warn('[PetStage] 帽子贴图加载失败', err);
        return;
      }
      sprite.spriteFrame = frame;
    });
    this.hatNode = node;
  }

  /**
   * 顾客上门（顾客系统演示）：显示/隐藏 Customer Spine，并挂一块名牌显示模拟的顾客信息。
   * 数据来自 showcaseData.randomCustomer()——真实产品里换成后端「顾客到访」事件即可。
   */
  public toggleCustomer() {
    if (this.customerNode) {
      if (this.customerNode.isValid) this.customerNode.destroy();
      this.customerNode = null;
      return;
    }
    if (!this.spineReady()) return;

    const node = new Node('Customer');
    node.layer = Layers.Enum.UI_2D;
    node.addComponent(UITransform);
    node.parent = this.node;
    node.setSiblingIndex(2);
    node.setPosition(-210, this.centerY - 120, 0);
    node.setScale(0.9, 0.9, 1);
    this.customerNode = node;

    resources.load('spine/Customer/Customer', sp.SkeletonData, (err, data) => {
      if (this.disposed || !node.isValid) return;
      if (err || !data) {
        console.warn('[PetStage] 顾客骨架加载失败', err);
        node.destroy();
        this.customerNode = null;
        return;
      }
      const skel = node.addComponent(sp.Skeleton);
      skel.skeletonData = data;
      skel.premultipliedAlpha = false;
      const rt = data.getRuntimeData && data.getRuntimeData();
      const anims = rt && rt.animations ? rt.animations.map((a) => a.name) : [];
      if (anims.length) skel.setAnimation(0, anims[0], true);

      // 名牌：模拟后端下发的顾客信息
      const c = randomCustomer();
      const label = makeLabel(`${c.name}  想要「${c.order}」`, node, {
        size: 26,
        color: COLOR.title,
        align: 'center',
        bold: true,
      });
      label.node.setPosition(0, 220, 0);
    });
  }

  /** 每帧把帽子对齐到头骨的世界位姿（骨骼坐标与 petNode 局部空间同源）。 */
  update() {
    const node = this.hatNode;
    const bone = this.hatBone;
    if (!node || !bone || !node.isValid) return;
    node.setPosition(bone.worldX, bone.worldY + HAT_OFFSET_Y, 0);
    // 从骨骼世界矩阵取旋转角（度），让帽子跟着头一起歪
    const rot = (Math.atan2(bone.c, bone.a) * 180) / Math.PI;
    node.setRotationFromEuler(0, 0, rot);
  }
}
