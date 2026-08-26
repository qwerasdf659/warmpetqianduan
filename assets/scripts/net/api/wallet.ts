/** 钱包模块 /wallet */

import { get } from '../request';
import { PAGE_SIZE } from '../config';
import type { WalletView, LedgerEntry, Paged, Pool } from '../types';

export const balance = (): Promise<{ wallet: WalletView }> => get('/wallet');

export const ledger = (
  opts: { page?: number; pageSize?: number; pool?: Pool } = {},
): Promise<Paged<LedgerEntry>> =>
  get('/wallet/ledger', {
    page: opts.page || 1,
    pageSize: opts.pageSize || PAGE_SIZE,
    pool: opts.pool,
  });

/** reason 到展示文案的映射，用于流水页的图标与文案 */
export const REASON_TEXT: Record<string, string> = {
  interact: '互动照顾',
  offline: '离线收益',
  race: '赛跑',
  daily: '签到任务',
  ad: '广告奖励',
  boost: '加速回体',
  dex: '图鉴奖励',
  purchase: '购买消费',
  exchange: '兑换消费',
  promo: '兑换码',
  gacha: '扭蛋',
  admin_grant: '官方发放',
  admin_deduct: '官方扣减',
  compensation: '补偿',
};
