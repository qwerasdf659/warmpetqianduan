/**
 * 会话状态：token 与 userId 的内存副本 + 持久化。
 * 单独成模块是为了避免 request 与 auth 互相 import 形成环。
 */

import { TOKEN_KEY, USER_ID_KEY } from './config';
import { storage } from '../platform/minigame';

let token = storage.get(TOKEN_KEY);
let userId = storage.get(USER_ID_KEY);

export function getToken(): string {
  return token;
}

export function getUserId(): string {
  return userId;
}

export function hasSession(): boolean {
  return !!token;
}

export function saveSession(nextToken: string, nextUserId: string): void {
  token = nextToken || '';
  userId = nextUserId ? String(nextUserId) : '';
  storage.set(TOKEN_KEY, token);
  storage.set(USER_ID_KEY, userId);
}

export function clearSession(): void {
  token = '';
  userId = '';
  storage.remove(TOKEN_KEY);
  storage.remove(USER_ID_KEY);
}
