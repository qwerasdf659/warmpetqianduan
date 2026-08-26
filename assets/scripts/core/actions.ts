/**
 * 业务动作层。
 *
 * UI 只管画和收集点击，把「调哪个接口、怎么同步本地状态、失败了怎么提示」
 * 统一收在这里，避免同一段同步逻辑在每个界面各写一遍。
 *
 * 约定：这些函数不 reject，一律返回 { ok, data?, error? }，
 * UI 拿到 ok === false 时按 error.message 提示即可（铁律：软失败不死亡）。
 */

import api from '../net/api';
import store from './store';
import * as cooldown from './cooldown';
import { ApiError, toApiError } from '../net/errors';
import type {
  InteractResult,
  PetAction,
  PetStateView,
  Slot,
  WardrobeView,
  HomeView,
  DexEntry,
  GachaDrawResult,
  PromoRedeemResult,
  RedeemOrder,
  WalletView,
  UseConsumableResult,
  BuyResult,
} from '../net/types';
import type { DailyRewardResult } from '../net/api/daily';

export interface ActionResult<T> {
  ok: boolean;
  data?: T;
  error?: ApiError;
}

function fail<T>(err: unknown): ActionResult<T> {
  return { ok: false, error: toApiError(err) };
}

function done<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

/**
 * 互动照顾。
 * data.gained 用于飘字，data.capped 提示今日已达上限，data.levelUp 触发升级动画。
 */
export async function interact(action: PetAction): Promise<ActionResult<InteractResult>> {
  const petId = store.activePetId;

  // 本地冷却拦一道，避免无谓的 429
  if (!cooldown.isReady(petId, action)) {
    return fail(new ApiError(429, `冷却中，还需 ${cooldown.remainText(petId, action)}`));
  }

  try {
    const res = await api.pet.interact(action, { petId: petId || undefined });
    store.applyResponse(res);
    cooldown.start(petId, action, res.cooldownRemainMs);
    return done(res);
  } catch (err) {
    const e = toApiError(err);
    if (e.isCooldown) cooldown.startFromError(petId, action, e);
    return fail(e);
  }
}

export async function claimOffline(): Promise<ActionResult<{ gained: number; gameCoin: number }>> {
  if (!store.hasOfflineReward) {
    return fail(new ApiError(400, '暂无可领取的离线收益'));
  }
  try {
    const res = await api.pet.claimOffline();
    store.applyGameCoin(res.gameCoin);
    store.applyOffline(null);
    // 领取后重新对一次锚点，否则本地预测还停在旧的 lastSeenAt
    api.pet
      .state()
      .then((r) => store.applyPet(r.pet))
      .catch(() => {});
    return done(res);
  } catch (err) {
    return fail(err);
  }
}

export async function checkin(): Promise<ActionResult<DailyRewardResult>> {
  try {
    return done(store.applyResponse(await api.daily.checkin()));
  } catch (err) {
    return fail(err);
  }
}

export async function claimTask(taskKey: string): Promise<ActionResult<DailyRewardResult>> {
  try {
    return done(store.applyResponse(await api.daily.claimTask(taskKey)));
  } catch (err) {
    return fail(err);
  }
}

export async function claimDex(
  entryKey: string,
): Promise<ActionResult<{ entries: DexEntry[]; gained: number; gameCoin: number }>> {
  try {
    return done(store.applyResponse(await api.dex.claim(entryKey)));
  } catch (err) {
    return fail(err);
  }
}

/** 花币清冷却 */
export async function speedup(): Promise<ActionResult<{ cleared: number; gameCoin: number }>> {
  const petId = store.activePetId;
  try {
    const res = await api.ad.speedup(petId || undefined);
    store.applyGameCoin(res.gameCoin);
    cooldown.clearAll(petId);
    return done(res);
  } catch (err) {
    return fail(err);
  }
}

/** 花币回体力 */
export async function recoverStamina(): Promise<ActionResult<{ pet: PetStateView; gameCoin: number }>> {
  try {
    return done(store.applyResponse(await api.ad.recoverStamina(store.activePetId || undefined)));
  } catch (err) {
    return fail(err);
  }
}

/** 使用消耗品。一次一份，连喂就让玩家连点 */
export async function useConsumable(itemKey: string): Promise<ActionResult<UseConsumableResult>> {
  try {
    const res = await api.items.use(itemKey, store.activePetId || undefined);
    store.applyPet(res.pet);
    return done(res);
  } catch (err) {
    return fail(err);
  }
}

