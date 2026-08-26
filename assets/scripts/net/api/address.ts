/**
 * 收货地址 /address
 *
 * 列表按 isDefault 降序 + id 降序返回，所以默认地址永远是第一条。
 * 设置某个地址为默认时服务端会自动取消其他地址的默认标记。
 */

import { get, post, put, del } from '../request';
import type { UserAddress, AddressInput } from '../types';

/** 字段长度限制，输入框应同步限制，避免白跑一趟 400 */
export const LIMITS = { receiver: 32, phone: 20, region: 128, detail: 255 };

export const list = (): Promise<{ list: UserAddress[] }> => get('/address');

export const create = (data: AddressInput): Promise<{ address: UserAddress }> =>
  post('/address', data as Record<string, unknown>, { journal: false });

/** 修改。所有字段可选，只传要改的 */
export const update = (id: string, data: AddressInput): Promise<{ address: UserAddress }> =>
  put(`/address/${id}`, data as Record<string, unknown>, { journal: false });

export const remove = (id: string): Promise<{ ok: boolean }> =>
  del(`/address/${id}`, undefined, { journal: false });

/** 提交前的本地校验，返回第一条错误文案，通过则返回空串 */
export function validate(data: AddressInput): string {
  if (!data.receiver || !data.receiver.trim()) return '请填写收货人';
  if (data.receiver.length > LIMITS.receiver) return `收货人不超过 ${LIMITS.receiver} 字`;
  if (!/^1[3-9]\d{9}$/.test(data.phone || '')) return '请填写正确的手机号';
  if (!data.region || !data.region.trim()) return '请选择所在地区';
  if (data.region.length > LIMITS.region) return `所在地区不超过 ${LIMITS.region} 字`;
  if (!data.detail || !data.detail.trim()) return '请填写详细地址';
  if (data.detail.length > LIMITS.detail) return `详细地址不超过 ${LIMITS.detail} 字`;
  return '';
}

/** 默认地址永远是第一条 */
export function pickDefault(addresses: UserAddress[]): UserAddress | null {
  return (addresses && addresses[0]) || null;
}
