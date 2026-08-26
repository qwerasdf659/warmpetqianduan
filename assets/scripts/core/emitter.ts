/**
 * 极简事件总线，供 store 向 UI 广播状态变更。
 *
 * 没有引第三方包：store 这类纯逻辑模块要能在 Node 下跑测试，
 * 原生实现三十行比处理模块互操作更省事。
 */

type Handler = { fn: (...args: any[]) => void; ctx?: unknown };

export default class Emitter {
  private handlers: Record<string, Handler[]> = {};

  on(event: string, fn: (...args: any[]) => void, ctx?: unknown): this {
    (this.handlers[event] || (this.handlers[event] = [])).push({ fn, ctx });
    return this;
  }

  once(event: string, fn: (...args: any[]) => void, ctx?: unknown): this {
    const wrapper = (...args: any[]) => {
      this.off(event, wrapper);
      fn.apply(ctx, args);
    };
    (wrapper as any)._origin = fn;
    return this.on(event, wrapper, ctx);
  }

  off(event: string, fn?: (...args: any[]) => void): this {
    const list = this.handlers[event];
    if (!list) return this;
    if (!fn) {
      delete this.handlers[event];
      return this;
    }
    const kept = list.filter((h) => h.fn !== fn && (h.fn as any)._origin !== fn);
    if (kept.length) this.handlers[event] = kept;
    else delete this.handlers[event];
    return this;
  }

  emit(event: string, ...args: any[]): this {
    const list = this.handlers[event];
    if (!list) return this;
    // 复制一份，允许回调里 off 自己
    list.slice().forEach((h) => h.fn.apply(h.ctx, args));
    return this;
  }
}