/** 切换出战宠。切完要重拉换装，形象是跟着宠物走的 */
export async function switchPet(petId: string): Promise<ActionResult<{ pet: PetStateView }>> {
  try {
    const res = await api.pet.setActive(petId);
    store.applyPets(store.pets.map((p) => Object.assign({}, p, { isActive: p.id === petId })));
    store.applyPet(res.pet);
    api.wardrobe
      .info(petId)
      .then((w) => store.applyWardrobe(w))
      .catch(() => {});
    return done(res);
  } catch (err) {
    return fail(err);
  }
}

/** 穿戴。返回完整 WardrobeView，直接替换本地状态 */
export async function equip(itemKey: string): Promise<ActionResult<WardrobeView>> {
  try {
    const res = await api.wardrobe.equip(itemKey, store.activePetId || undefined);
    store.applyWardrobe(res);
    return done(res);
  } catch (err) {
    return fail(err);
  }
}

export async function unequip(slot: Slot): Promise<ActionResult<WardrobeView>> {
  try {
    const res = await api.wardrobe.unequip(slot, store.activePetId || undefined);
    store.applyWardrobe(res);
    return done(res);
  } catch (err) {
    return fail(err);
  }
}

export type ShopKind = 'wardrobe' | 'consumable' | 'furniture';

/** 购买。三个商店共用 BuyResult，买完顺手刷新对应的商店视图 */
export async function buy(kind: ShopKind, itemKey: string, qty?: number): Promise<ActionResult<BuyResult>> {
  try {
    let res: BuyResult;
    if (kind === 'wardrobe') res = await api.wardrobe.buy(itemKey);
    else if (kind === 'consumable') res = await api.items.buy(itemKey, qty);
    else res = await api.home.buy(itemKey);

    store.applyWallet(res.wallet);

    if (kind === 'wardrobe') {
      api.wardrobe
        .info(store.activePetId || undefined)
        .then((w) => store.applyWardrobe(w))
        .catch(() => {});
    } else if (kind === 'furniture') {
      api.home
        .info()
        .then((h) => store.applyHome(h))
        .catch(() => {});
    }
    return done(res);
  } catch (err) {
    return fail(err);
  }
}

/** 摆放家具。先本地碰撞检测，服务端 400 只作兜底 */
export async function placeFurniture(
  itemKey: string,
  posX: number | undefined,
  posY: number | undefined,
  gridW: number,
  gridH: number,
): Promise<ActionResult<HomeView>> {
  if (posX !== undefined && posY !== undefined && store.home) {
    const check = api.home.canPlace(store.home, posX, posY, gridW, gridH);
    if (!check.ok) return fail(new ApiError(400, check.reason || '这里放不下'));
  }
  try {
    const res = await api.home.place(itemKey, posX, posY);
    store.applyHome(res);
    return done(res);
  } catch (err) {
    return fail(err);
  }
}

export async function removeFurniture(layoutId: string): Promise<ActionResult<HomeView>> {
  try {
    const res = await api.home.remove(layoutId);
    store.applyHome(res);
    return done(res);
  } catch (err) {
    return fail(err);
  }
}

/** 扭蛋。prizes 按顺序播开奖动画，rare 档位加特殊演出 */
export async function drawGacha(poolKey: string, times: 1 | 10): Promise<ActionResult<GachaDrawResult>> {
  try {
    const res = await api.gacha.draw(poolKey, times);
    store.applyWallet(res.wallet);
    return done(res);
  } catch (err) {
    return fail(err);
  }
}

export async function redeemPromo(code: string): Promise<ActionResult<PromoRedeemResult>> {
  try {
    const res = await api.promo.redeem(code);
    store.applyWallet(res.wallet);
    return done(res);
  } catch (err) {
    return fail(err);
  }
}

/** 兑换下单。实物必须带 addressId */
export async function redeemExchange(
  exchangeKey: string,
  addressId?: string,
): Promise<ActionResult<{ order: RedeemOrder; wallet: WalletView }>> {
  try {
    const res = await api.exchange.redeem(exchangeKey, addressId);
    store.applyWallet(res.wallet);
    return done(res);
  } catch (err) {
    return fail(err);
  }
}
