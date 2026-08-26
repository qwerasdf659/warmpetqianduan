/**
 * 接口数据结构。
 *
 * 两条贯穿全局的约定：
 * - bigint 主键在 JSON 里是字符串：petId / raceId / layoutId / addressId / 订单 id
 *   全程按 string 处理，不要 Number()，超过 2^53 会丢精度。
 * - 时间字段是 ISO8601 UTC 字符串，业务日切按东八区自然日。
 *
 * 引用这里的类型请一律用 `import type`，隐含 isolatedModules 下这是唯一安全的写法。
 */

export type Pool = 'game' | 'marketing';
export type PetStage = 'baby' | 'teen' | 'adult';
export type PetAction = 'feed' | 'bath' | 'pet' | 'play';
export type Slot = 'body' | 'hat' | 'neck' | 'bg';
export type RaceGrade = 'S' | 'A' | 'B' | 'C';
export type RaceStatus = 'pending' | 'settled';
export type GhostSource = 'player' | 'mixed' | 'npc';
export type AdScene = 'ad_reward' | 'race_double' | 'race_revive';
export type OrderStatus = 'pending' | 'shipped' | 'cancelled';
export type ItemType = 'physical' | 'virtual';

/** 服务端惰性结算后的宠物状态，直接渲染即可 */
export interface PetStateView {
  id: string;
  nickname: string | null;
  species: string;
  isActive: boolean;
  /** 饱食度 0–100 */
  hunger: number;
  /** 清洁度 0–100 */
  cleanliness: number;
  /** 心情 0–100 */
  mood: number;
  stamina: number;
  /** 体力上限，随等级增长 */
  staminaMax: number;
  /** 亲密度，无上限 */
  intimacy: number;
  level: number;
  exp: number;
  expIntoLevel: number;
  /** 升级还需经验，满级为 0 */
  expToNext: number;
  stage: PetStage;
  /** 仅由等级派生，换装不影响 */
  speed: number;
  endurance: number;
  /** ISO8601，上次结算锚点 */
  lastSeenAt: string;
}

export interface WalletView {
  gameCoin: number;
  marketingPoint: number;
}

export interface BuyResult {
  itemKey: string;
  /** 购买后的持有量，不是本次买了几件 */
  qty: number;
  wallet: WalletView;
  /** true 表示幂等回放，不要重复播放奖励动画 */
  duplicated: boolean;
}

export interface InteractGain {
  intimacy: number;
  exp: number;
  coin: number;
}

export interface InteractResult {
  pet: PetStateView;
  /** 本次实发数值，已扣掉每日上限截断的部分 */
  gained: InteractGain;
  /** true 表示撞到每日上限 */
  capped: boolean;
  levelUp: boolean;
  /** 该动作的完整冷却时长，前端据此起本地倒计时 */
  cooldownRemainMs: number;
  gameCoin: number;
}

export interface OfflineView {
  elapsedSec: number;
  cappedSec: number;
  maxHours: number;
  coinPerHour: number;
  comfortFactor: number;
  claimableCoin: number;
}

export interface LedgerEntry {
  id: string;
  pool: Pool;
  /** 正为收入、负为支出 */
  delta: number;
  balanceAfter: number;
  bizId: string;
  reason: string;
  refId: string | null;
  createdAt: string;
}

export interface Paged<T> {
  list: T[];
  total: number;
}

export interface CheckinView {
  done: boolean;
  streak: number;
  totalCheckins: number;
  todayReward: number;
  nextReward: number;
}

export interface DailyTask {
  key: string;
  name: string;
  target: number;
  /** 已 clamp 到不超过 target */
  progress: number;
  coin: number;
  done: boolean;
  claimed: boolean;
}

export interface DailyView {
  checkin: CheckinView;
  tasks: DailyTask[];
}

export interface RaceTrack {
  key: string;
  name: string;
  distance: number;
  difficulty: number;
  staminaCost: number;
  entryCoin: number;
  baseReward: number;
  recommendLevel: number;
  targetTime: number;
}

export interface RaceBattle {
  petId: string;
  nickname: string | null;
  level: number;
  /** speed * 2 + endurance，仅供展示，不参与名次计算 */
  power: number;
  stamina: number;
  staminaMax: number;
}

export interface RaceTracksView {
  tracks: RaceTrack[];
  /** 无宠时为 null，不报错 */
  battle: RaceBattle | null;
}

export interface RaceStartResult {
  raceId: string;
  trackKey: string;
  rank: number;
  totalRacers: number;
  /** 秒，3 位小数，用来映射赛跑动画时长 */
  finishTime: number;
  grade: RaceGrade;
  /** 升序 */
  opponentFinishTimes: number[];
  ghostSource: GhostSource;
  playerScore: number;
  staminaLeft: number;
  status: RaceStatus;
}

export interface RaceSettleResult {
  raceId: string;
  rank: number;
  totalRacers: number;
  finishTime: number;
  grade: RaceGrade;
  rewardCoin: number;
  gameCoin: number;
  duplicated: boolean;
}

