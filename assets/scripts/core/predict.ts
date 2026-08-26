/**
 * 属性衰减的本地预测。
 *
 * 服务端是惰性结算：不跑定时任务，每次读写时按 lastSeenAt 到现在的时长算。
 * 所以两次请求之间，前端要自己把进度条平滑地推下去，否则玩家会看到数值一跳一跳。
 *
 * 铁律：本地预测只用于视觉平滑，任何数值判定（够不够体力、能不能领）
 * 一律以服务端返回为准。
 */

import { elapsedHoursSince } from '../net/clock';
import type { PetStateView } from '../net/types';

/** 衰减速率，与服务端配置默认值一致。真实值以服务端结算结果为准 */
export const RATE = {
  hungerPerHour: 5,
  cleanlinessPerHour: 3,
  staminaPerHour: 10,
  moodPerHour: 2,
  /** 饿肚子或脏了之后额外的心情掉速 */
  moodStarvingPerHour: 3,
};

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

/**
 * 把服务端返回的宠物状态推进到「现在」。
 * @param comfortFactor 来自 GET /home，范围 0–0.3，只减缓心情衰减
 * @returns 预测后的副本，原对象不改
 */
export function predictPet(pet: PetStateView | null, comfortFactor = 0): PetStateView | null {
  if (!pet || !pet.lastSeenAt) return pet;

  const h = elapsedHoursSince(pet.lastSeenAt);
  if (h <= 0) return Object.assign({}, pet);

  const hunger = clamp(pet.hunger - RATE.hungerPerHour * h, 0, 100);
  const cleanliness = clamp(pet.cleanliness - RATE.cleanlinessPerHour * h, 0, 100);
  const stamina = clamp(pet.stamina + RATE.staminaPerHour * h, 0, pet.staminaMax);

  // 饱食或清洁先归零的那一刻起，心情开始加速下滑
  const hungerZeroH = pet.hunger / RATE.hungerPerHour;
  const cleanZeroH = pet.cleanliness / RATE.cleanlinessPerHour;
  const starvingH = Math.max(0, h - Math.min(hungerZeroH, cleanZeroH));
  const moodDecay =
    (RATE.moodPerHour * h + RATE.moodStarvingPerHour * starvingH) * (1 - comfortFactor);
  const mood = clamp(pet.mood - moodDecay, 0, 100);

  return Object.assign({}, pet, { hunger, cleanliness, stamina, mood });
}

/** 经验条进度 0–1，满级（expToNext === 0）返回 1 */
export function expProgress(pet: PetStateView | null): number {
  if (!pet) return 0;
  if (!pet.expToNext) return 1;
  const total = pet.expIntoLevel + pet.expToNext;
  return total > 0 ? pet.expIntoLevel / total : 0;
}

export function isMaxLevel(pet: PetStateView | null): boolean {
  return !!pet && pet.expToNext === 0;
}

/** 主界面气泡的一句话。纯表现层判断，不参与任何业务逻辑 */
export function describeMood(pet: PetStateView | null): string {
  if (!pet) return '';
  if (pet.hunger <= 20) return '肚子饿扁了……';
  if (pet.cleanliness <= 20) return '身上有点脏，想洗澡';
  if (pet.mood <= 20) return '有点无聊，陪我玩会儿吧';
  if (pet.stamina <= 10) return '好累，先歇会儿';
  if (pet.mood >= 80 && pet.hunger >= 80) return '今天心情超好！';
  return '';
}

/** 体力回满还要多久（毫秒），用于展示「XX 后回满」 */
export function staminaFullInMs(pet: PetStateView | null): number {
  if (!pet || pet.stamina >= pet.staminaMax) return 0;
  const need = pet.staminaMax - pet.stamina;
  return (need / RATE.staminaPerHour) * 3600000;
}
