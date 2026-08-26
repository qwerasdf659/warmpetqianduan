/**
 * 全局状态。
 *
 * 只存服务端返回的原始数据 + 一份本地预测视图，不做任何业务推算。
 * 很多写接口的响应会顺带带回 gameCoin 或完整 wallet，
 * 用 apply* 系列方法喂进来就能就地刷新余额，不必额外请求 /wallet。
 */

import Emitter from './emitter';
import { predictPet } from './predict';
import { resolveAppearance } from '../net/api/wardrobe';
import type {
  PetStateView,
  WalletView,
  DailyView,
  HomeView,
  WardrobeView,
  OfflineView,
  DexEntry,
  Slot,
} from '../net/types';

/** 任意写接口的响应里可能夹带的字段，applyResponse 会按需认领 */
interface AnyResponse {
  pet?: PetStateView;
  pets?: PetStateView[];
  wallet?: WalletView;
  gameCoin?: number;
  daily?: DailyView;
  entries?: DexEntry[];
}

class Store extends Emitter {
  pet: PetStateView | null = null;
  pets: PetStateView[] = [];
  wallet: WalletView = { gameCoin: 0, marketingPoint: 0 };
  daily: DailyView | null = null;
  home: HomeView | null = null;
  wardrobe: WardrobeView | null = null;
  offline: OfflineView | null = null;
  dexEntries: DexEntry[] = [];

  reset(): void {
    this.pet = null;
    this.pets = [];
    this.wallet = { gameCoin: 0, marketingPoint: 0 };
    this.daily = null;
    this.home = null;
    this.wardrobe = null;
    this.offline = null;
    this.dexEntries = [];
  }

  // ---- 写入 ----

  applyPet(pet: PetStateView): void {
    if (!pet) return;
    this.pet = pet;
    const i = this.pets.findIndex((p) => p.id === pet.id);
    if (i >= 0) this.pets[i] = pet;
    else if (pet.isActive) this.pets.push(pet);
    this.emit('pet', pet);
  }

  applyPets(pets: PetStateView[]): void {
    this.pets = pets || [];
    const active = this.pets.filter((p) => p.isActive)[0];
    if (active) this.pet = active;
    this.emit('pets', this.pets);
    if (active) this.emit('pet', active);
  }

  applyWallet(wallet: WalletView): void {
    if (!wallet) return;
    this.wallet = wallet;
    this.emit('wallet', this.wallet);
  }

  /** 写接口只回传 gameCoin 时用这个，营销积分保持不变 */
  applyGameCoin(gameCoin: number): void {
    if (typeof gameCoin !== 'number') return;
    this.wallet = { gameCoin, marketingPoint: this.wallet.marketingPoint };
    this.emit('wallet', this.wallet);
  }

  applyDaily(daily: DailyView): void {
    if (!daily) return;
    this.daily = daily;
    this.emit('daily', daily);
  }

  applyHome(home: HomeView): void {
    if (!home) return;
    this.home = home;
    this.emit('home', home);
  }

  applyWardrobe(wardrobe: WardrobeView): void {
    if (!wardrobe) return;
    this.wardrobe = wardrobe;
    this.emit('wardrobe', wardrobe);
  }

  applyOffline(offline: OfflineView | null): void {
    this.offline = offline || null;
    this.emit('offline', this.offline);
  }

  applyDex(entries: DexEntry[]): void {
    this.dexEntries = entries || [];
    this.emit('dex', this.dexEntries);
  }

  /**
   * 一次性吞掉任意写接口的响应。
   * 各接口回传的字段不统一（有的给 pet，有的给 gameCoin，有的给整个 wallet），
   * 集中在这里认领，业务层就不用每处都写一遍同步逻辑。
   */
  applyResponse<T extends AnyResponse>(res: T): T {
    if (!res) return res;
    if (res.pet) this.applyPet(res.pet);
    if (res.pets) this.applyPets(res.pets);
    if (res.wallet) this.applyWallet(res.wallet);
    else if (typeof res.gameCoin === 'number') this.applyGameCoin(res.gameCoin);
    if (res.daily) this.applyDaily(res.daily);
    if (res.entries) this.applyDex(res.entries);
    return res;
  }

  // ---- 读取 ----

  /** 家园舒适度系数，用于心情衰减预测与离线时薪展示 */
  get comfortFactor(): number {
    return (this.home && this.home.comfortFactor) || 0;
  }

  /** 推进到「现在」的出战宠视图，UI 每帧读这个 */
  get petView(): PetStateView | null {
    return this.pet ? predictPet(this.pet, this.comfortFactor) : null;
  }

  get activePetId(): string | null {
    return this.pet ? this.pet.id : null;
  }

  /** 槽位 → itemKey，body 与 bg 已做默认兜底 */
  get appearance(): Partial<Record<Slot, string>> {
    return this.wardrobe ? resolveAppearance(this.wardrobe) : {};
  }

  /** 主界面红点：签到未做 + 有可领任务 */
  get dailyBadge(): number {
    if (!this.daily) return 0;
    const checkin = this.daily.checkin && !this.daily.checkin.done ? 1 : 0;
    const tasks = (this.daily.tasks || []).filter((t) => t.done && !t.claimed).length;
    return checkin + tasks;
  }

  get dexBadge(): number {
    return this.dexEntries.filter((e) => e.unlocked && !e.claimed).length;
  }

  /** 离线收益是否值得弹窗 */
  get hasOfflineReward(): boolean {
    return !!this.offline && this.offline.claimableCoin >= 1;
  }

  /** 离线收益是否已封顶，用来提示「快来领取」 */
  get offlineCapped(): boolean {
    return !!this.offline && this.offline.elapsedSec > this.offline.maxHours * 3600;
  }
}

export default new Store();
