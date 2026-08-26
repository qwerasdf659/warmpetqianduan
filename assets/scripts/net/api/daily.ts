/** 每日模块 /daily */

import { get, post } from '../request';
import { newBizId } from '../bizid';
import type { DailyView } from '../types';

export interface DailyRewardResult {
  daily: DailyView;
  gained: number;
  gameCoin: number;
}

/**
 * 签到状态 + 任务列表。
 * 任务是运营可配置的，前端不要硬编码 taskKey，按返回数组渲染。
 */
export const info = (): Promise<DailyView> => get('/daily');

/** 签到。服务端按业务日派生真正的幂等键，重复调用不会重复发奖 */
export const checkin = (bizId?: string): Promise<DailyRewardResult> =>
  post('/daily/checkin', { bizId: bizId || newBizId('checkin') });

export const claimTask = (taskKey: string, bizId?: string): Promise<DailyRewardResult> =>
  post('/daily/task/claim', { bizId: bizId || newBizId('task'), taskKey });
