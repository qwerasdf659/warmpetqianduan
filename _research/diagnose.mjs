/**
 * 后端可用性诊断：连续采样 /health 与 /auth/login，记录耗时与网关头。
 * 用来判断是「网络问题」还是「后端依赖挂了」，给后端同学提证据。
 */

import https from 'node:https';

const HOST = 'ocqeeuitbygc.sealosbja.site';

function call(method, path, payload) {
  return new Promise((resolve) => {
    const body = payload ? JSON.stringify(payload) : null;
    const headers = {};
    if (body) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(body);
    }
    const startedAt = Date.now();
    const req = https.request({ hostname: HOST, path, method, headers }, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () =>
        resolve({
          status: res.statusCode,
          ms: Date.now() - startedAt,
          upstreamMs: res.headers['x-envoy-upstream-service-time'],
          body: raw.slice(0, 160),
        }),
      );
    });
    req.setTimeout(30000, () => {
      req.destroy();
      resolve({ status: 0, ms: Date.now() - startedAt, body: 'client timeout' });
    });
    req.on('error', (e) => resolve({ status: 0, ms: Date.now() - startedAt, body: e.message }));
    if (body) req.write(body);
    req.end();
  });
}

const cases = [
  ['GET', '/health', null],
  ['POST', '/auth/login', { code: 'mock:mid' }],
  ['GET', '/wallet', null], // 无令牌，正常应当 401
  ['GET', '/race/tracks', null], // 无令牌，正常应当 401
];

for (let round = 1; round <= 3; round++) {
  console.log(`\n--- 第 ${round} 轮 ---`);
  for (const [method, path, payload] of cases) {
    const r = await call(method, path, payload);
    console.log(
      `${method} ${path.padEnd(14)} status=${r.status} 总耗时=${r.ms}ms 上游=${r.upstreamMs || '-'}ms  ${r.body}`,
    );
  }
}
