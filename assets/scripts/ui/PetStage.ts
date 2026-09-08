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
 *
 * 主角是**四足猫**（2026-09-07 定，拟人主宠不做）。猫狗共用一套四足骨架，
 * 差异只在网格剪影和花色贴图上，所以 dog 到位后动画和配饰都不用重做（docs/06 §5.1）。
 * 兜底指向猫：dog 骨架还没产出时，认不出的 species 一律显示猫，而不是空舞台。
 */
const SPECIES_SKELETON: Record<string, string> = { cat: 'pet_cat/Cat', dog: 'pet_dog' };
const FALLBACK_SKELETON = 'pet_cat/Cat';

/** Spine 资源统一放在 resources/spine/ 下，运行时按名字加载 SkeletonData 子资源 */
const SPINE_DIR = 'spine';
/**
 * 动画名兜底候选：自研素材会统一用小写 idle/happy；接入的现成素材（如 59 猫包）
 * 用的是 Idle / Pers_Playful 这类命名。按顺序取第一个存在的，省得逐个改素材。
 *
 * 清醒的 idle 必须排在睡姿之前。玩家打开游戏时看到的是这个动画，
 * 睡着的猫读起来是「它不需要我」，和养成品类要的「它在等我」正好相反。
 * Sleep_A 只作最后兜底——真没有别的循环动画时，睡着也好过定格在初始姿势。
 */
const IDLE_CANDIDATES = ['idle', 'Idle', 'Sit_Idle', 'Idle3', 'Sleep_A'];
const HAPPY_CANDIDATES = ['happy', 'Pers_Playful', 'A_Play', 'Stand_Pat'];
/** 散步用：走路动画 + 到点停下的站立 idle（不用 Sleep，睡着走看着怪） */
const WALK_CANDIDATES = ['Walk', 'Walk2', 'Walk_2', 'walk'];
const WANDER_IDLE_CANDIDATES = ['Idle', 'Sit_Idle', 'idle', 'Stretch'];
/** 拖拽用：被拎起来的过渡动作 + 被抱住的循环姿势 */
const HOLD_PICK_CANDIDATES = ['Stand_Hold_Pick_Up', 'Floor_Hold_Pick_Up', 'X_Chair_Pick_Up'];
const HOLD_LOOP_CANDIDATES = ['Stand_Hold', 'Floor_Hold', 'Stand_Hold_Hug', 'Stand_Hold_Sleep'];

/**
 * 顾客「站立等待」类姿势候选（轻量版换外观用）。只挑不依赖椅子/地板家具的独立动画，
 * 每次到访随机取一个存在的，制造「不同顾客不同表现」；都不存在就退回骨架第一个动画。
 */
const CUSTOMER_POSE_CANDIDATES = ['Idle', 'Idle3', 'Wait', 'Tap_Wait', 'Tap_Wait2', 'Look_Down', 'Idle_Look_Down'];

/**
 * 顾客换色调用的槽位分组。素材只有一套长相（换装数据在 Unity 侧、拿不到），
 * 于是退一步用 Spine 原生的「按槽位染色」做出肤色/发色/衣服色的粗略区分。
 * 只列真实存在的槽位名（从骨架里解析得到）；运行时 findSlot 找不到的会自动跳过。
 */
const CUSTOMER_SKIN_SLOTS = [
  'Head', 'Ear', 'Neck_A', 'Neck_B', 'Nose', 'Body_Skin',
  'L_Arm_A_Skin', 'L_Arm_B_Skin', 'R_Arm_A_Skin', 'R_Arm_B_Skin', 'R_Arm_Skin',
  'L_Leg_A_Skin', 'L_Leg_B_Skin', 'R_Leg_A_Skin', 'R_Leg_B_Skin',
  'L_Hand', 'L_Hand_Normal', 'L_Hand_Normal_2', 'L_Hand_Open', 'L_Hand_Cheek', 'L_Hand_Sit', 'L_Hand_Sit_B',
  'R_Hand', 'R_Hand_Normal', 'R_Hand_Open', 'R_Hand_Cheek', 'R_Hand_Sit', 'R_Hand_Sit_B',
  'L_Foot', 'R_Foot',
];
const CUSTOMER_HAIR_SLOTS = ['Hair', 'Hair_Back_Long', 'Hair_Back_Mid', 'L_Brow', 'R_Brow', 'Beard'];
const CUSTOMER_CLOTH_SLOTS = [
  'Body', 'Body_B', 'Collar', 'L_Shoulder', 'R_Shoulder', 'L_Arm_Sleeve', 'R_Arm_Sleeve',
  'Bottom', 'Skirt', 'Skirt_2', 'L_Leg_A_Pants', 'L_Leg_B_Pants', 'R_Leg_A_Pants', 'R_Leg_B_Pants',
];

