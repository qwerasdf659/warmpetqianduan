/**
 * 激励视频的完整流程封装。
 *
 *   POST /ad/token { scene }  →  nonce（TTL 300 秒）
 *   播放激励视频
 *   带 nonce 去核销（/ad/verify 或 /race/reward/double 或 /race/revive）
 *
 * 铁律「软失败不死亡」在这里的落地方式：
 * 任何一步失败都返回结构化结果而不是抛异常，调用方据此提示玩家「稍后再试」，
 * 绝不出现按钮点下去没反应、或者弹一个看不懂的报错然后流程卡住。
 */

import { AD_UNIT_ID, AD_MOCK } from '../net/config';
import { toApiError } from '../net/errors';
import { newBizId } from '../net/bizid';
import { createRewardedVideoAd } from '../platform/minigame';
import api from '../net/api';
import type { AdScene, AdVerifyResult, RaceDoubleResult, RaceReviveResult } from '../net/types';

export type AdStatus =
  | 'ok'
  /** 玩家中途关掉了广告 */
  | 'skipped'
  /** 没配广告位 / 平台不支持 / 加载失败 */
  | 'unavailable'
  /** 今日次数用尽 */
  | 'limited'
  /** 核销失败 */
  | 'failed';

export interface AdResult<T> {
  status: AdStatus;
  data?: T;
  message?: string;
}

interface PlayResult {
  ended: boolean;
  reason?: string;
}

function playRewardedVideo(scene: AdScene): Promise<PlayResult> {
  const ad = createRewardedVideoAd(AD_UNIT_ID[scene]);

  if (!ad) {
    // 编辑器预览、开发者工具里没有真实广告，联调期直接当作看完
    if (AD_MOCK) return Promise.resolve({ ended: true });
    return Promise.resolve({ ended: false, reason: 'unavailable' });
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: PlayResult) => {
      if (settled) return;
      settled = true;
      ad.offClose(onClose);
      ad.offError(onError);
      resolve(result);
    };

    const onClose = (res: { isEnded: boolean }) => finish({ ended: !!(res && res.isEnded) });
    const onError = () => finish({ ended: false, reason: 'unavailable' });

    ad.onClose(onClose);
    ad.onError(onError);

    ad.show().catch(() =>
      // 首次展示失败通常是缓存里没有素材，load 之后再试一次
      ad
        .load()
        .then(() => ad.show())
        .catch(() => finish({ ended: false, reason: 'unavailable' })),
    );
  });
}

/**
 * 走完「领凭证 → 看广告 → 核销」全流程。永不 reject。
 */
export async function watchAdAndReward<T>(
  scene: AdScene,
  consume: (payload: { bizId: string; adToken: string }) => Promise<T>,
): Promise<AdResult<T>> {
  // 1. 领凭证。这个接口不幂等，每次调用都占一次当日额度，所以只在玩家点了按钮之后调
  let nonce: string;
  try {
    const res = await api.ad.token(scene);
    nonce = res.nonce;
  } catch (err) {
    const e = toApiError(err);
    // 「今日该场景的广告次数已用尽」是正常业务状态，不该当成错误弹红字
    if (e.code === 400) return { status: 'limited', message: e.message };
    return { status: 'unavailable', message: e.message || '广告暂时不可用，请稍后再试' };
  }

  // 2. 播放。必须在 300 秒 TTL 内完成
  const played = await playRewardedVideo(scene);
  if (!played.ended) {
    if (played.reason === 'unavailable') {
      return { status: 'unavailable', message: '广告暂时不可用，请稍后再试' };
    }
    return { status: 'skipped', message: '需要完整观看视频才能获得奖励哦' };
  }

  // 3. 核销。bizId 在这里固定住，request 层的重试会复用它，不会重复发奖。
  //    即使这一步彻底失败，bizId 已进未确认操作日志，下次冷启动会重放确认。
  const bizId = newBizId(scene);
  try {
    const data = await consume({ bizId, adToken: nonce });
    return { status: 'ok', data };
  } catch (err) {
    const e = toApiError(err);
    return { status: 'failed', message: e.message || '奖励发放失败，请稍后在钱包确认' };
  }
}

/** 看广告直接领币 */
export function watchForCoin(): Promise<AdResult<AdVerifyResult>> {
  return watchAdAndReward('ad_reward', ({ bizId, adToken }) => api.ad.verify(adToken, bizId));
}

/** 赛跑奖励翻倍 */
export function watchForRaceDouble(raceId: string): Promise<AdResult<RaceDoubleResult>> {
  return watchAdAndReward('race_double', ({ bizId, adToken }) =>
    api.race.doubleReward(raceId, adToken, bizId),
  );
}

/** 赛跑复活重跑 */
export function watchForRaceRevive(raceId: string): Promise<AdResult<RaceReviveResult>> {
  return watchAdAndReward('race_revive', ({ bizId, adToken }) =>
    api.race.revive(raceId, adToken, bizId),
  );
}
