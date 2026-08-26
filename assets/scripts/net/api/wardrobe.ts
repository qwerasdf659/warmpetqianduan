/**
 * 换装模块 /wardrobe
 *
 * 换装只影响外观，不影响任何属性——速度和耐力只由等级决定。
 */

import { get, post } from '../request';
import { newBizId } from '../bizid';
import type { WardrobeView, WardrobeItem, BuyResult, Slot } from '../types';

/** 槽位。每个槽位同时只能穿一件 */
export const SLOTS: Slot[] = ['body', 'hat', 'neck', 'bg'];

/** 商店 + 拥有/穿戴态。equipped 是 槽位 → itemKey 的映射 */
export const info = (petId?: string): Promise<WardrobeView> =>
  get('/wardrobe', petId ? { petId } : null);

/** 购买。price === 0 的物品视为默认拥有，买会 400「该物品无需购买」 */
export const buy = (itemKey: string, bizId?: string): Promise<BuyResult> =>
  post('/wardrobe/buy', { bizId: bizId || newBizId('wearbuy'), itemKey });

/** 穿戴。不涉及资源变动，无 bizId。返回完整 WardrobeView */
export function equip(itemKey: string, petId?: string): Promise<WardrobeView> {
  const data: Record<string, unknown> = { itemKey };
  if (petId) data.petId = petId;
  return post('/wardrobe/equip', data, { journal: false });
}

export function unequip(slot: Slot, petId?: string): Promise<WardrobeView> {
  const data: Record<string, unknown> = { slot };
  if (petId) data.petId = petId;
  return post('/wardrobe/unequip', data, { journal: false });
}

/**
 * 计算实际生效的外观。
 *
 * 后端新号的 equipped 是空对象，但 price === 0 的物品（原色皮肤、暖阳小屋背景）
 * 是默认拥有的。玩家没手动穿之前 body/bg 槽位会是空的，直接按 equipped 渲染会没形象，
 * 所以这里补一层「同槽位最便宜的已拥有物品」兜底。
 *
 * 这属于客户端各自猜默认形象，已在《后端配合需求清单》里请后端确认
 * 是否应该在建号时自动穿戴，确认后这段可以删。
 */
export function resolveAppearance(view: WardrobeView | null): Partial<Record<Slot, string>> {
  const equipped: Partial<Record<Slot, string>> = Object.assign({}, (view && view.equipped) || {});
  const items = (view && view.items) || [];

  SLOTS.forEach((slot) => {
    if (equipped[slot]) return;
    const fallback = items
      .filter((it) => it.slot === slot && it.owned && it.price === 0)
      .sort((a, b) => a.price - b.price)[0];
    // hat / neck 允许为空（不戴配饰是正常形象），body / bg 必须兜底
    if (fallback && (slot === 'body' || slot === 'bg')) equipped[slot] = fallback.key;
  });

  return equipped;
}

/** 按槽位分组商品，用于换装面板的分页签 */
export function groupBySlot(items: WardrobeItem[]): Record<string, WardrobeItem[]> {
  const groups: Record<string, WardrobeItem[]> = {};
  SLOTS.forEach((s) => {
    groups[s] = [];
  });
  (items || []).forEach((it) => {
    if (!groups[it.slot]) groups[it.slot] = [];
    groups[it.slot].push(it);
  });
  return groups;
}
