/**
 * 在 Node 里模拟小游戏运行时，用于把网络层跑一遍真实后端。
 * 只实现前端代码用到的那几个 wx API，不参与小游戏打包。
 */

import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';

const storage = new Map();

function doRequest({ url, method = 'GET', data, header = {}, timeout = 12000, success, fail }) {
  const u = new URL(url);
  const lib = u.protocol === 'https:' ? https : http;
  const body = data === undefined ? null : JSON.stringify(data);
  const headers = { ...header };
  if (body) headers['Content-Length'] = Buffer.byteLength(body);

  const req = lib.request(
    { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers },
    (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        let parsed = raw;
        try {
          parsed = JSON.parse(raw);
        } catch (e) {
          /* 非 JSON 原样返回 */
        }
        success && success({ statusCode: res.statusCode, data: parsed });
      });
    },
  );

  req.setTimeout(timeout, () => {
    req.destroy();
    fail && fail({ errMsg: 'request:fail timeout' });
  });
  req.on('error', (e) => fail && fail({ errMsg: `request:fail ${e.message}` }));
  if (body) req.write(body);
  req.end();
}

globalThis.wx = {
  request: doRequest,
  getStorageSync: (k) => (storage.has(k) ? storage.get(k) : ''),
  setStorageSync: (k, v) => storage.set(k, v),
  removeStorageSync: (k) => storage.delete(k),
  login: ({ success }) => success({ code: 'stub-code' }),
  showToast: () => {},
  showLoading: () => {},
  hideLoading: () => {},
  showModal: ({ success }) => success && success({ confirm: true }),
  createRewardedVideoAd: undefined,
  getMenuButtonBoundingClientRect: () => ({ top: 24, bottom: 56, left: 300, right: 360 }),
};

export function resetStorage() {
  storage.clear();
}
