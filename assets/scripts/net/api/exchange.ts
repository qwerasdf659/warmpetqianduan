/**
 * 兑换中心 /exchange
 *
 * 注意 pool 字段：部分兑换项扣的是营销积分而不是游戏币，UI 上要区分币种图标。
 * 积分只能向下兑权益，永远不能换回现金。
 */

import { get, post } from '../request';
import { newBizId } from '../bizid';
import { PAGE_SIZE } from '../config';
import type { ExchangeView, ExchangeItem, RedeemOrder, WalletView, Paged, OrderStatus } from '../types';

/** 兑换目录。stockLeft / myLeft 为 null 表示不限量 / 不限购 */
export const catalog = (): Promise<ExchangeView> => get('/exchange');

export const orders = (opts: { page?: number; pageSize?: number } = {}): Promise<Paged<RedeemOrder>> =>
  get('/exchange/orders', { page: opts.page || 1, pageSize: opts.pageSize || PAGE_SIZE });

/**
 * 下单兑换。实物（type === 'physical'）必须传 addressId。
 * 库存不足时服务端会自动退款再报错，玩家不会白扣钱。
 */
export function redeem(
  exchangeKey: string,
  addressId?: string,
  bizId?: string,
): Promise<{ order: RedeemOrder; wallet: WalletView }> {
  const data: Record<string, unknown> = { bizId: bizId || newBizId('redeem'), exchangeKey };
  if (addressId) data.addressId = addressId;
  return post('/exchange/redeem', data);
}

/** 订单列表建议按 status 分三个 Tab */
export const ORDER_TABS: Array<{ key: OrderStatus; name: string }> = [
  { key: 'pending', name: '待处理' },
  { key: 'shipped', name: '已完成' },
  { key: 'cancelled', name: '已取消' },
];

export const STATUS_TEXT: Record<OrderStatus, string> = {
  pending: '待发货',
  shipped: '已发货',
  cancelled: '已取消',
};

/** 兑换按钮是否可点 */
export function canRedeem(item: ExchangeItem, wallet: WalletView): { ok: boolean; reason?: string } {
  if (item.stockLeft === 0) return { ok: false, reason: '已兑完' };
  if (item.myLeft === 0) return { ok: false, reason: '已达限购' };
  const balance = item.pool === 'marketing' ? wallet.marketingPoint : wallet.gameCoin;
  if (balance < item.cost) return { ok: false, reason: '余额不足' };
  return { ok: true };
}
