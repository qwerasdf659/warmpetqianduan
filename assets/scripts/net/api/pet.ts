/** 宠物模块 /pet */

import { get, post, put } from '../request';
import { newBizId } from '../bizid';
import type { PetStateView, InteractResult, OfflineView, PetAction } from '../types';

/**
 * 出战宠状态。玩家还没有宠物时后端会自动建一只并返回，
 * 所以冷启动应该先调这个，不需要处理「无宠」分支。
 */
export const state = (petId?: string): Promise<{ pet: PetStateView }> =>
  get('/pet/state', petId ? { petId } : null);

/** 我的宠物列表。与 /pet/state 不同，这个接口不会自动建宠 */
export const list = (): Promise<{ pets: PetStateView[] }> => get('/pet/list');

export const offline = (): Promise<OfflineView> => get('/pet/offline');

/** 领取离线收益。claimableCoin < 1 时会 400，前端应在预览值为 0 时禁用按钮 */
export const claimOffline = (bizId?: string): Promise<{ gained: number; gameCoin: number }> =>
  post('/pet/offline/claim', { bizId: bizId || newBizId('offline') });

/** 新建宠物，最多 6 只。nickname / species 各限 32 字符 */
export function create(opts: { nickname?: string; species?: string; bizId?: string } = {}): Promise<{ pet: PetStateView }> {
  const data: Record<string, unknown> = { bizId: opts.bizId || newBizId('petcreate') };
  if (opts.nickname) data.nickname = opts.nickname;
  if (opts.species) data.species = opts.species;
  return post('/pet/create', data);
}

/** 切换出战宠。不涉及资源变动，无 bizId */
export const setActive = (petId: string): Promise<{ pet: PetStateView }> =>
  put('/pet/active', { petId });

export const ACTIONS: PetAction[] = ['feed', 'bath', 'pet', 'play'];

/**
 * 互动。冷却时长以响应的 cooldownRemainMs 为准，前端本地倒计时，429 只作兜底。
 * petId 省略则作用于出战宠。
 */
export function interact(
  action: PetAction,
  opts: { petId?: string; bizId?: string } = {},
): Promise<InteractResult> {
  const data: Record<string, unknown> = { bizId: opts.bizId || newBizId(action) };
  if (opts.petId) data.petId = opts.petId;
  return post(`/pet/${action}`, data);
}

export const feed = (opts?: { petId?: string; bizId?: string }) => interact('feed', opts);
export const bath = (opts?: { petId?: string; bizId?: string }) => interact('bath', opts);
export const caress = (opts?: { petId?: string; bizId?: string }) => interact('pet', opts);
export const play = (opts?: { petId?: string; bizId?: string }) => interact('play', opts);
