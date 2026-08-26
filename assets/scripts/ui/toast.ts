/**
 * 玩家提示。
 *
 * 后端 message 都是可直接展示的中文，所以这里不做错误码到文案的映射，
 * 只负责挑对展示形式：一般错误吐司、封禁弹窗、网络异常给重试入口。
 */

import { ApiError, toApiError } from '../net/errors';
import { showToast, showModal } from '../platform/minigame';
import type { InteractGain } from '../net/types';

export function toast(title: string): void {
  showToast(String(title));
}

export function modal(title: string, content: string, showCancel = false): Promise<boolean> {
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
