/**
 * 广告与增值 /ad /boost /stamina
 *
 * 凭证机制：先领一次性 nonce，播完激励视频再拿 nonce 核销。
 * 这样客户端单说「我看完了」拿不到币。
 */

import { post } from '../request';
import { newBizId } from '../bizid';
import type { AdScene, AdTokenResult, AdVerifyResult, PetStateView } from '../types';

export const SCENE_REWARD: AdScene = 'ad_reward';
export const SCENE_RACE_DOUBLE: AdScene = 'race_double';
export const SCENE_RACE_REVIVE: AdScene = 'race_revive';

/**
 * 领广告凭证。这个接口不幂等，每次调用签发一枚新凭证并占用当日额度，
 * 所以不要在页面加载时预先批量领取。
 */
export const token = (scene: AdScene): Promise<AdTokenResult> =>
  post('/ad/token', { scene }, { journal: false });

/** 核销广告奖励。网络异常时务必用同一 bizId 重试，换新 token 会因原 token 已用而失败 */
export const verify = (adToken: string, bizId?: string): Promise<AdVerifyResult> =>
  post('/ad/verify', { bizId: bizId || newBizId('adverify'), adToken });

/** 花币清掉该宠物全部 4 个动作的冷却 */
export function speedup(petId?: string, bizId?: string): Promise<{ cleared: number; gameCoin: number }> {
  const data: Record<string, unknown> = { bizId: bizId || newBizId('speedup') };
  if (petId) data.petId = petId;
  return post('/boost/speedup', data);
}

/** 花币回满体力 */
export function recoverStamina(petId?: string, bizId?: string): Promise<{ pet: PetStateView; gameCoin: number }> {
  const data: Record<string, unknown> = { bizId: bizId || newBizId('stamina') };
  if (petId) data.petId = petId;
  return post('/stamina/recover', data);
}