export interface RaceDoubleResult {
  raceId: string;
  bonusCoin: number;
  totalRewardCoin: number;
  gameCoin: number;
  duplicated: boolean;
}

export interface RaceReviveResult extends RaceStartResult {
  rewardCoin: number;
  previousRank: number;
  previousFinishTime: number;
  reviveCount: number;
}

export interface AdTokenResult {
  nonce: string;
  scene: AdScene;
  expiresInSec: number;
  /** 今日该场景还能领几次 */
  remaining: number;
}

export interface AdVerifyResult {
  gained: number;
  gameCoin: number;
  remaining: number;
}

export interface WardrobeItem {
  key: string;
  /** 只区分皮肤与非皮肤；真正的分类维度是 slot（背景的 type 也是 accessory） */
  type: string;
  name: string;
  slot: Slot;
  price: number;
  pool: Pool;
  owned: boolean;
  equipped: boolean;
}

export interface WardrobeView {
  petId: string;
  items: WardrobeItem[];
  /** 槽位 → itemKey。新号是空对象，需要前端补默认外观 */
  equipped: Partial<Record<Slot, string>>;
}

export interface ConsumableItem {
  key: string;
  name: string;
  price: number;
  pool: Pool;
  effect: Record<string, number>;
  owned: number;
  sortOrder: number;
}

export interface ConsumablesView {
  items: ConsumableItem[];
  wallet: WalletView;
}

export interface UseConsumableResult {
  itemKey: string;
  left: number;
  effect: Record<string, number>;
  pet: PetStateView;
  levelUp: boolean;
}

export interface FurnitureItem {
  key: string;
  name: string;
  price: number;
  pool: Pool;
  comfort: number;
  owned: number;
  placed: number;
  gridW: number;
  gridH: number;
}

export interface PlacedFurniture {
  layoutId: string;
  itemKey: string;
  name: string;
  comfort: number;
  /** 坐标从 0 起，左上角为原点 */
  posX: number;
  posY: number;
  gridW: number;
  gridH: number;
}

export interface HomeView {
  comfort: number;
  /** min(comfort / 100, 0.3) */
  comfortFactor: number;
  grid: { width: number; height: number };
  items: FurnitureItem[];
  placed: PlacedFurniture[];
}

export interface DexEntry {
  key: string;
  name: string;
  desc: string;
  target: number;
  progress: number;
  reward: number;
  unlocked: boolean;
  claimed: boolean;
}

export interface GachaOdd {
  key: string;
  name: string;
  rare: boolean;
  percent: number;
}

export interface GachaPool {
  key: string;
  name: string;
  pool: Pool;
  cost: number;
  costTen: number;
  /** 0 表示该池不启用保底，此时 pityLeft 为 null */
  pity: number;
  dupeCoin: number;
  pityLeft: number | null;
  /** 合规要求必须展示在界面上 */
  odds: GachaOdd[];
}

export interface GachaView {
  pools: GachaPool[];
  wallet: WalletView;
}

export interface GachaPrize {
  entryKey: string;
  name: string;
  kind: string;
  amount: number;
  itemKey: string | null;
  qty: number;
  rare: boolean;
  /** 重复收藏品被折算成了游戏币 */
  converted: boolean;
}

export interface GachaDrawResult {
  poolKey: string;
  times: number;
  cost: number;
  /** 数组顺序即抽取顺序，按序播放开奖动画 */
  prizes: GachaPrize[];
  wallet: WalletView;
  pity: number;
  duplicated: boolean;
}

export interface ExchangeItem {
  key: string;
  name: string;
  type: ItemType;
  cost: number;
  /** 注意：部分兑换项扣的是营销积分，UI 要区分币种图标 */
  pool: Pool;
  desc: string;
  sortOrder: number;
  stock: number | null;
  perUserLimit: number | null;
  grantItemKey: string | null;
  grantQty: number;
  /** null 表示不限量 */
  stockLeft: number | null;
  /** null 表示不限购 */
  myLeft: number | null;
}

export interface ExchangeView {
  items: ExchangeItem[];
  wallet: WalletView;
}

export interface OrderAddress {
  receiver: string;
  phone: string;
  region: string;
  detail: string;
}

export interface RedeemOrder {
  id: string;
  exchangeKey: string;
  itemName: string;
  itemType: ItemType;
  cost: number;
  pool: Pool;
  status: OrderStatus;
  address: OrderAddress | null;
  trackingNo: string | null;
  shippedAt: string | null;
  cancelledAt: string | null;
  remark: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserAddress {
  id: string;
  userId: string;
  receiver: string;
  phone: string;
  region: string;
  detail: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AddressInput {
  receiver?: string;
  phone?: string;
  region?: string;
  detail?: string;
  isDefault?: boolean;
}

export interface PromoRedeemResult {
  code: string;
  batch: string;
  pool: Pool;
  amount: number;
  wallet: WalletView;
  duplicated: boolean;
}

export interface HealthView {
  status: string;
  service: string;
  time: string;
}

export interface LoginResult {
  token: string;
  userId: string;
}
