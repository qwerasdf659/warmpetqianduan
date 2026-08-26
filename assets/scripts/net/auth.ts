/**
 * 登录。
 *
 * 流程：wx.login() → code → POST /auth/login → { token, userId } → 落盘
 * token 有效期 7 天，收到 401 由 request.ts 自动走一次重登并重放原请求。
 */

import { MOCK_LOGIN_TAG } from './config';
import { post, setReloginHandler } from './request';
import { ApiError, toApiError } from './errors';
import { saveSession, clearSession, getToken, getUserId, hasSession } from './session';
import { wxLogin } from '../platform/minigame';
import type { LoginResult } from './types';

export { getToken, getUserId, hasSession };

/** 取微信登录凭证。mock 模式下直接造一个后端认识的假 code */
function fetchCode(): Promise<string> {
  if (MOCK_LOGIN_TAG) return Promise.resolve(`mock:${MOCK_LOGIN_TAG}`);
  return wxLogin().catch(() => {
    throw new ApiError(401, '微信登录失败，请重新进入游戏');
  });
}

let loginPromise: Promise<LoginResult> | null = null;

/** 登录并持久化会话。并发调用共享同一次请求 */
export function login(): Promise<LoginResult> {
  if (loginPromise) return loginPromise;

  loginPromise = fetchCode()
    .then((code) => post<LoginResult>('/auth/login', { code }, { auth: false, journal: false }))
    .then((res) => {
      saveSession(res.token, String(res.userId));
      loginPromise = null;
      return { token: res.token, userId: String(res.userId) };
    })
    .catch((err) => {
      loginPromise = null;
      // 令牌无效时清掉本地缓存，避免下次冷启动继续拿着废 token 请求
      const e = toApiError(err);
      if (e.isAuthExpired) clearSession();
      throw e;
    });

  return loginPromise;
}

/** 已有会话就直接用，没有才登录。冷启动首选这个 */
export function ensureLogin(): Promise<LoginResult> {
  if (hasSession()) return Promise.resolve({ token: getToken(), userId: getUserId() });
  return login();
}

export function logout(): void {
  clearSession();
}

// 让 request.ts 在 401 时能回头调登录
setReloginHandler(() => {
  clearSession();
  return login();
});
