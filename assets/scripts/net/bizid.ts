/**
 * 幂等键管理。
 *
 * 规则（对齐后端幂等层）：
 * - 一次「用户主动发起」的操作生成一个 bizId，重试期间必须复用，换新 ID 等于发起新交易。
 * - 服务端把成功响应缓存 24 小时，同 bizId 重放会回放旧响应而不会重复扣费/发奖。
 *
 * 这里额外维护一份「未确认操作日志」：请求发出前落盘，拿到明确结果后清除。
 * 如果 App 在请求途中被杀掉，下次冷启动可以带同一个 bizId 重放，
 * 把「钱到底扣没扣、奖到底发没发」问清楚，而不是让玩家自己猜。
 */

import { PENDING_OPS_KEY } from './config';
import { storage } from '../platform/minigame';

export interface PendingOp {
  bizId: string;
  path: string;
  data: Record<string, unknown>;
  at: number;
}

let seq = 0;

/** 后端限制 128 字符（部分接口 64），这个格式最长约 40 字符 */
export function newBizId(action: string): string {
  seq += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${action}:${Date.now()}:${seq}:${rand}`;
}

export function listPendingOps(): PendingOp[] {
  try {
    const raw = storage.get(PENDING_OPS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function save(list: PendingOp[]): void {
  try {
    // 只保留最近 20 条，避免 storage 无限膨胀
    storage.set(PENDING_OPS_KEY, JSON.stringify(list.slice(-20)));
  } catch (e) {
    /* 写不进去只影响补偿能力，不影响本次请求 */
  }
}

export function markPending(bizId: string, path: string, data: Record<string, unknown>): void {
  const list = listPendingOps().filter((op) => op.bizId !== bizId);
  list.push({ bizId, path, data, at: Date.now() });
  save(list);
}

/** 操作已有明确结果（成功或业务失败都算），从日志里摘除 */
export function clearPending(bizId: string): void {
  save(listPendingOps().filter((op) => op.bizId !== bizId));
}

/**
 * 摘出仍在 24 小时幂等窗口内、值得重放的操作。
 * 超过 24 小时服务端缓存已过期，重放拿不到原响应，直接丢弃即可
 * （经济类操作在数据库层还有唯一索引兜底，不会重复发钱）。
 */
export function takeReplayableOps(now: number = Date.now()): PendingOp[] {
  const windowMs = 24 * 60 * 60 * 1000;
  const fresh = listPendingOps().filter((op) => now - op.at < windowMs);
  save(fresh);
  return fresh;
}
