/**
 * 兑换码 /promo
 *
 * 营销积分主要靠这个入口发放。归一化（去连字符/空格/大小写）在服务端做，
 * 前端不需要自己清洗，这里的 normalize 只是为了输入框的即时反馈。
 */

import { get, post } from '../request';
import { newBizId } from '../bizid';
import { PAGE_SIZE } from '../config';
import type { PromoRedeemResult, Paged } from '../types';

export const MAX_LENGTH = 40;

export const redeem = (code: string, bizId?: string): Promise<PromoRedeemResult> =>
  post('/promo/redeem', { bizId: bizId || newBizId('promo'), code });

export const redemptions = (opts: { page?: number; pageSize?: number } = {}): Promise<Paged<unknown>> =>
  get('/promo/redemptions', { page: opts.page || 1, pageSize: opts.pageSize || PAGE_SIZE });

/** 输入框展示用的归一化，与服务端口径一致 */
export function normalize(code: string): string {
  return (code || '').replace(/[\s-]/g, '').toUpperCase().slice(0, MAX_LENGTH);
}

/**
 * 后端有防爆破限流（默认失败 10 次/天）。连续失败几次后应该主动提示玩家
 * 检查输入，而不是让他一直试到被限流。
 */
export const FAIL_HINT_THRESHOLD = 3;
