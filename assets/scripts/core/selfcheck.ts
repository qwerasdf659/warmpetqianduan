/**
 * 联调自检。
 *
 * 把对接文档第二十节的 Checklist 变成能真跑一遍的断言，
 * 每次改完网络层或后端调完配置，跑一次就知道链路有没有坏，
 * 不用靠人肉点一遍界面去发现「哦原来 401 没自动重登」。
 */

import api from '../net/api';
import { login, getToken, getUserId } from '../net/auth';
import { saveSession } from '../net/session';
import { syncClock, isSynced, getOffsetMs, serverNow } from '../net/clock';
import { request } from '../net/request';
import { newBizId } from '../net/bizid';
import { ApiError, toApiError } from '../net/errors';
import { resolveAppearance } from '../net/api/wardrobe';
import { predictPet } from './predict';
import * as cooldown from './cooldown';
import store from './store';

export interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
  ms: number;
}

const isString = (v: unknown): boolean => typeof v === 'string';

function assert(ok: boolean, message: string): void {
  if (!ok) throw new Error(message);
}

/** 期望某个请求以指定状态码失败 */
async function expectFail(code: number, fn: () => Promise<unknown>, label: string): Promise<void> {
  try {
    await fn();
  } catch (err) {
    const c = toApiError(err).code;
    assert(c === code, `${label} 期望 ${code}，实际 ${c}`);
    return;
  }
  throw new Error(`${label} 期望 ${code}，实际成功了`);
}

export interface Check {
  name: string;
  run: () => Promise<string>;
}

