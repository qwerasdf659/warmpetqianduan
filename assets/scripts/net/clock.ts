/**
 * 服务端时钟对齐。
 *
 * 铁律：不信任客户端时钟。属性衰减的本地预测要拿 lastSeenAt（服务端时间）
 * 和「现在」作差，如果「现在」用玩家改过的系统时间，进度条会跳得离谱。
 * 这里用 /health 返回的时间校出一个偏移量，之后统一用 serverNow()。
 *
 * 偏移只用于表现层平滑，任何数值判定仍以服务端返回为准。
 */

import { get } from './request';
import type { HealthView } from './types';

let offsetMs = 0;
let synced = false;

/** 服务端「现在」的毫秒时间戳 */
export function serverNow(): number {
  return Date.now() + offsetMs;
}

export function isSynced(): boolean {
  return synced;
}

export function getOffsetMs(): number {
  return offsetMs;
}

/**
 * 与服务端对表。失败不抛错——对不上表只是预测不准，不该阻塞进游戏。
 */
export async function syncClock(): Promise<boolean> {
  const sentAt = Date.now();
  try {
    const res = await get<HealthView>('/health', null, { auth: false, retry: false });
    const serverMs = Date.parse(res && res.time);
    if (!serverMs) return false;
    // 用 RTT 的一半补偿单程延迟
    const rtt = Date.now() - sentAt;
    offsetMs = serverMs + rtt / 2 - Date.now();
    synced = true;
    return true;
  } catch (e) {
    return false;
  }
}

export function parseServerTime(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? 0 : ms;
}

/** 距某个服务端时间点过去了多少小时，用于衰减公式的 elapsedH */
export function elapsedHoursSince(iso: string): number {
  const ms = parseServerTime(iso);
  if (!ms) return 0;
  return Math.max(0, (serverNow() - ms) / 3600000);
}