/**
 * 预设色（0~255）。槽位染色是**乘法**混合：颜色乘在原图上，只能压暗、不能提亮，
 * 所以肤色这类都取偏浅的值，避免整块发黑。第一项接近原色（等于「不改」）。
 */
const CUSTOMER_SKIN_TONES = [
  [255, 255, 255], [246, 224, 205], [232, 194, 166], [206, 158, 126], [166, 118, 90], [122, 84, 63],
];
const CUSTOMER_HAIR_TONES = [
  [255, 255, 255], [214, 196, 176], [176, 138, 96], [150, 96, 62], [96, 72, 62], [70, 64, 66], [186, 138, 154],
];
const CUSTOMER_CLOTH_TONES = [
  [255, 255, 255], [214, 226, 236], [196, 216, 198], [236, 212, 196], [222, 196, 214], [200, 204, 226], [232, 226, 190],
];

/** 从预设色表里随机取一组 */
function pickTone(tones: number[][]): number[] {
  return tones[Math.floor(Math.random() * tones.length)];
}

/**
 * 顾客换色调（轻量版）：素材只有一套长相，用「按槽正片叠底染色」做出几档肤色/衣服色。
 * 数值是乘算 tint（0~255），底图已带色所以只能往深/偏色调，做不了更白（这是素材限制，非引擎限制）。
 * 头发是黑色，乘算染不动，故不染。RegionToColorWeights 是 Unity 二进制读不了，这里用手挑预设。
 */
const CUSTOMER_SKIN_TINTS: number[][] = [
  [255, 255, 255], // 原肤色
  [244, 224, 206], // 白净
  [232, 196, 168], // 暖调
  [210, 168, 138], // 小麦
  [180, 138, 108], // 深肤
  [255, 222, 210], // 红润
];
const CUSTOMER_CLOTH_TINTS: number[][] = [
  [255, 255, 255], // 原蓝
  [178, 152, 210], // 偏紫
  [150, 176, 212], // 偏靛
  [170, 206, 206], // 偏青
  [156, 156, 164], // 灰
];
/** 皮肤槽（头/耳/脖/手/脚/身体皮肤）与衣服槽（上衣/袖/肩/下装/腰带/领）的名字特征 */
const SKIN_SLOT_RE = /Skin|Head|Ear|Neck|Foot|Hand/;
const CLOTH_SLOT_RE = /Body|Bottom|Belt|Collar|Sleeve|Shoulder|Skirt|Pant/;

/**
 * 拖拽时宠物**向上**的可移动范围（相对基准高度）。向下的下限不用这个值，
 * 而是由 MainView 按状态面板的真实位置传进来——写死一个数字的话，
 * 要么像之前那样把猫压到面板下面只露头顶，要么反过来限制得过死、拖不到地面。
 */
const DRAG_UP_RANGE = 120;

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
 *
 * 按 docs/宠物Spine骨骼原理与外包说明.md §10 的「玩法需求 ↔ 现成动画」对照表排序：
 * 专门为该玩法做的 Minigame_* 放最前，通用坐姿动作只作兜底。
 */
const ACTION_ANIM: Record<string, string[]> = {
  feed: ['Minigame_Treat_Correct', 'Knead', 'Sit_Lick_Hand'],
  bath: ['Minigame_Brush', 'Sit_Lick_Leg'],
  pet: ['Minigame_Belly_Rub', 'Minigame_Neck_Rub', 'Stand_Pat', 'Pers_Cuddly'],
  play: ['Int_Butterfly', 'Standing_Toy', 'A_Play', 'Pers_Playful'],
};

/**
 * 小游戏类动画带前摇/后摇（`_Pre` 凑过来 → 主体 → `_Post` 回味）。
 * 存在就串起来播，让互动有「起手—进行—收尾」的节奏，而不是单段硬切回 idle。
 * 命名规律见文档 §10：`Minigame_Belly_Rub` / `_Pre` / `_Post`、`Stand_Pat` / `_Pre` / `_Post`。
 */
