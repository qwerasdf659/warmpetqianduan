/**
 * 家园模块 /home
 *
 * 舒适度影响两件事：心情衰减减缓、离线时薪加成，
 * comfortFactor = min(comfort / 100, 0.3)，堆到 100 就到顶。
 */

import { get, post } from '../request';
import { newBizId } from '../bizid';
import type { HomeView, FurnitureItem, BuyResult } from '../types';

/** 家具 + 布局 + 舒适度。坐标从 0 起，左上角为原点 */
export const info = (): Promise<HomeView> => get('/home');

export const buy = (itemKey: string, bizId?: string): Promise<BuyResult> =>
  post('/home/buy', { bizId: bizId || newBizId('furnbuy'), itemKey });

/** 摆放。坐标可省略，服务端会自动找空位 */
export function place(itemKey: string, posX?: number, posY?: number): Promise<HomeView> {
  const data: Record<string, unknown> = { itemKey };
  if (posX !== undefined && posX !== null) data.posX = posX;
  if (posY !== undefined && posY !== null) data.posY = posY;
  return post('/home/place', data, { journal: false });
}

/** 收纳。layoutId 来自 HomeView.placed[].layoutId */
export const remove = (layoutId: string): Promise<HomeView> =>
  post('/home/remove', { layoutId }, { journal: false });

/** 舒适度加成的上限，UI 上应标出来避免玩家白花钱 */
export const COMFORT_CAP = 100;
export const FACTOR_CAP = 0.3;

export function comfortToFactor(comfort: number): number {
  return Math.min((comfort || 0) / 100, FACTOR_CAP);
}

export interface PlaceCheck {
  ok: boolean;
  reason?: string;
}

/**
 * 本地碰撞检测。拖拽摆放时先本地判一次，把服务端的 400 当兜底，
 * 这样拖动过程中就能实时高亮「这里放不下」。
 */
export function canPlace(
  view: HomeView | null,
  posX: number,
  posY: number,
  gridW: number,
  gridH: number,
  ignoreLayoutId?: string,
): PlaceCheck {
  const grid = (view && view.grid) || { width: 6, height: 6 };
  if (posX < 0 || posY < 0 || posX + gridW > grid.width || posY + gridH > grid.height) {
    return {
      ok: false,
      reason: `摆放位置超出房间范围（房间 ${grid.width}×${grid.height}，该家具占 ${gridW}×${gridH}）`,
    };
  }

  const placed = (view && view.placed) || [];
  for (let i = 0; i < placed.length; i++) {
    const p = placed[i];
    if (ignoreLayoutId && p.layoutId === ignoreLayoutId) continue;
    const overlapX = posX < p.posX + p.gridW && p.posX < posX + gridW;
    const overlapY = posY < p.posY + p.gridH && p.posY < posY + gridH;
    if (overlapX && overlapY) return { ok: false, reason: '该位置已有家具，请换个位置' };
  }

  return { ok: true };
}

/** 从左上角逐格扫，找第一个放得下的位置。用于「一键摆放」 */
export function findFreeSlot(
  view: HomeView | null,
  gridW: number,
  gridH: number,
): { posX: number; posY: number } | null {
  const grid = (view && view.grid) || { width: 6, height: 6 };
  for (let y = 0; y + gridH <= grid.height; y++) {
    for (let x = 0; x + gridW <= grid.width; x++) {
      if (canPlace(view, x, y, gridW, gridH).ok) return { posX: x, posY: y };
    }
  }
  return null;
}

/** 可摆放数 = 持有数 - 已摆放数 */
export function placeableCount(item: FurnitureItem): number {
  return Math.max(0, (item.owned || 0) - (item.placed || 0));
}
