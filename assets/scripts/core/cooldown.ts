/**
 * 互动冷却的本地倒计时。
 *
 * 服务端在每次互动的响应里给出 cooldownRemainMs，前端据此把按钮置灰并倒计时。
 * 理想情况下玩家永远撞不到 429——429 只是兜底，撞到了也用它给的秒数校正一次。
 *
 * 冷却锚点用服务端时钟（serverNow），玩家改系统时间也绕不过去；
 * 真正的裁决权仍在后端，这里只负责别让按钮误导玩家。
 */

import { serverNow } from '../net/clock';
import { parseCooldownSec } from '../net/errors';
import { COOLDOWN_KEY } from '../net/config';
import { storage } from '../platform/minigame';
import type { ApiError } from '../net/errors';

/** { `${petId}:${action}`: 服务端时间戳（毫秒） } */
let endAt: Record<string, number> = load();

function load(): Record<string, number> {
  try {
    const raw = storage.get(COOLDOWN_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

const keyOf = (petId: string | null, action: string): string => `${petId || 'active'}:${action}`;

function persist(): void {
  // 顺手清掉已过期的，避免 storage 里堆积历史宠物的记录
  const now = serverNow();
  Object.keys(endAt).forEach((k) => {
    if (endAt[k] <= now) delete endAt[k];
  });
  try {
    storage.set(COOLDOWN_KEY, JSON.stringify(endAt));
  } catch (e) {
    /* 写不进去只影响跨次启动的倒计时，本次会话仍然准确 */
  }
}

/** 记录一次冷却。remainMs 来自服务端响应的 cooldownRemainMs */
export function start(petId: string | null, action: string, remainMs: number): void {
  if (!remainMs || remainMs <= 0) return;
  endAt[keyOf(petId, action)] = serverNow() + remainMs;
  persist();
}

/** 撞到 429 时用错误文案里的秒数校正 */
export function startFromError(petId: string | null, action: string, err: ApiError): void {
  const sec = parseCooldownSec(err && err.message);
  if (sec > 0) start(petId, action, sec * 1000);
}

/** 剩余毫秒，0 表示可用 */
export function remainMs(petId: string | null, action: string): number {
  const at = endAt[keyOf(petId, action)];
  if (!at) return 0;
  return Math.max(0, at - serverNow());
}

export function isReady(petId: string | null, action: string): boolean {
  return remainMs(petId, action) <= 0;
}

/** 倒计时文案，如 "12s"。可用时返回空串 */
export function remainText(petId: string | null, action: string): string {
  const ms = remainMs(petId, action);
  return ms > 0 ? `${Math.ceil(ms / 1000)}s` : '';
}

/** /boost/speedup 成功后清掉该宠物所有冷却 */
export function clearAll(petId: string | null): void {
  const prefix = `${petId || 'active'}:`;
  Object.keys(endAt).forEach((k) => {
    if (k.indexOf(prefix) === 0) delete endAt[k];
  });
  persist();
}

/** 该宠物是否还有任何冷却在走——决定「花币清冷却」按钮要不要出现 */
export function hasAny(petId: string | null): boolean {
  const prefix = `${petId || 'active'}:`;
  const now = serverNow();
  return Object.keys(endAt).some((k) => k.indexOf(prefix) === 0 && endAt[k] > now);
}
