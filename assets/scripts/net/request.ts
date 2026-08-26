/**
 * 请求器。
 *
 * 承担四件事，业务层因此可以只关心「调哪个接口、拿什么数据」：
 *   1. 自动注入 Authorization
 *   2. 401 自动重登一次并重放原请求（body 里的 bizId 不变，天然幂等）
 *   3. 409「请求处理中」带同一 bizId 退避重试
 *   4. 网络异常 / 5xx 对安全请求退避重试
 */

import { getBaseUrl, TIMEOUT_MS, RETRY } from './config';
import { ApiError, fromResponse, fromNetworkFailure, toApiError } from './errors';
import { getToken } from './session';
import { markPending, clearPending } from './bizid';
import { httpRequest, HttpFailure } from '../platform/minigame';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface RequestOptions {
  method?: HttpMethod;
  /** 请求体。字段必须严格按文档传，后端 forbidNonWhitelisted 会把多余字段直接 400 */
  data?: Record<string, unknown>;
  /** query 参数，同样禁止多传 */
  query?: Record<string, unknown> | null;
  auth?: boolean;
  retry?: boolean;
  /** 是否登记未确认操作日志，默认由 data.bizId 决定 */
  journal?: boolean;
  timeout?: number;
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 由 auth.ts 注入，避免 request ←→ auth 循环依赖 */
type ReloginFn = () => Promise<unknown>;
let reloginFn: ReloginFn | null = null;

export function setReloginHandler(fn: ReloginFn): void {
  reloginFn = fn;
}

/** 全局错误观察者：埋点 / 封禁弹窗 / 断网提示 */
export type ApiErrorObserver = (err: ApiError, ctx: { path: string }) => void;
const observers: ApiErrorObserver[] = [];

export function onApiError(fn: ApiErrorObserver): () => void {
  observers.push(fn);
  return () => {
    const i = observers.indexOf(fn);
    if (i >= 0) observers.splice(i, 1);
  };
}

function notify(err: ApiError, path: string): void {
  for (let i = 0; i < observers.length; i++) {
    try {
      observers[i](err, { path });
    } catch (e) {
      /* 观察者自身异常不能影响请求链路 */
    }
  }
}

function buildUrl(path: string, query?: Record<string, unknown> | null): string {
  const url = getBaseUrl() + path;
  if (!query) return url;
  const qs = Object.keys(query)
    .filter((k) => {
      const v = query[k];
      return v !== undefined && v !== null && v !== '';
    })
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(query[k]))}`)
    .join('&');
  return qs ? `${url}?${qs}` : url;
}

/** 单次裸请求，不含任何重试与重登逻辑 */
async function raw<T>(path: string, options: RequestOptions): Promise<T> {
  const header: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.auth !== false) {
    const token = getToken();
    if (token) header.Authorization = `Bearer ${token}`;
  }

  let res;
  try {
    res = await httpRequest({
      url: buildUrl(path, options.query),
      method: options.method || 'GET',
      data: options.data,
      header,
      timeout: options.timeout || TIMEOUT_MS,
    });
  } catch (err) {
    throw fromNetworkFailure(err instanceof HttpFailure ? err.timeout : false);
  }

  if (res.statusCode >= 200 && res.statusCode < 300) return res.data as T;
  throw fromResponse(res.statusCode, res.data);
}

/** 多个请求同时撞到 401 时，只发起一次重登 */
let reloginPromise: Promise<unknown> | null = null;

function reloginOnce(): Promise<unknown> {
  if (!reloginPromise) {
    reloginPromise = Promise.resolve()
      .then(() => {
        if (!reloginFn) throw new ApiError(401, '登录已过期，请重新进入游戏');
        return reloginFn();
      })
      .then(
        (r) => {
          reloginPromise = null;
          return r;
        },
        (e) => {
          reloginPromise = null;
          throw e;
        },
      );
  }
  return reloginPromise;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const data = options.data;
  const bizId = data && typeof data.bizId === 'string' ? data.bizId : '';
  const journal = options.journal !== undefined ? options.journal : !!bizId;
  const allowRetry = options.retry !== false;

  if (journal && bizId) markPending(bizId, path, data as Record<string, unknown>);

  let conflictLeft = allowRetry ? RETRY.conflictMax : 0;
  let networkLeft = allowRetry ? RETRY.networkMax : 0;
  let reloginLeft = 1;

  for (;;) {
    try {
      const res = await raw<T>(path, options);
      if (journal && bizId) clearPending(bizId);
      return res;
    } catch (err) {
      const e = toApiError(err);

      if (e.isAuthExpired && reloginLeft > 0) {
        reloginLeft -= 1;
        try {
          await reloginOnce();
          continue;
        } catch (loginErr) {
          const le = toApiError(loginErr);
          if (journal && bizId) clearPending(bizId);
          notify(le, path);
          throw le;
        }
      }

      // 上一次同 bizId 的请求还在服务端处理，等一会儿带同一 bizId 再问一次结果
      if (e.isProcessing && conflictLeft > 0) {
        conflictLeft -= 1;
        await sleep(RETRY.conflictDelayMs);
        continue;
      }

      // 网络抖动 / 服务端 5xx：带 bizId 的写请求重试是安全的，读请求本身幂等
      const safeToRetry = !!bizId || !options.method || options.method === 'GET';
      if ((e.isNetwork || e.code >= 500) && networkLeft > 0 && safeToRetry) {
        networkLeft -= 1;
        await sleep(RETRY.networkDelayMs);
        continue;
      }

      // 网络原因失败时保留日志，等下次冷启动重放确认；业务失败说明服务端已给出结论
      if (journal && bizId && !e.isNetwork) clearPending(bizId);
      notify(e, path);
      throw e;
    }
  }
}

export function get<T>(path: string, query?: Record<string, unknown> | null, options?: RequestOptions): Promise<T> {
  return request<T>(path, { ...options, method: 'GET', query });
}

export function post<T>(path: string, data?: Record<string, unknown>, options?: RequestOptions): Promise<T> {
  return request<T>(path, { ...options, method: 'POST', data });
}

export function put<T>(path: string, data?: Record<string, unknown>, options?: RequestOptions): Promise<T> {
  return request<T>(path, { ...options, method: 'PUT', data });
}

export function del<T>(path: string, data?: Record<string, unknown>, options?: RequestOptions): Promise<T> {
  return request<T>(path, { ...options, method: 'DELETE', data });
}
