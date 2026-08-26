/**
 * 冷启动。
 *
 *   对表 → 登录 → 补偿未确认操作 → 并发拉首屏数据
 *
 * 首屏渲染只依赖 /pet/state，其余异步补齐，所以 onReady 在拿到宠物后就会触发，
 * 不会因为一个次要接口慢而让玩家干等。
 */

import api from '../net/api';
import { ensureLogin, login } from '../net/auth';
import { syncClock } from '../net/clock';
import { request, onApiError } from '../net/request';
import { takeReplayableOps, clearPending } from '../net/bizid';
import { toApiError } from '../net/errors';
import store from './store';
import type { ApiError } from '../net/errors';
import type { PetStateView } from '../net/types';

export interface BootstrapHooks {
  /** 阶段回调，用于 loading 文案 */
  onProgress?: (stage: string) => void;
  /** 首屏数据就绪（只依赖 /pet/state） */
  onReady?: (pet: PetStateView) => void;
  onBanned?: (err: ApiError) => void;
  onFatal?: (err: ApiError) => void;
}

/**
 * 重放未确认的操作。
 *
 * 场景：玩家点了「购买」，请求发出后 App 被杀掉/断网，客户端不知道钱扣没扣。
 * 带同一个 bizId 再问一次，服务端要么回放上次的结果，要么真正执行一次——
 * 两种情况玩家拿到的都是「恰好一次」。
 *
 * 只重放 24 小时内的记录：超时后服务端幂等缓存已失效，重放没有意义。
 */
async function reconcilePendingOps(): Promise<void> {
  const ops = takeReplayableOps();
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    try {
      const res = await request<Record<string, unknown>>(op.path, {
        method: 'POST',
        data: op.data,
        journal: false,
        retry: false,
      });
      store.applyResponse(res);
    } catch (e) {
      // 业务失败说明服务端已有结论（比如「今日已签到」），同样算确认完毕
    }
    clearPending(op.bizId);
  }
}

export async function bootstrap(hooks: BootstrapHooks = {}) {
  const progress = hooks.onProgress || (() => {});

  if (hooks.onBanned) {
    const onBanned = hooks.onBanned;
    onApiError((err) => {
      if (err.isBanned) onBanned(err);
    });
  }

  // 对表失败不阻塞进游戏，只是本地衰减预测会不准
  progress('对时中');
  await syncClock();

  progress('登录中');
  try {
    await ensureLogin();
  } catch (err) {
    const e = toApiError(err);
    if (hooks.onFatal) hooks.onFatal(e);
    throw e;
  }

  progress('同步进度');
  await reconcilePendingOps();

  progress('加载宠物');
  const petRes = await api.pet.state();
  store.applyPet(petRes.pet);
  if (hooks.onReady) hooks.onReady(petRes.pet);

  // 其余接口并发补齐，任何一个失败都不影响已经能玩的部分
  progress('加载数据');
  const settle = <T>(p: Promise<T>, apply: (r: T) => void) => p.then(apply).catch(() => {});
  await Promise.all([
    settle(api.wallet.balance(), (r) => store.applyWallet(r.wallet)),
    settle(api.pet.offline(), (r) => store.applyOffline(r)),
    settle(api.daily.info(), (r) => store.applyDaily(r)),
    settle(api.home.info(), (r) => store.applyHome(r)),
    settle(api.pet.list(), (r) => store.applyPets(r.pets)),
  ]);

  progress('完成');
  return store;
}

/**
 * 从后台切回前台时调用。
 * 离开期间宠物一直在衰减、体力一直在恢复，重新拉一次才对得上。
 */
export async function refreshOnShow(): Promise<void> {
  try {
    await syncClock();
    const results = await Promise.all([api.pet.state(), api.pet.offline()]);
    store.applyPet(results[0].pet);
    store.applyOffline(results[1]);
  } catch (e) {
    // 切前台刷新失败就用旧数据继续显示，下次操作时自然会拿到新状态
  }
}

/** 主动重登，用于封禁申诉后或切换测试账号 */
export function relogin() {
  store.reset();
  return login();
}
