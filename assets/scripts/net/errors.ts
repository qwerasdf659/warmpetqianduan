/**
 * 统一错误模型。
 *
 * 后端异常一律是 { code, message }，message 在参数校验失败时是字符串数组。
 * 后端所有 message 都是可直接展示给玩家的中文，所以前端不维护错误码到文案的映射表。
 */

/** 本地产生的错误码，后端不会返回负数 */
export const ERR_NETWORK = -1;
export const ERR_TIMEOUT = -2;

export class ApiError extends Error {
  public code: number;
  /** 校验失败时的完整 message 数组，便于开发期排查 */
  public detail: string[] | null;

  constructor(code: number, message: string, detail?: string[] | null) {
    super(message || '未知错误');
    this.name = 'ApiError';
    this.code = code;
    this.detail = detail || null;
    // TS 4.1 目标下继承内置 Error 会丢原型链，手动补回来，否则 instanceof 失效
    Object.setPrototypeOf(this, ApiError.prototype);
  }

  /** 令牌失效，需要重新登录 */
  get isAuthExpired(): boolean {
    return this.code === 401;
  }

  /** 账号被封禁：读接口仍可用，写接口全部 403 */
  get isBanned(): boolean {
    return this.code === 403;
  }

  /** 上一次同 bizId 的请求还在处理，带同一 bizId 重试即可拿到结果 */
  get isProcessing(): boolean {
    return this.code === 409;
  }

  get isCooldown(): boolean {
    return this.code === 429;
  }

  /** 网络层失败，与后端业务无关 */
  get isNetwork(): boolean {
    return this.code === ERR_NETWORK || this.code === ERR_TIMEOUT;
  }

  get isRetryable(): boolean {
    return this.isNetwork || this.isProcessing || this.code >= 500;
  }
}

export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  const message = err && (err as Error).message ? (err as Error).message : '未知错误';
  return new ApiError(500, message);
}

function defaultMessage(statusCode: number): string {
  if (statusCode === 401) return '登录已过期，请重新进入游戏';
  if (statusCode === 403) return '账号已被封禁';
  if (statusCode >= 500) return '服务器开小差了，请稍后重试';
  return '请求失败，请稍后重试';
}

/** 把非 2xx 响应归一化成 ApiError */
export function fromResponse(statusCode: number, body: any): ApiError {
  const data = body || {};
  const raw = data.message;
  const message = Array.isArray(raw) ? raw[0] : raw;
  return new ApiError(
    typeof data.code === 'number' ? data.code : statusCode,
    message || defaultMessage(statusCode),
    Array.isArray(raw) ? raw : null,
  );
}

export function fromNetworkFailure(timeout: boolean): ApiError {
  return timeout
    ? new ApiError(ERR_TIMEOUT, '网络超时，请稍后重试')
    : new ApiError(ERR_NETWORK, '网络异常，请检查网络后重试');
}

/**
 * 从「冷却中，还需 N 秒」里抠出秒数，用于兜底起本地倒计时。
 *
 * 这个做法很脆——文案一改就静默失效。已在《后端配合需求清单》里
 * 请后端在 429 响应体里加结构化的 cooldownRemainMs，加上之后这里就能删了。
 */
export function parseCooldownSec(message: string): number {
  const m = /(\d+)\s*秒/.exec(message || '');
  return m ? Number(m[1]) : 0;
}