const PRE_SUFFIXES = ['_Pre', '_Pre_2'];
const POST_SUFFIXES = ['_Post', '_Post2', '_Post_2'];

/**
 * 刷毛有 5 段强度（`Minigame_Brush` / `_2`…`_5`）。连续点「洗澡」时逐级递进，
 * 表现出「越刷越舒服」，而不是每次都播同一段。
 */
const BRUSH_STAGES = ['Minigame_Brush', 'Minigame_Brush_2', 'Minigame_Brush_3', 'Minigame_Brush_4', 'Minigame_Brush_5'];

/** 等投喂的待机（喂食前的期待感）：Minigame_Treat_Idle / 2 / 3 */
const TREAT_IDLE_CANDIDATES = ['Minigame_Treat_Idle', 'Minigame_Treat_Idle2', 'Minigame_Treat_Idle3'];

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
 * 场景陈设（`resources/bg_layers/` 里剩下那批）。都是家具/陈设图：
 * `Cat_*` 是猫用吧台/柜台，`Human_*` 是人用柜台/工作台，另有餐盘罩、包裹等道具。
 *
 * 摆在**背景之上、宠物之下**（贴着墙根），当可循环的房间装饰用。
 * 与 FG_MAP 的前景条不同：前景条压在猫**前面**做遮挡，这里是猫**后面**的陈设。
 */
const DECOR_MAP: Record<string, string[]> = {
  bg_kitchen: [
    'Kitchen_Cat_1', 'Kitchen_Cat_2', 'Kitchen_Cat_3', 'Kitchen_Cat_4', 'Kitchen_Cat_5',
    'Kitchen_Human_1', 'Kitchen_Human_2', 'Kitchen_Human_3', 'Kitchen_Human_4', 'Kitchen_Human_5',
    'Kitchen_Cloche',
  ],
  bg_greenhouse: [
    'Greenhouse_Cat_1', 'Greenhouse_Cat_2', 'Greenhouse_Cat_3', 'Greenhouse_Cat_4', 'Greenhouse_Cat_5',
    'Greenhouse_Human_1', 'Greenhouse_Human_2', 'Greenhouse_Human_3', 'Greenhouse_Human_4', 'Greenhouse_Human_5',
    'Greenhouse_Package', 'Greenhouse_Table',
  ],
  bg_workshop: [
    'Workshop_Cat_1', 'Workshop_Cat_2', 'Workshop_Cat_3', 'Workshop_Cat_4', 'Workshop_Cat_5',
    'Workshop_Human_1', 'Workshop_Human_2', 'Workshop_Human_3', 'Workshop_Human_4', 'Workshop_Human_5',
    'Workshop_Package',
  ],
};

/** 陈设显示高度占屏高的比例（家具原图尺寸差异大，统一按高度归一） */
const DECOR_H_RATIO = 0.3;

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
  'Box/Box',
];
/**
 * 饰品目录（2D 挂点：让一个 Sprite 每帧跟随头骨）。目录即清单——
 * 用 loadDir 扫 resources/deco/accessory 下全部帽子/眼镜，别手写文件名。
 */
const ACCESSORY_DIR = 'deco/accessory';
const HAT_BONE = 'Head';
/**
 * 帽子相对头骨的偏移与缩放（都在骨架局部空间）。
 * 缩放是「目标世界缩放」，实际会再除以宠物的放大倍数（父节点 3 倍），
 * 否则帽子会被连带放大到糊脸。
 *
 * OFFSET_Y 沿头骨自身的「上」方向加（不是屏幕正上方），这样歪头时帽子不会飘出去。
 * 59 猫包的 Head 骨骼原点在颈部附近、略偏一侧，所以还要一点横向补偿才落在头顶正中。
 */
/**
 * 偏移按**骨架局部尺度**给（本素材 Head 骨实测在 (18, 37)，Head 附件原图 136×114，
 * 附件以骨骼为中心摆放 → 头顶约在 37 + 114/2 ≈ 94）。
 * 帽子贴在头顶略往下一点压住发际线更自然，所以取 50 上下而不是贴到 94。
 */
const HAT_OFFSET_Y = 52;
const HAT_OFFSET_X = 0;
/**
 * 帽子原图按人头画的（约 300~450 px 宽），而猫头只有 136 单位宽，
 * 所以缩到 ~0.35 才和猫头差不多等宽。这个值就在骨架局部空间里直接用，
 * 不要再除以 petNode 的缩放（位置也用的是骨骼局部坐标，两者必须同一空间）。
 */
