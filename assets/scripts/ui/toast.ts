/**
 * 玩家提示。
 *
 * 后端 message 都是可直接展示的中文，所以这里不做错误码到文案的映射，
 * 只负责挑对展示形式：一般错误吐司、封禁弹窗、网络异常给重试入口。
 *
 * **为什么要 setToastHost**：`platform/minigame` 的 showToast/showModal 在没有 wx 的
 * 环境（编辑器预览、浏览器）里只 console.log，屏幕上毫无变化。开发期我们几乎只跑预览，
 * 于是「点了按钮 → 只有 toast → 什么都没发生」和「按钮坏了」表现完全一致，实测误判过。
 * 所以在没有 wx 时退回引擎内自绘的 ToastLayer / ConfirmDialog，两端都看得见。
 */

import { ApiError, toApiError } from '../net/errors';
import { showToast, showModal, isMiniGame } from '../platform/minigame';
import { ToastLayer } from './ToastLayer';
import { ConfirmDialog } from './ConfirmDialog';
import type { Node } from 'cc';
import type { InteractGain } from '../net/types';

/**
 * 自绘提示的挂载点（Canvas 下的 Main 节点），由 Main.onLoad 注入一次。
 * 没注入时退回 console —— 缺提示不该让业务流程崩（铁律：软失败不死亡）。
 */
let host: Node | null = null;

export function setToastHost(node: Node | null): void {
  host = node;
}

export function toast(title: string): void {
  const text = String(title);
  if (!isMiniGame() && host && host.isValid) {
    ToastLayer.show(host, text);
    return;
  }
  showToast(text);
}

export function modal(title: string, content: string, showCancel = false): Promise<boolean> {
  if (!isMiniGame() && host && host.isValid) {
    return ConfirmDialog.show(host, title, content, showCancel);
  }
  return showModal(title, content, showCancel);
}

/** 统一的失败反馈 */
export function showError(err: unknown, opts: { onRetry?: () => void } = {}): Promise<void> {
  const e: ApiError = toApiError(err);

  // 封禁要说清楚原因并给申诉入口，不能静默失败
  if (e.isBanned) {
    return modal('账号异常', `${e.message}\n如有疑问请联系客服处理。`).then(() => undefined);
  }

  // 网络问题给重试，别让玩家只能退出重进
  if (e.isNetwork && opts.onRetry) {
    return modal('网络异常', e.message, true).then((confirmed) => {
      if (confirmed && opts.onRetry) opts.onRetry();
    });
  }

  toast(e.message);
  return Promise.resolve();
}

/** 互动成功后的飘字文案 */
export function gainedText(gained: InteractGain | null): string {
  if (!gained) return '';
  const parts: string[] = [];
  if (gained.intimacy) parts.push(`亲密 +${gained.intimacy}`);
  if (gained.exp) parts.push(`经验 +${gained.exp}`);
  if (gained.coin) parts.push(`金币 +${gained.coin}`);
  return parts.join('  ');
}
