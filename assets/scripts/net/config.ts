/**
 * 网络层配置。
 * 所有可调参数集中在这里，业务代码不要写死地址与超时。
 */

import type { AdScene } from './types';

/** 后端公网地址（微信公众平台 request 合法域名需配置同一个域名） */
export const BASE_URL = 'https://ocqeeuitbygc.sealosbja.site';

/**
 * 本地假后端地址，非空时优先生效。
 *
 * 后端服务不可用期间用它继续开发，配套的假后端是 `_research/mock-server.mjs`
 * （回放 2026-08-26 从真实服务录到的响应）。启动：node _research/mock-server.mjs
 *
 * 后端恢复后把这里置为 '' 即可切回正式地址。上线前必须为空。
 */
export const DEV_BASE_URL = 'http://127.0.0.1:8899';

let baseUrl = DEV_BASE_URL || BASE_URL;

export function getBaseUrl(): string {
  return baseUrl;
}

/** 指向本地假后端或另一套环境时用。正式包不应调用 */
export function setBaseUrl(url: string): void {
  baseUrl = url;
}

/** 单次请求超时。微信默认 60s 太长，弱网下会让玩家一直转圈 */
export const TIMEOUT_MS = 12000;

export const TOKEN_KEY = 'warmpet_token';
export const USER_ID_KEY = 'warmpet_user_id';
/** 未确认的幂等操作日志，用于冷启动补偿 */
export const PENDING_OPS_KEY = 'warmpet_pending_ops';
export const COOLDOWN_KEY = 'warmpet_cooldowns';

/**
 * 假登录标识。
 * 置为 '' 走真实 wx.login；置为 'mid' 等标识走后端 mock 登录（需后端开启 WECHAT_MOCK_LOGIN）。
 * 后端预置账号：newbie(Lv1 空钱包) / mid(Lv8 5000币) / veteran(Lv30 5万币)
 *
 * 浏览器预览里没有 wx.login，这个值为空时会登录失败，所以开发期请保持有值。
 * 生产环境后端会强制关闭该开关，留值也不会生效。
 */
export const MOCK_LOGIN_TAG = 'mid';

export const RETRY = {
  /** 409「请求处理中」的重试次数与间隔 */
  conflictMax: 3,
  conflictDelayMs: 1200,
  /** 网络异常 / 5xx 的重试次数 */
  networkMax: 2,
  networkDelayMs: 800,
};

/** 分页默认值，后端上限 100 */
export const PAGE_SIZE = 20;
export const PAGE_SIZE_MAX = 100;

/**
 * 激励视频广告位 ID，需在微信小游戏后台「流量主 → 广告位管理」创建后填入。
 * 三个场景可以复用同一个广告位，分开配是为了后续能按场景看收益报表。
 * 留空时广告流程走软失败分支，不会卡死玩家。
 */
export const AD_UNIT_ID: Record<AdScene, string> = {
  ad_reward: '',
  race_double: '',
  race_revive: '',
};

/**
 * 广告模拟开关。编辑器预览和开发者工具里没有真实广告可播，
 * 打开后直接当作「已完整观看」，用于联调核销链路。上线前必须置 false。
 */
export const AD_MOCK = true;
