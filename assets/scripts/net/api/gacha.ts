/**
 * 扭蛋模块 /gacha
 *
 * 合规要求：odds 概率必须展示在界面上。概率来自服务端实际使用的那份权重表，
 * 不存在「展示一套、跑另一套」的可能，直接渲染即可。
 */

import { get, post } from '../request';
import { newBizId } from '../bizid';
import { PAGE_SIZE } from '../config';
import type { GachaView, GachaDrawResult, GachaOdd, GachaPool, Paged } from '../types';

export const info = (): Promise<GachaView> => get('/gacha');

/**
 * 抽奖。times 只能是 1 或 10。
 * prizes 数组顺序即抽取顺序，rare 档位应有特殊演出。
 */
export const draw = (poolKey: string, times: 1 | 10, bizId?: string): Promise<GachaDrawResult> =>
  post('/gacha/draw', { bizId: bizId || newBizId('gacha'), poolKey, times });

export const history = (opts: { page?: number; pageSize?: number } = {}): Promise<Paged<unknown>> =>
  get('/gacha/history', { page: opts.page || 1, pageSize: opts.pageSize || PAGE_SIZE });

/** 概率公示的展示文案。合规展示要求把稀有档位标出来 */
export function formatOdds(odds: GachaOdd[]) {
  return (odds || []).map((o) => ({
    key: o.key,
    name: o.name,
    rare: o.rare,
    percentText: `${o.percent.toFixed(2)}%`,
  }));
}

/** 保底进度文案。pity === 0 表示该池不启用保底 */
export function pityText(pool: GachaPool | null): string {
  if (!pool || !pool.pity) return '';
  return `再抽 ${pool.pityLeft} 次必出稀有`;
}