const HAT_SCALE = 0.35;

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
  /** 刷毛强度阶段（0..4），连续点「洗澡」时逐级推进 */
  private brushStage = -1;
  /** 上一次互动实际排上的动画链，供界面显示确认（动画差异不易肉眼分辨） */
  private lastActionChain: string[] = [];
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
  /** 场景陈设层（猫身后的家具），按场景一组、可循环切换 */
  private decorNode: Node | null = null;
  private decorSprite: Sprite | null = null;
  private decorIndex = -1;
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
  /**
   * 当前顾客的骨架与随机色调。动画里若带槽位颜色关键帧，会每帧覆盖掉我们设的颜色，
   * 所以 update() 里持续重涂一次兜底（槽位数不多，开销可忽略）。
   */
  private customerSkel: sp.Skeleton | null = null;
  private customerTones: { slots: string[]; rgb: number[] }[] = [];
  /** 全部可切换皮肤（编号皮肤）与当前下标 */
  private skinList: string[] = [];
  private skinIndex = 0;
  /** 帽子节点与它跟随的骨骼；update() 每帧把帽子对齐到骨骼世界位姿 */
  private hatNode: Node | null = null;
  private hatBone: ReturnType<sp.Skeleton['findBone']> | null = null;
  /** 全部饰品贴图与当前下标（-1 = 不戴）。首次点击时 loadDir 扫一次后缓存 */
  private accessories: SpriteFrame[] = [];
  private accessoryIndex = -1;
  private accessoriesLoaded = false;
  /** 当前舞台道具节点与它在 PROP_LIST 里的下标（-1 = 无） */
  private furnNode: Node | null = null;
  private propIndex = -1;

  /** 当前成长阶段缩放，react() 的挤压动画要从这个基准出发，而不是写死的 1 */
  private baseScale = 1;
  /** UI 预留给宠物那块区域的中心（frameTo 传入） */
  private centerY = 0;
  /** UI 给的原始基准高度，拖拽落点以它为中心做区间约束（centerY 会被拖拽改写，它不会） */
  private homeY = 0;
  /** 宠物可以被拖到的最低高度（状态面板上沿附近），由 frameTo 传入 */
  private minY = -Number.MAX_SAFE_INTEGER;

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
    this.customerSkel = null;
    this.customerTones = [];
    if (this.customerNode && this.customerNode.isValid) this.customerNode.destroy();
    if (this.decorNode && this.decorNode.isValid) this.decorNode.destroy();
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

    // 陈设层：背景之上、宠物之下，贴墙根摆家具
    const decor = new Node('StageDecor');
    decor.layer = Layers.Enum.UI_2D;
    decor.addComponent(UITransform);
    decor.parent = this.node;
    decor.setSiblingIndex(2);
    const decorSprite = decor.addComponent(Sprite);
    decorSprite.sizeMode = Sprite.SizeMode.TRIMMED;
    decorSprite.type = Sprite.Type.SIMPLE;
    decor.active = false;
    this.decorNode = decor;
    this.decorSprite = decorSprite;

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

  /**
   * 换墙纸。墙纸/地板只有「装修间」场景才铺得出来（成品房间背景是整幅画，
   * 墙和地分不开），所以不在装修间时先自动切过去——否则点了毫无反应，
   * 玩家没法知道是「坏了」还是「场景不对」。
   */
  public cycleWallpaper(dir = 1) {
    this.enterDecoScene();
    this.ensureDecoTiles(() => {
      if (!this.wallTiles.length) return;
      this.wallIndex = (this.wallIndex + dir + this.wallTiles.length) % this.wallTiles.length;
      this.applyDecoTiles();
    });
  }

  /** 换地板。同 cycleWallpaper：不在装修间时自动切过去。 */
  public cycleFloor(dir = 1) {
    this.enterDecoScene();
    this.ensureDecoTiles(() => {
      if (!this.floorTiles.length) return;
      this.floorIndex = (this.floorIndex + dir + this.floorTiles.length) % this.floorTiles.length;
      this.applyDecoTiles();
    });
  }

  /**
   * 循环切换当前场景的陈设：每点一次换下一件家具，走到末尾再点一次清空。
   * 装修间没有配套陈设图（它是纯墙+地板），所以在那里点会提示并跳过。
   */
  public cycleDecor(dir = 1) {
    const list = DECOR_MAP[BG_LIST[this.bgIndex]] || [];
    if (!list.length) {
      if (this.decorNode) this.decorNode.active = false;
      this.decorIndex = -1;
      return;
    }
    // 推进下标：-1(无) → 0..N-1 → -1
    this.decorIndex = this.decorIndex + dir >= list.length ? -1 : this.decorIndex + dir;
    this.applyDecor();
  }

  /** 按当前下标贴陈设图；下标 -1 时隐藏 */
  private applyDecor() {
    const node = this.decorNode;
    const sprite = this.decorSprite;
    if (!node || !sprite) return;

    const list = DECOR_MAP[BG_LIST[this.bgIndex]] || [];
    if (this.decorIndex < 0 || !list.length) {
      node.active = false;
      return;
    }
    const res = list[this.decorIndex];
    resources.load(`bg_layers/${res}/spriteFrame`, SpriteFrame, (err, frame) => {
      if (this.disposed || !node.isValid) return;
      if (err || !frame) {
        console.warn(`[PetStage] 陈设 ${res} 加载失败，跳过`, err);
        node.active = false;
        return;
      }
      sprite.spriteFrame = frame;
      // 家具原图尺寸差异大，按屏高比例归一，再把底边贴到地面高度
      const size = view.getVisibleSize();
      const scale = (size.height * DECOR_H_RATIO) / frame.rect.height;
      node.setScale(scale, scale, 1);
      const h = frame.rect.height * scale;
      node.setPosition(-size.width * 0.24, -size.height / 2 + size.height * 0.3 + h / 2, 0);
      node.active = true;
    });
  }

  /** 当前陈设序号（1-based，0 = 无）与本场景陈设总数，供展示层显示 */
  public get decorNo(): number {
    return this.decorIndex + 1;
  }
  public get decorCount(): number {
    return (DECOR_MAP[BG_LIST[this.bgIndex]] || []).length;
  }

  /** 若当前不在装修间，切到装修间（墙纸/地板才有承载） */
  private enterDecoScene() {
    if (BG_LIST[this.bgIndex] === DECO_SCENE) return;
    const i = BG_LIST.indexOf(DECO_SCENE);
    if (i < 0) return;
    this.bgIndex = i;
    this.applyBackground(DECO_SCENE);
  }

  /** 循环切换场景背景（展示用）。 */
  public cycleBackground(dir = 1) {
    if (!BG_LIST.length) return;
    this.bgIndex = (this.bgIndex + dir + BG_LIST.length) % BG_LIST.length;
    this.applyBackground(BG_LIST[this.bgIndex]);
    // 陈设是按场景分组的，换场景后旧陈设不属于新场景，清掉重新开始
    this.decorIndex = -1;
    this.applyDecor();
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
      if (p) node.setPosition(p.x, this.clampStageY(p.y), 0);
    }, this);

    node.on(Node.EventType.TOUCH_MOVE, (e: EventTouch) => {
      if (!this.dragging) return;
      const p = toLocal(e);
      if (p) node.setPosition(p.x, this.clampStageY(p.y), 0);
    }, this);

    const end = () => {
      if (!this.dragging) return;
      this.dragging = false;
      // 松手后从落点继续散步：以当前高度作为新的散步基准，
      // 但要夹在基准高度附近，别让宠物停在底部面板下面只露个头
      this.centerY = this.clampStageY(node.position.y);
      node.setPosition(node.position.x, this.centerY, 0);
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
  public frameTo(centerY: number, _viewportH: number, minY?: number) {
    this.centerY = centerY;
    // 记住 UI 给的基准高度：拖拽落点要以它为中心做区间约束，
    // 否则往下一拖就把散步基准永久压到底部面板下面，宠物再也回不来。
    this.homeY = centerY;
    if (typeof minY === 'number') this.minY = minY;
    if (this.petNode) this.petNode.setPosition(0, centerY, 0);
  }

  /**
   * 把落点高度夹在允许范围内：向上不超出基准一段距离（别顶进顶部信息栏），
   * 向下不低于 minY（状态面板上沿附近，由 MainView 按真实布局给），
   * 这样猫能一直拖到地面、又不会沉到面板底下只露头顶。
   */
  private clampStageY(y: number): number {
    const hi = this.homeY + DRAG_UP_RANGE;
    return Math.min(hi, Math.max(this.minY, y));
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

    if (this.skeleton) this.lastActionChain = this.playActionChain(action);
  }

  /**
   * 播一次互动动画链：`_Pre`（起手，可选）→ 主体 → `_Post`（收尾，可选）→ idle。
   * 用 addAnimation 排队，Spine 会按顺序接着播，不需要自己算时长。
   *
   * 返回实际排上的动画名序列，供上层显示「这次播了什么」——
   * 动画差异在小屏上不易察觉，没有反馈的话根本分不清有没有生效。
   */
  private playActionChain(action?: string): string[] {
    const skel = this.skeleton;
    if (!skel) return [];

    const has = (n: string) => this.animNames.indexOf(n) >= 0;
    const cands = (action && ACTION_ANIM[action]) || [];
    let main = cands.find(has) || this.happyAnim;

    // 洗澡：连续点逐级推进刷毛强度（1→5 循环），表现「越刷越舒服」
    if (action === 'bath') {
      const stages = BRUSH_STAGES.filter(has);
      if (stages.length) {
        this.brushStage = (this.brushStage + 1) % stages.length;
        main = stages[this.brushStage];
      }
    }
    if (!main) return [];

    const chain: string[] = [];

    // 前摇：优先找主体动画的 _Pre 变体
    const pre = PRE_SUFFIXES.map((s) => main + s).find(has);
    if (pre) {
      skel.setAnimation(0, pre, false);
      skel.addAnimation(0, main, false, 0);
      chain.push(pre, main);
    } else {
      skel.setAnimation(0, main, false);
      chain.push(main);
    }

    // 后摇：主体播完接一段回味
    const post = POST_SUFFIXES.map((s) => main + s).find(has);
    if (post) {
      skel.addAnimation(0, post, false, 0);
      chain.push(post);
    }

    // 喂食后先摆一会儿「等投喂」的期待姿势，再回 idle
    if (action === 'feed') {
      const treatIdle = TREAT_IDLE_CANDIDATES.find(has);
      if (treatIdle) {
        skel.addAnimation(0, treatIdle, false, 0);
        chain.push(treatIdle);
      }
    }

    if (this.idleAnim) skel.addAnimation(0, this.idleAnim, true, 0);
    return chain;
  }

  /** 上一次互动实际播的动画链（调试/演示用，显示在界面上确认动画生效） */
  public get lastChain(): string[] {
    return this.lastActionChain;
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
    // setSkin 已把槽位设回 setup pose，但多页 atlas 下保险起见重播 idle 刷新一次附件
    if (this.idleAnim) skel.setAnimation(0, this.idleAnim, true);
    return name;
  }

  /** 可切换皮肤总数（供展示层显示「第几只 / 共几只」）。0 表示骨架未就绪或无编号皮肤。 */
  public get skinCount(): number {
    return this.skinList.length;
  }

  /** 当前皮肤序号（1-based，便于直接显示）。无皮肤时返回 0。 */
  public get currentSkinNo(): number {
    return this.skinList.length ? this.skinIndex + 1 : 0;
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
      const rt = data.getRuntimeData && data.getRuntimeData();
      // 有的道具（如 Box）和顾客一样：default 皮肤是空的，部件都在命名皮肤里，
      // 不选皮肤就只出影子/不出图。取第一个非 default 皮肤兜底；没有命名皮肤时是无操作。
      const skinNames = rt && rt.skins ? rt.skins.map((s) => s.name) : [];
      const skin = skinNames.find((n) => n && n !== 'default') || '';
      if (skin) skel.setSkin(skin);
      // 道具动画名未知，直接取第一个循环播
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
    this.ensureAccessories(() => {
      if (!this.accessories.length) {
        console.warn(`[PetStage] ${ACCESSORY_DIR} 下没有饰品贴图`);
        return;
      }
      // 推进下标：-1(不戴) → 0..N-1 → -1
      this.accessoryIndex =
        this.accessoryIndex + 1 >= this.accessories.length ? -1 : this.accessoryIndex + 1;
      this.applyAccessory();
    });
  }

  /** 首次使用时扫一遍饰品目录并缓存（目录即清单，不手写文件名） */
  private ensureAccessories(cb: () => void) {
    if (this.accessoriesLoaded) {
      cb();
      return;
    }
    resources.loadDir(ACCESSORY_DIR, SpriteFrame, (err, frames) => {
      if (this.disposed) return;
      if (err) console.warn('[PetStage] 饰品目录加载失败', err);
      this.accessories = (frames as SpriteFrame[]) || [];
      this.accessoriesLoaded = true;
      cb();
    });
  }

  /** 按当前下标挂上饰品；下标为 -1 时摘掉 */
  private applyAccessory() {
    if (this.hatNode) {
      if (this.hatNode.isValid) this.hatNode.destroy();
      this.hatNode = null;
      this.hatBone = null;
    }
    if (this.accessoryIndex < 0) return;

    const pet = this.petNode;
    const skel = this.skeleton;
    if (!pet || !skel) return;
    const bone = skel.findBone(HAT_BONE);
    if (!bone) {
      console.warn(`[PetStage] 找不到骨骼 ${HAT_BONE}，无法挂饰品`);
      return;
    }
    this.hatBone = bone;

    const node = new Node('Hat');
    node.layer = Layers.Enum.UI_2D;
    node.addComponent(UITransform);
    node.parent = pet;
    // 位置用的是骨骼局部坐标（与 petNode 局部空间同源），所以缩放也在同一空间里给：
    // 这里**不要**再除以 petNode 的放大倍数——那会让帽子相对猫头又缩小一遍。
    node.setScale(HAT_SCALE, HAT_SCALE, 1);
    const sprite = node.addComponent(Sprite);
    sprite.sizeMode = Sprite.SizeMode.TRIMMED;
    sprite.spriteFrame = this.accessories[this.accessoryIndex];
    this.hatNode = node;
  }

  /** 当前饰品序号（1-based，0 = 没戴）与总数，供展示层显示 */
  public get accessoryNo(): number {
    return this.accessoryIndex + 1;
  }
  public get accessoryCount(): number {
    return this.accessories.length;
  }

  /**
   * 给一组槽位染色（Spine 原生按槽位着色，乘法混合）。
   * 槽位名找不到就跳过——不同素材槽位命名不一，缺一个不该让整只顾客失败。
   */
  /** 把当前顾客的随机色调重涂一遍（每帧调用，压过动画里的颜色关键帧） */
  private applyCustomerTones() {
    const skel = this.customerSkel;
    if (!skel || !skel.isValid) return;
    for (const t of this.customerTones) this.tintSlots(skel, t.slots, t.rgb);
  }

  private tintSlots(skel: sp.Skeleton, slotNames: string[], rgb: number[]) {
    const r = rgb[0] / 255;
    const g = rgb[1] / 255;
    const b = rgb[2] / 255;
    for (const name of slotNames) {
      const slot = skel.findSlot(name);
      if (!slot) continue;
      slot.color.r = r;
      slot.color.g = g;
      slot.color.b = b;
    }
  }

  /**
   * 顾客上门（顾客系统演示）：显示/隐藏 Customer Spine，并挂一块名牌显示模拟的顾客信息。
   * 数据来自 showcaseData.randomCustomer()——真实产品里换成后端「顾客到访」事件即可。
   */
  public toggleCustomer() {
    if (this.customerNode) {
      if (this.customerNode.isValid) this.customerNode.destroy();
      this.customerNode = null;
      this.customerSkel = null;
      this.customerTones = [];
      return;
    }
    if (!this.spineReady()) return;

    const node = new Node('Customer');
    node.layer = Layers.Enum.UI_2D;
    node.addComponent(UITransform);
    node.parent = this.node;
    node.setSiblingIndex(2);
    node.setPosition(-210, this.centerY - 120, 0);
    this.customerNode = node;

    // 骨架放子节点：随机体型/朝向的翻转只作用于它，名牌文字不被镜像
    const skelNode = new Node('CustomerSkel');
    skelNode.layer = Layers.Enum.UI_2D;
    skelNode.addComponent(UITransform);
    skelNode.parent = node;

    resources.load('spine/Customer/Customer', sp.SkeletonData, (err, data) => {
      if (this.disposed || !node.isValid) return;
      if (err || !data) {
        console.warn('[PetStage] 顾客骨架加载失败', err);
        node.destroy();
        this.customerNode = null;
        return;
      }
      const skel = skelNode.addComponent(sp.Skeleton);
      skel.skeletonData = data;
      skel.premultipliedAlpha = false;
      const rt = data.getRuntimeData && data.getRuntimeData();
      // 顾客骨架的 default 皮肤是空的，全部部件都在命名皮肤里（本素材只有一个，名 "1"）。
      // 和 pet_cat 一样：不选皮肤则整只没有任何附件，只剩名牌文字。取第一个非 default 皮肤挂上。
      const skinNames = rt && rt.skins ? rt.skins.map((s) => s.name) : [];
      const anims = rt && rt.animations ? rt.animations.map((a) => a.name) : [];
      const skin = skinNames.find((n) => n && n !== 'default') || '';
      if (skin) skel.setSkin(skin);

      // 轻量版「不同顾客」：素材只有一套长相，靠随机 姿势 + 朝向 + 体型 + 色调 制造差异。
      const poses = CUSTOMER_POSE_CANDIDATES.filter((n) => anims.indexOf(n) >= 0);
      const anim = poses.length ? poses[Math.floor(Math.random() * poses.length)] : (anims[0] || '');
      if (anim) skel.setAnimation(0, anim, true);

      const size = 0.82 + Math.random() * 0.22; // 体型 0.82~1.04
      const face = Math.random() < 0.5 ? -1 : 1; // 朝向随机（翻 scale.x）
      skelNode.setScale(size * face, size, 1);

      // 随机肤色/发色/衣服色：按槽位染色，做出粗略的「不同人」区分。
      // 存下来在 update() 里每帧重涂，防止动画的颜色关键帧把它覆盖掉。
      this.customerSkel = skel;
      this.customerTones = [
        { slots: CUSTOMER_SKIN_SLOTS, rgb: pickTone(CUSTOMER_SKIN_TONES) },
        { slots: CUSTOMER_HAIR_SLOTS, rgb: pickTone(CUSTOMER_HAIR_TONES) },
        { slots: CUSTOMER_CLOTH_SLOTS, rgb: pickTone(CUSTOMER_CLOTH_TONES) },
      ];
      this.applyCustomerTones();

      // 换色调：随机肤色档 + 衣服色档，按槽名分类染色。setSkin 已把槽色重置为白，这里染在其后。
      const skinTint = CUSTOMER_SKIN_TINTS[Math.floor(Math.random() * CUSTOMER_SKIN_TINTS.length)];
      const clothTint = CUSTOMER_CLOTH_TINTS[Math.floor(Math.random() * CUSTOMER_CLOTH_TINTS.length)];
      const slotDatas = rt && rt.slots ? rt.slots : [];
      for (const sd of slotDatas) {
        const nm = sd.name || '';
        const tint = SKIN_SLOT_RE.test(nm) ? skinTint : CLOTH_SLOT_RE.test(nm) ? clothTint : null;
        if (!tint) continue;
        const slot = skel.findSlot(nm);
        if (slot && slot.color) slot.color.set(tint[0] / 255, tint[1] / 255, tint[2] / 255, 1);
      }

      // 名牌：模拟后端下发的顾客信息（挂在父节点，不随骨架翻转镜像）
      const c = randomCustomer();
      const label = makeLabel(`${c.name}  想要「${c.order}」`, node, {
        size: 26,
        color: COLOR.title,
        align: 'center',
        bold: true,
      });
      label.node.setPosition(0, 210, 0);
    });
  }

  /** 每帧把帽子对齐到头骨的世界位姿（骨骼坐标与 petNode 局部空间同源）。 */
  update() {
    this.applyCustomerTones();

    const node = this.hatNode;
    const bone = this.hatBone;
    if (!node || !bone || !node.isValid) return;
    // 骨骼的 worldX/worldY 是**骨架局部空间**的值（本素材整只只有 ~106 单位高），
    // 和挂在同一父节点下的子节点局部坐标同源，所以直接用、不要再乘节点缩放。
    //
    // 偏移也必须按这个尺度给（几十像素在这里就是「半只猫」那么大）。
    // 早先版本用 atan2(bone.c, bone.a) 求朝向再沿该方向偏移：这根骨骼实测 a=0、c=0.52，
    // 算出来是 90°，于是「上」被当成了水平方向，帽子被推到腰侧——所以这里不做朝向换算，
    // 直接加竖直偏移即可（猫头基本不大幅歪，够用且不会算飞）。
    node.setPosition(bone.worldX + HAT_OFFSET_X, bone.worldY + HAT_OFFSET_Y, 0);
  }
}