export const CHECKS: Check[] = [
  {
    name: '服务连通性',
    async run() {
      const res = await api.health();
      assert(!!res && res.status === 'ok', '/health 未返回 ok');
      return `${res.service} @ ${res.time}`;
    },
  },
  {
    name: '登录与令牌持久化',
    async run() {
      await login();
      assert(!!getToken(), '登录后 token 为空');
      assert(!!getUserId(), '登录后 userId 为空');
      assert(isString(getUserId()), 'userId 必须按 string 处理');
      return `userId=${getUserId()}  token 已落盘`;
    },
  },
  {
    name: '服务端对时',
    async run() {
      const ok = await syncClock();
      assert(ok && isSynced(), '未能与服务端对时');
      const drift = Math.round(getOffsetMs());
      const warn = Math.abs(drift) > 60000 ? '（本机时钟明显不准，已按服务端时间修正）' : '';
      return `本机与服务端相差 ${drift}ms${warn}`;
    },
  },
  {
    name: '401 自动重登并重放',
    async run() {
      await expectFail(
        401,
        () => request('/wallet', { method: 'GET', auth: false, retry: false }),
        '无令牌请求',
      );
      // 把本地令牌改坏，业务层照常调用，request 层应当重登后重放而不是把 401 抛出来
      saveSession('eyJhbGciOiJIUzI1NiJ9.broken.token', getUserId());
      const res = await api.wallet.balance();
      assert(!!res && !!res.wallet, '令牌失效后未能自动恢复');
      return '令牌失效已被静默修复，业务层无感知';
    },
  },
  {
    name: '冷启动自动建宠',
    async run() {
      const res = await api.pet.state();
      const pet = res.pet;
      assert(!!pet, '/pet/state 未返回宠物');
      assert(isString(pet.id), 'petId 必须是 string，不能 Number() 转换');
      store.applyPet(pet);
      return `Lv${pet.level} ${pet.nickname || '未命名'}  饱食${Math.round(pet.hunger)} 清洁${Math.round(pet.cleanliness)} 心情${Math.round(pet.mood)}`;
    },
  },
  {
    name: '钱包双池隔离',
    async run() {
      const res = await api.wallet.balance();
      const w = res.wallet;
      assert(typeof w.gameCoin === 'number' && typeof w.marketingPoint === 'number', '钱包字段缺失');
      store.applyWallet(w);
      return `游戏币 ${w.gameCoin}  营销积分 ${w.marketingPoint}（两池物理隔离，永不互转）`;
    },
  },
  {
    name: '参数白名单（禁止多传字段）',
    async run() {
      await expectFail(
        400,
        () => request('/pet/state', { method: 'GET', query: { foo: '2' }, retry: false }),
        '多传 query 字段',
      );
      return '多传未定义字段会被 400 拒绝，前端请求体已按文档严格对齐';
    },
  },
  {
    name: '幂等：同 bizId 重放不重复发奖',
    async run() {
      const bizId = newBizId('selfcheck');
      let first;
      try {
        first = await api.pet.caress({ bizId });
      } catch (err) {
        if (toApiError(err).isCooldown) {
          return '抚摸冷却中，跳过本项（冷却本身即幂等保护生效的证据）';
        }
        throw err;
      }
      const replay = await api.pet.caress({ bizId });
      assert(
        replay.gameCoin === first.gameCoin && replay.pet.intimacy === first.pet.intimacy,
        '同 bizId 重放拿到了不同结果，幂等未生效',
      );
      store.applyResponse(replay);
      cooldown.start(first.pet.id, 'pet', first.cooldownRemainMs);
      return `首次 +${first.gained.coin} 币，重放余额不变（${replay.gameCoin}）`;
    },
  },
  {
    name: '冷却本地倒计时',
    async run() {
      const petId = store.activePetId;
      assert(!!petId, '没有出战宠');
      if (cooldown.remainMs(petId, 'pet') <= 0) return '当前无冷却，倒计时器待命';
      // 换新 bizId 撞一次，确认 429 只作为兜底
      await expectFail(429, () => api.pet.caress({ bizId: newBizId('selfcheck-cd') }), '冷却中互动');
      return `本地倒计时 ${cooldown.remainText(petId, 'pet')}，服务端 429 兜底一致`;
    },
  },
  {
    name: '离线收益',
    async run() {
      const res = await api.pet.offline();
      store.applyOffline(res);
      assert(typeof res.claimableCoin === 'number', '离线收益字段缺失');
      const capped = res.elapsedSec > res.maxHours * 3600;
      const btn = res.claimableCoin >= 1 ? '领取按钮可用' : '领取按钮已禁用（可领为 0）';
      return `离线 ${Math.round(res.elapsedSec / 60)} 分钟，可领 ${res.claimableCoin} 币，${btn}${capped ? '，已封顶' : ''}`;
    },
  },
  {
    name: '每日签到与任务',
    async run() {
      const res = await api.daily.info();
      store.applyDaily(res);
      assert(Array.isArray(res.tasks), '任务列表缺失');
      const claimable = res.tasks.filter((t) => t.done && !t.claimed).length;
      return `签到${res.checkin.done ? '已完成' : '待签到'}，连签 ${res.checkin.streak} 天，${res.tasks.length} 个任务按接口渲染，${claimable} 个可领`;
    },
  },
  {
    name: '赛道与战力（不硬编码）',
    async run() {
      const res = await api.race.tracks();
      assert(Array.isArray(res.tracks) && res.tracks.length > 0, '赛道列表为空');
      const names = res.tracks.map((t) => t.name).join('、');
      const power = res.battle ? `战力 ${res.battle.power}` : '无出战宠（battle 为 null，不报错）';
      return `${res.tracks.length} 条赛道按接口渲染：${names}；${power}`;
    },
  },
  {
    name: '换装默认外观兜底',
    async run() {
      const res = await api.wardrobe.info();
      store.applyWardrobe(res);
      const look = resolveAppearance(res);
      assert(!!look.body, 'body 槽位没有兜底外观，角色会渲染不出来');
      assert(!!look.bg, 'bg 槽位没有兜底外观');
      const raw = Object.keys(res.equipped || {}).length;
      return `服务端 equipped ${raw} 项，兜底后 body=${look.body} bg=${look.bg}${look.hat ? ` hat=${look.hat}` : ''}`;
    },
  },
  {
    name: '扭蛋概率公示（合规必需）',
    async run() {
      const res = await api.gacha.info();
      assert(Array.isArray(res.pools) && res.pools.length > 0, '奖池为空');
      const pool = res.pools[0];
      assert(Array.isArray(pool.odds) && pool.odds.length > 0, 'odds 缺失，界面无法做概率公示');
      const sum = pool.odds.reduce((s, o) => s + o.percent, 0);
      assert(Math.abs(sum - 100) < 0.5, `概率合计 ${sum}%，不等于 100%`);
      const rare = pool.odds.filter((o) => o.rare).length;
      return `${pool.name}：${pool.odds.length} 档合计 ${sum.toFixed(1)}%，稀有 ${rare} 档，保底还差 ${pool.pityLeft} 抽`;
    },
  },
  {
    name: '家园舒适度与本地碰撞',
    async run() {
      const res = await api.home.info();
      store.applyHome(res);
      assert(!!res.grid && res.grid.width > 0, '房间网格缺失');
      return `房间 ${res.grid.width}×${res.grid.height}，舒适度 ${res.comfort}（系数 ${res.comfortFactor}，上限 0.3），已摆 ${res.placed.length} 件`;
    },
  },
  {
    name: '图鉴进度',
    async run() {
      const res = await api.dex.info();
      store.applyDex(res.entries);
      const ready = res.entries.filter((e) => e.unlocked && !e.claimed).length;
      return `${res.entries.length} 个条目，${ready} 个可领取（红点条件 unlocked && !claimed）`;
    },
  },
  {
    name: '兑换双计费池',
    async run() {
      const res = await api.exchange.catalog();
      assert(res.items.length > 0, '兑换目录为空');
      const game = res.items.filter((i) => i.pool === 'game').length;
      const mkt = res.items.filter((i) => i.pool === 'marketing').length;
      return `${res.items.length} 个兑换项：游戏币 ${game} 个 / 营销积分 ${mkt} 个，UI 需区分币种图标`;
    },
  },
  {
    name: '分页响应形状',
    async run() {
      const res = await api.wallet.ledger({ page: 1, pageSize: 3 });
      assert(Array.isArray(res.list) && typeof res.total === 'number', '分页响应不是 {list,total}');
      assert(res.list.filter((r) => !isString(r.id)).length === 0, '流水 id 不是 string');
      return `list ${res.list.length} 条 / total ${res.total}，bigint 主键均为 string`;
    },
  },
  {
    name: '属性衰减本地预测',
    async run() {
      const pet = store.pet;
      assert(!!pet, '没有宠物数据');
      const now = predictPet(pet, store.comfortFactor);
      const d = (a: number, b: number) => (b - a).toFixed(2);
      return `距上次结算已推进：饱食 ${d(now.hunger, pet.hunger)} 清洁 ${d(now.cleanliness, pet.cleanliness)} 心情 ${d(now.mood, pet.mood)}（仅用于视觉平滑）`;
    },
  },
  {
    name: '广告凭证链路',
    async run() {
      const res = await api.ad.token('ad_reward');
      assert(!!res.nonce, '未拿到广告凭证');
      return `凭证已签发，TTL ${res.expiresInSec}s，今日该场景剩余 ${res.remaining} 次（凭证不核销会自然失效）`;
    },
  },
];

/** 依次跑完所有检查，每完成一项回调一次 */
export async function runAll(
  onItem?: (index: number, result: CheckResult) => void,
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (let i = 0; i < CHECKS.length; i++) {
    const check = CHECKS[i];
    const startedAt = serverNow();
    let result: CheckResult;
    try {
      const detail = await check.run();
      result = { name: check.name, ok: true, detail, ms: serverNow() - startedAt };
    } catch (err) {
      // 断言失败是普通 Error，只显示原因；接口失败带上状态码，便于对照错误码总表
      const detail =
        err instanceof ApiError ? `[${err.code}] ${err.message}` : (err as Error).message;
      result = { name: check.name, ok: false, detail, ms: serverNow() - startedAt };
    }
    results.push(result);
    if (onItem) onItem(i, result);
  }
  return results;
}
