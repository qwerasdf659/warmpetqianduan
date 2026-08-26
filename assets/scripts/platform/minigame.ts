/**
 * 平台适配层。
 *
 * 同一份业务代码要在两个地方跑：
 *   - 微信小游戏运行时：有 wx，按规范走 wx.request / wx.setStorageSync
 *   - Cocos 编辑器预览（浏览器）：没有 wx，退化到 XMLHttpRequest / localStorage
 *
 * 没有这一层的话，开发期每改一行都得构建成小游戏才能验证，效率会很难看。
 * 上层只认这里导出的 httpRequest / storage，不直接碰 wx。
 */

export interface HttpOptions {
  url: string;
  method?: string;
  data?: unknown;
  header?: Record<string, string>;
  timeout?: number;
}

export interface HttpResult {
  statusCode: number;
  data: any;
}

/** 网络层失败（连不上、超时），与「服务端返回了错误码」是两回事 */
export class HttpFailure extends Error {
  public timeout: boolean;

  constructor(message: string, timeout: boolean) {
    super(message);
    this.name = 'HttpFailure';
    this.timeout = timeout;
  }
}

/** 拿到宿主环境的 wx 对象；不在小游戏里就是 null */
function getWx(): any {
  const g = globalThis as any;
  return g && g.wx && typeof g.wx.request === 'function' ? g.wx : null;
}

export function isMiniGame(): boolean {
  return getWx() !== null;
}

// ---- HTTP ----

function requestByWx(wx: any, opts: HttpOptions): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    wx.request({
      url: opts.url,
      method: opts.method || 'GET',
      data: opts.data,
      header: opts.header,
      timeout: opts.timeout,
      success: (res: any) => resolve({ statusCode: res.statusCode, data: res.data }),
      fail: (err: any) => {
        const msg = (err && err.errMsg) || '';
        reject(new HttpFailure(msg, msg.indexOf('timeout') >= 0));
      },
    });
  });
}

function requestByXhr(opts: HttpOptions): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(opts.method || 'GET', opts.url, true);
    xhr.timeout = opts.timeout || 0;

    const header = opts.header || {};
    Object.keys(header).forEach((k) => xhr.setRequestHeader(k, header[k]));

    xhr.onload = () => {
      let parsed: any = xhr.responseText;
      try {
        parsed = JSON.parse(xhr.responseText);
      } catch (e) {
        /* 非 JSON 原样返回，交给上层判断 */
      }
      resolve({ statusCode: xhr.status, data: parsed });
    };
    xhr.onerror = () => reject(new HttpFailure('request:fail', false));
    xhr.ontimeout = () => reject(new HttpFailure('request:fail timeout', true));

    xhr.send(opts.data === undefined ? null : JSON.stringify(opts.data));
  });
}

export function httpRequest(opts: HttpOptions): Promise<HttpResult> {
  const wx = getWx();
  return wx ? requestByWx(wx, opts) : requestByXhr(opts);
}

// ---- 本地存储 ----

/** 浏览器里 localStorage 可能被隐私模式禁用，再退一层到内存 */
const memoryStore: Record<string, string> = {};

export const storage = {
  get(key: string): string {
    const wx = getWx();
    if (wx) {
      try {
        return wx.getStorageSync(key) || '';
      } catch (e) {
        return '';
      }
    }
    try {
      return localStorage.getItem(key) || '';
    } catch (e) {
      return memoryStore[key] || '';
    }
  },

  set(key: string, value: string): void {
    const wx = getWx();
    if (wx) {
      try {
        wx.setStorageSync(key, value);
      } catch (e) {
        /* 配额写满等异常吞掉：缓存丢失只应导致重新拉取，不该让游戏崩 */
      }
      return;
    }
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      memoryStore[key] = value;
    }
  },

  remove(key: string): void {
    const wx = getWx();
    if (wx) {
      try {
        wx.removeStorageSync(key);
      } catch (e) {
        /* 同上 */
      }
      return;
    }
    try {
      localStorage.removeItem(key);
    } catch (e) {
      delete memoryStore[key];
    }
  },
};

// ---- 微信登录 ----

/** 取 wx.login 的 code。不在小游戏里就 reject，由上层决定是否走假登录 */
export function wxLogin(): Promise<string> {
  const wx = getWx();
  if (!wx || typeof wx.login !== 'function') {
    return Promise.reject(new Error('当前环境不支持微信登录'));
  }
  return new Promise((resolve, reject) => {
    wx.login({
      success: (res: any) => (res && res.code ? resolve(res.code) : reject(new Error('微信登录失败'))),
      fail: () => reject(new Error('微信登录失败')),
    });
  });
}

// ---- 激励视频广告 ----

export interface RewardedVideoAd {
  load(): Promise<void>;
  show(): Promise<void>;
  onClose(cb: (res: { isEnded: boolean }) => void): void;
  offClose(cb: (res: { isEnded: boolean }) => void): void;
  onError(cb: (err: any) => void): void;
  offError(cb: (err: any) => void): void;
}

/** 微信要求同一广告位复用实例，重复 create 会白白多注册回调 */
const adInstances: Record<string, RewardedVideoAd> = {};

export function createRewardedVideoAd(adUnitId: string): RewardedVideoAd | null {
  const wx = getWx();
  if (!wx || typeof wx.createRewardedVideoAd !== 'function' || !adUnitId) return null;
  if (!adInstances[adUnitId]) {
    adInstances[adUnitId] = wx.createRewardedVideoAd({ adUnitId });
  }
  return adInstances[adUnitId];
}

// ---- 界面反馈 ----

export function showToast(title: string): void {
  const wx = getWx();
  if (wx && typeof wx.showToast === 'function') {
    wx.showToast({ title: title.slice(0, 30), icon: 'none', duration: 2000 });
    return;
  }
  console.log(`[toast] ${title}`);
}

export function showModal(title: string, content: string, showCancel: boolean): Promise<boolean> {
  const wx = getWx();
  if (wx && typeof wx.showModal === 'function') {
    return new Promise((resolve) => {
      wx.showModal({
        title,
        content,
        showCancel,
        success: (res: any) => resolve(!!res.confirm),
        fail: () => resolve(false),
      });
    });
  }
  console.log(`[modal] ${title}: ${content}`);
  return Promise.resolve(true);
}

/**
 * 右上角胶囊按钮的位置，顶部 UI 必须避让它。
 * 拿不到就返回一个保守的默认值。
 */
export function getMenuButtonRect(): { top: number; bottom: number; height: number } {
  const wx = getWx();
  if (wx && typeof wx.getMenuButtonBoundingClientRect === 'function') {
    try {
      const r = wx.getMenuButtonBoundingClientRect();
      if (r && typeof r.top === 'number') {
        return { top: r.top, bottom: r.bottom, height: r.height };
      }
    } catch (e) {
      /* 取不到就走默认值 */
    }
  }
  return { top: 24, bottom: 56, height: 32 };
}

/** 切前台回调，用于回来时重新拉取宠物状态 */
export function onShow(cb: () => void): void {
  const wx = getWx();
  if (wx && typeof wx.onShow === 'function') wx.onShow(cb);
}
