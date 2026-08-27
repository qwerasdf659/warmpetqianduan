/**
 * 开发期把游戏进程的 console 转发给本地 MCP 服务，方便在编辑器外读日志。
 *
 * 游戏预览跑在独立进程里，它的 console 不会进 Cocos 的控制台面板，
 * 排查「宠物没出现」这类问题时只能靠截图，很低效。转发之后就能直接读。
 *
 * 服务没起时静默失败，所以留在开发包里也无害；但正式包必须关闭——
 * 判据是 DEV_BASE_URL，它在上线前本来就要求置空（见 net/config）。
 */

import { DEV_BASE_URL } from '../net/config';

const LOG_URL = 'http://127.0.0.1:3000/log';
const FLUSH_INTERVAL_MS = 500;
const MAX_BATCH = 50;

type Entry = { timestamp: string; level: string; message: string };

let installed = false;
let buffer: Entry[] = [];

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function hook(level: string, original: (...args: unknown[]) => void) {
  return function (...args: unknown[]) {
    original.apply(console, args);
    // 缓冲区要封顶，否则死循环里的日志会把内存吃光
    if (buffer.length < 500) {
      buffer.push({
        timestamp: new Date().toISOString(),
        level,
        message: args.map(stringify).join(' '),
      });
    }
  };
}

function flush() {
  if (buffer.length === 0) return;
  const entries = buffer.splice(0, MAX_BATCH);
  if (typeof fetch !== 'function') return;
  // 预览跑在另一个端口上，靠服务端的 Access-Control-Allow-Origin: * 放行，
  // 预检请求它也返回 204，所以这里用标准 JSON 请求即可。
  fetch(LOG_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entries),
  }).catch(() => {
    // 服务没起就丢掉，不重试也不报错——它只是个调试辅助
  });
}

/** 只在连着本地假后端时生效，正式包里 DEV_BASE_URL 为空，这里直接返回 */
export function initDevConsole(): void {
  if (installed || !DEV_BASE_URL) return;
  installed = true;

  console.log = hook('log', console.log);
  console.warn = hook('warn', console.warn);
  console.error = hook('error', console.error);

  setInterval(flush, FLUSH_INTERVAL_MS);

  // 心跳。没有这条就分不清「转发器没装上」和「本来就没日志可发」
  console.log('[devConsole] 日志转发已启用');
}
