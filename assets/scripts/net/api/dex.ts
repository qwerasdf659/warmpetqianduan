/** 图鉴模块 /dex */

import { get, post } from '../request';
import { newBizId } from '../bizid';
import type { DexEntry } from '../types';

export const info = (): Promise<{ entries: DexEntry[] }> => get('/dex');

export const claim = (
  entryKey: string,
  bizId?: string,
): Promise<{ entries: DexEntry[]; gained: number; gameCoin: number }> =>
  post('/dex/claim', { bizId: bizId || newBizId('dexclaim'), entryKey });

/** 可领取红点的判定条件 */
export function claimableCount(entries: DexEntry[]): number {
  return (entries || []).filter((e) => e.unlocked && !e.claimed).length;
}
