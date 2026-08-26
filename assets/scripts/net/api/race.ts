/**
 * 赛跑模块 /race
 *
 * 状态机：start → pending → settle → settled
 *   pending 阶段可看广告 revive 重跑（每场 1 次）
 *   settled 之后可看广告 double 翻倍（需 rewardCoin > 0）
 *
 * 名次和奖励在 start 时就算定了，settle 只是发奖，
 * 所以可以 start 返回后先播动画、播完再 settle。
 */

import { get, post } from '../request';
import { newBizId } from '../bizid';
import type {
  RaceTracksView,
  RaceStartResult,
  RaceSettleResult,
  RaceDoubleResult,
  RaceReviveResult,
} from '../types';

/** 赛道列表 + 出战宠战力预览。无宠时 battle 为 null，不报错 */
export const tracks = (): Promise<RaceTracksView> => get('/race/tracks');

/** 报名参赛。注意：换新 bizId 调用就是开新的一局，会再次扣体力和门票 */
export function start(opts: { trackKey: string; petId?: string; bizId?: string }): Promise<RaceStartResult> {
  const data: Record<string, unknown> = {
    bizId: opts.bizId || newBizId('racestart'),
    trackKey: opts.trackKey,
  };
  if (opts.petId) data.petId = opts.petId;
  return post('/race/start', data);
}

/** 结算领奖。duplicated 为 true 表示回放，不要重复播领奖动画 */
export const settle = (raceId: string, bizId?: string): Promise<RaceSettleResult> =>
  post('/race/settle', { bizId: bizId || newBizId('racesettle'), raceId });

/** 看广告奖励翻倍，需先拿 scene=race_double 的凭证 */
export const doubleReward = (raceId: string, adToken: string, bizId?: string): Promise<RaceDoubleResult> =>
  post('/race/reward/double', { bizId: bizId || newBizId('racedouble'), raceId, adToken });

/** 看广告复活重跑，需先拿 scene=race_revive 的凭证，且该场仍为 pending */
export const revive = (raceId: string, adToken: string, bizId?: string): Promise<RaceReviveResult> =>
  post('/race/revive', { bizId: bizId || newBizId('racerevive'), raceId, adToken });

/** 名次奖励系数，仅用于 UI 预告「第 N 名可得多少」 */
export const RANK_FACTOR = [1, 0.6, 0.35, 0.15];

export function estimateReward(baseReward: number, rank: number): number {
  const f = RANK_FACTOR[rank - 1];
  return f === undefined ? 0 : Math.round(baseReward * f);
}
