/** 消耗品 /items/consumables */

import { get, post } from '../request';
import { newBizId } from '../bizid';
import type { ConsumablesView, BuyResult, UseConsumableResult } from '../types';

export const info = (): Promise<ConsumablesView> => get('/items/consumables');

/** 购买。qty 默认 1，上限 99 */
export function buy(itemKey: string, qty?: number, bizId?: string): Promise<BuyResult> {
  const data: Record<string, unknown> = { bizId: bizId || newBizId('consbuy'), itemKey };
  if (qty && qty > 1) data.qty = qty;
  return post('/items/consumables/buy', data);
}

/**
 * 使用一份。接口不支持批量——批量使用时超出上限的部分会被 clamp 掉，
 * 等于玩家的道具凭空消失，所以连喂就让玩家连点。
 * 消耗品没有冷却，和四种互动动作不同。
 */
export function use(itemKey: string, petId?: string, bizId?: string): Promise<UseConsumableResult> {
  const data: Record<string, unknown> = { bizId: bizId || newBizId('consuse'), itemKey };
  if (petId) data.petId = petId;
  return post('/items/consumables/use', data);
}

export const EFFECT_TEXT: Record<string, string> = {
  hunger: '饱食',
  cleanliness: '清洁',
  mood: '心情',
  stamina: '体力',
  exp: '经验',
};

/** 把 effect 对象拼成「饱食 +25」这样的展示文案 */
export function describeEffect(effect: Record<string, number>): string {
  return Object.keys(effect || {})
    .map((k) => `${EFFECT_TEXT[k] || k} +${effect[k]}`)
    .join('  ');
}
