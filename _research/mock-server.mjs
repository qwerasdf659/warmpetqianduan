/**
 * 前端自测用的本地假后端。
 *
 * 不是后端实现，只是把真实服务在 2026-08-26 录到的响应回放出来，
 * 外加复刻四个前端最容易写错的行为：
 *   - 幂等：同 bizId 重放回放上次响应
 *   - 冷却：30 秒内再互动返回 429
 *   - 参数白名单：多传未定义字段 400
 *   - 令牌失效：坏 token 返回 401
 * 后端不可用时，前端靠它继续联调，不用干等。
 */

import http from 'node:http';

const PORT = Number(process.env.MOCK_PORT || 8899);
const now = () => new Date().toISOString();

let tokenSeq = 0;
const validTokens = new Set();
const idem = new Map(); // bizId -> 响应体
const cooldownUntil = new Map(); // action -> 毫秒时间戳
let gameCoin = 5000;
let adRemaining = 5;
let offlineClaimed = false;

const pet = {
  id: '482',
  nickname: '小白',
  // 后端目前返回 "default"，PetStage 认不出就退回狗。
  // 想在预览里看猫：MOCK_SPECIES=cat node _research/mock-server.mjs
  species: process.env.MOCK_SPECIES || 'default',
  isActive: true,
  hunger: 19,
  cleanliness: 47,
  mood: 62,
  stamina: 114,
  staminaMax: 114,
  intimacy: 400,
  level: 8,
  exp: 1295,
  expIntoLevel: 0,
  expToNext: 360,
  stage: 'teen',
  speed: 17,
  endurance: 15.6,
  lastSeenAt: new Date(Date.now() - 3600 * 1000).toISOString(),
};

const wardrobeItems = [
  { key: 'skin_default', type: 'skin', name: '原色', slot: 'body', price: 0, pool: 'game', owned: true, equipped: false },
  { key: 'skin_snow', type: 'skin', name: '雪白', slot: 'body', price: 400, pool: 'game', owned: false, equipped: false },
  { key: 'acc_cap', type: 'accessory', name: '棒球帽', slot: 'hat', price: 300, pool: 'game', owned: false, equipped: false },
  { key: 'acc_bell', type: 'accessory', name: '铃铛', slot: 'neck', price: 350, pool: 'game', owned: false, equipped: false },
  { key: 'bg_room', type: 'accessory', name: '暖阳小屋', slot: 'bg', price: 0, pool: 'game', owned: true, equipped: false },
  { key: 'bg_beach', type: 'accessory', name: '海边夕照', slot: 'bg', price: 1200, pool: 'game', owned: false, equipped: false },
];

/**
 * 消耗品。effect 的键名要和 items.EFFECT_TEXT 对得上，
 * 否则界面会把 key 原样显示出来（那正是「文案没做」的样子）。
 */
const consumables = [
  { key: 'snack', name: '宠物零食', price: 60, pool: 'game', effect: { hunger: 25 }, owned: 3, sortOrder: 1 },
  { key: 'energy', name: '能量饮', price: 120, pool: 'game', effect: { stamina: 30 }, owned: 0, sortOrder: 2 },
  { key: 'brush', name: '洁毛刷', price: 90, pool: 'game', effect: { cleanliness: 30 }, owned: 1, sortOrder: 3 },
  { key: 'cake', name: '生日蛋糕', price: 800, pool: 'game', effect: { mood: 40, exp: 30 }, owned: 0, sortOrder: 4 },
];

/** 各接口允许出现的字段，用来复刻 forbidNonWhitelisted */
const ALLOWED = {
  'GET /pet/state': ['petId'],
  'GET /wallet/ledger': ['page', 'pageSize', 'pool'],
  'GET /gacha/history': ['page', 'pageSize'],
  'GET /exchange/orders': ['page', 'pageSize'],
  'GET /promo/redemptions': ['page', 'pageSize'],
  'GET /wardrobe': ['petId'],
  'POST /auth/login': ['code'],
  'POST /pet/pet': ['bizId', 'petId'],
  'POST /ad/token': ['scene'],
};

const routes = {
  'GET /health': () => ({ status: 'ok', service: 'warmpet-api-mock', time: now() }),

  'POST /auth/login': () => {
    tokenSeq += 1;
    const token = `mock-token-${tokenSeq}`;
    validTokens.add(token);
    return { token, userId: '985' };
  },

  'GET /pet/state': () => ({ pet }),
  'GET /pet/list': () => ({ pets: [pet] }),
  'GET /pet/offline': () => ({
    elapsedSec: offlineClaimed ? 0 : 51148,
    cappedSec: offlineClaimed ? 0 : 28800,
    maxHours: 8,
    coinPerHour: 13.5,
    comfortFactor: 0,
    claimableCoin: offlineClaimed ? 0 : 108,
  }),

  'GET /wallet': () => ({ wallet: { gameCoin, marketingPoint: 200 } }),
  'GET /wallet/ledger': () => ({
    list: [
      { id: '956', pool: 'marketing', delta: 200, balanceAfter: 200, bizId: 'seed', reason: 'admin_grant', refId: null, createdAt: now() },
      { id: '955', pool: 'game', delta: 5000, balanceAfter: 5000, bizId: 'seed', reason: 'admin_grant', refId: null, createdAt: now() },
    ],
    total: 2,
  }),

  'GET /daily': () => ({
    checkin: { done: false, streak: 0, totalCheckins: 0, todayReward: 20, nextReward: 30 },
    tasks: [
      { key: 'checkin', name: '完成每日签到', target: 1, progress: 0, coin: 10, done: false, claimed: false },
      { key: 'interact', name: '照顾宠物 5 次', target: 5, progress: 1, coin: 30, done: false, claimed: false },
    ],
  }),

  'GET /race/tracks': () => ({
    tracks: [
      { key: 'meadow', name: '新手草地', distance: 100, entryCoin: 0, baseReward: 50, difficulty: 1, targetTime: 24, staminaCost: 20, recommendLevel: 1 },
      { key: 'forest', name: '密林赛道', distance: 200, entryCoin: 20, baseReward: 120, difficulty: 1.3, targetTime: 36, staminaCost: 35, recommendLevel: 5 },
    ],
    battle: { petId: pet.id, nickname: pet.nickname, level: pet.level, power: 49.6, stamina: pet.stamina, staminaMax: pet.staminaMax },
  }),

  'GET /wardrobe': () => ({ petId: pet.id, items: wardrobeItems, equipped: {} }),

  'GET /gacha': () => ({
    pools: [
      {
        key: 'daily', name: '日常扭蛋', pool: 'game', cost: 300, costTen: 2700,
        pity: 30, dupeCoin: 120, pityLeft: 30,
        odds: [
          { key: 'coin_small', name: '零钱 60', rare: false, percent: 42 },
          { key: 'coin_mid', name: '零钱 200', rare: false, percent: 26 },
          { key: 'snack', name: '宠物零食 ×3', rare: false, percent: 14 },
          { key: 'energy', name: '能量饮 ×2', rare: false, percent: 9 },
          { key: 'cake', name: '生日蛋糕 ×1', rare: false, percent: 6 },
          { key: 'bg_beach', name: '海边夕照（背景）', rare: true, percent: 2 },
          { key: 'skin_shadow', name: '玄影（皮肤）', rare: true, percent: 1 },
        ],
      },
    ],
    wallet: { gameCoin, marketingPoint: 200 },
  }),

  'GET /items/consumables': () => ({
    items: consumables,
    wallet: { gameCoin, marketingPoint: 200 },
  }),

  'GET /home': () => ({
    comfort: 0,
    comfortFactor: 0,
    grid: { width: 6, height: 6 },
    items: [{ key: 'furn_sofa', name: '沙发', price: 900, pool: 'game', comfort: 15, owned: 0, placed: 0, gridW: 2, gridH: 1 }],
    placed: [],
  }),

  'GET /dex': () => ({
    entries: [
      { key: 'lv5', name: '初长成', desc: '宠物达到 5 级', target: 5, progress: 5, reward: 50, unlocked: true, claimed: false },
      { key: 'lv15', name: '风华正茂', desc: '宠物达到 15 级', target: 15, progress: 8, reward: 150, unlocked: false, claimed: false },
    ],
  }),

  'GET /exchange': () => ({
    items: [
      { key: 'coupon_5', cost: 500, name: '5 元代金券', pool: 'marketing', type: 'virtual', stockLeft: null, myLeft: null },
      { key: 'snack_pack', cost: 700, name: '零食礼包 ×10', pool: 'game', type: 'virtual', stockLeft: null, myLeft: null },
    ],
    wallet: { gameCoin, marketingPoint: 200 },
  }),

  'POST /ad/token': (body) => {
    if (adRemaining <= 0) return { __status: 400, code: 400, message: '今日该场景的广告次数已用尽' };
    adRemaining -= 1;
    return { nonce: `nonce-${Date.now()}`, scene: body.scene, expiresInSec: 300, remaining: adRemaining };
  },
};

/**
 * 四种互动。参数照抄对接文档 5.5 的默认值表，
 * 这样主界面上看到的冷却秒数、属性涨幅跟真后端是一致的。
 */
const INTERACTIONS = {
  feed: { effect: { hunger: 30 }, gain: { intimacy: 2, exp: 5, coin: 3 }, cd: 30000 },
  bath: { effect: { cleanliness: 40 }, gain: { intimacy: 2, exp: 5, coin: 3 }, cd: 60000 },
  pet: { effect: { mood: 15 }, gain: { intimacy: 3, exp: 3, coin: 2 }, cd: 20000 },
  play: { effect: { mood: 20, stamina: -10 }, gain: { intimacy: 4, exp: 8, coin: 5 }, cd: 60000 },
};

Object.keys(INTERACTIONS).forEach((action) => {
  const cfg = INTERACTIONS[action];

  routes[`POST /pet/${action}`] = () => {
    const until = cooldownUntil.get(action) || 0;
    if (Date.now() < until) {
      const sec = Math.ceil((until - Date.now()) / 1000);
      return { __status: 429, code: 429, message: `冷却中，还需 ${sec} 秒` };
    }
    if (cfg.effect.stamina && pet.stamina + cfg.effect.stamina < 0) {
      return { __status: 400, code: 400, message: '体力不足' };
    }

    cooldownUntil.set(action, Date.now() + cfg.cd);

    if (cfg.effect.hunger) pet.hunger = Math.min(100, pet.hunger + cfg.effect.hunger);
    if (cfg.effect.cleanliness) pet.cleanliness = Math.min(100, pet.cleanliness + cfg.effect.cleanliness);
    if (cfg.effect.mood) pet.mood = Math.min(100, pet.mood + cfg.effect.mood);
    if (cfg.effect.stamina) pet.stamina = Math.max(0, pet.stamina + cfg.effect.stamina);

    pet.intimacy += cfg.gain.intimacy;
    pet.exp += cfg.gain.exp;
    gameCoin += cfg.gain.coin;
    pet.lastSeenAt = now();

    // 简化的升级：经验填满当前等级就进一级，用来验证升级动画
    let levelUp = false;
    pet.expIntoLevel += cfg.gain.exp;
    pet.expToNext -= cfg.gain.exp;
    if (pet.expToNext <= 0) {
      pet.level += 1;
      pet.expIntoLevel = 0;
      pet.expToNext = 100 + pet.level * 40;
      pet.staminaMax += 2;
      levelUp = true;
    }

    return {
      pet: { ...pet },
      gained: { ...cfg.gain },
      capped: false,
      levelUp,
      cooldownRemainMs: cfg.cd,
      gameCoin,
    };
  };

  ALLOWED[`POST /pet/${action}`] = ['bizId', 'petId'];
});

// ---- 消耗品：买 / 用 ----

routes['POST /items/consumables/buy'] = (body) => {
  const item = consumables.find((c) => c.key === body.itemKey);
  if (!item) return { __status: 400, code: 400, message: '道具不存在' };
  const qty = Math.max(1, Math.min(99, body.qty || 1));
  const total = item.price * qty;
  if (gameCoin < total) return { __status: 400, code: 400, message: '金币不足' };
  gameCoin -= total;
  item.owned += qty;
  // qty 回传的是**购买后的持有量**，不是本次买了几件（对齐 types.ts BuyResult）
  return { itemKey: item.key, qty: item.owned, wallet: { gameCoin, marketingPoint: 200 }, duplicated: false };
};
ALLOWED['POST /items/consumables/buy'] = ['bizId', 'itemKey', 'qty'];

routes['POST /items/consumables/use'] = (body) => {
  const item = consumables.find((c) => c.key === body.itemKey);
  if (!item) return { __status: 400, code: 400, message: '道具不存在' };
  if (item.owned <= 0) return { __status: 400, code: 400, message: '道具数量不足' };
  item.owned -= 1;

  const eff = item.effect;
  if (eff.hunger) pet.hunger = Math.min(100, pet.hunger + eff.hunger);
  if (eff.cleanliness) pet.cleanliness = Math.min(100, pet.cleanliness + eff.cleanliness);
  if (eff.mood) pet.mood = Math.min(100, pet.mood + eff.mood);
  if (eff.stamina) pet.stamina = Math.min(pet.staminaMax, pet.stamina + eff.stamina);
  pet.lastSeenAt = now();

  let levelUp = false;
  if (eff.exp) {
    pet.exp += eff.exp;
    pet.expIntoLevel += eff.exp;
    pet.expToNext -= eff.exp;
    if (pet.expToNext <= 0) {
      pet.level += 1;
      pet.expIntoLevel = 0;
      pet.expToNext = 100 + pet.level * 40;
      pet.staminaMax += 2;
      levelUp = true;
    }
  }
  return { itemKey: item.key, left: item.owned, effect: { ...eff }, pet: { ...pet }, levelUp };
};
ALLOWED['POST /items/consumables/use'] = ['bizId', 'itemKey', 'petId'];

// ---- 换装：买 / 穿 / 脱 ----

/** 槽位 → itemKey。新号是空对象，前端 resolveAppearance 会补默认外观 */
const equipped = {};

routes['GET /wardrobe'] = () => ({ petId: pet.id, items: wardrobeItems, equipped: { ...equipped } });

routes['POST /wardrobe/buy'] = (body) => {
  const item = wardrobeItems.find((w) => w.key === body.itemKey);
  if (!item) return { __status: 400, code: 400, message: '物品不存在' };
  if (item.price === 0) return { __status: 400, code: 400, message: '该物品无需购买' };
  if (item.owned) return { itemKey: item.key, qty: 1, wallet: { gameCoin, marketingPoint: 200 }, duplicated: true };
  if (gameCoin < item.price) return { __status: 400, code: 400, message: '金币不足' };
  gameCoin -= item.price;
  item.owned = true;
  return { itemKey: item.key, qty: 1, wallet: { gameCoin, marketingPoint: 200 }, duplicated: false };
};
ALLOWED['POST /wardrobe/buy'] = ['bizId', 'itemKey'];

routes['POST /wardrobe/equip'] = (body) => {
  const item = wardrobeItems.find((w) => w.key === body.itemKey);
  if (!item) return { __status: 400, code: 400, message: '物品不存在' };
  if (!item.owned && item.price > 0) return { __status: 400, code: 400, message: '还没有这件物品' };
  wardrobeItems.forEach((w) => {
    if (w.slot === item.slot) w.equipped = false;
  });
  item.equipped = true;
  equipped[item.slot] = item.key;
  return { petId: pet.id, items: wardrobeItems, equipped: { ...equipped } };
};
ALLOWED['POST /wardrobe/equip'] = ['itemKey', 'petId'];

routes['POST /wardrobe/unequip'] = (body) => {
  wardrobeItems.forEach((w) => {
    if (w.slot === body.slot) w.equipped = false;
  });
  delete equipped[body.slot];
  return { petId: pet.id, items: wardrobeItems, equipped: { ...equipped } };
};
ALLOWED['POST /wardrobe/unequip'] = ['slot', 'petId'];

// ---- 扭蛋 ----

let pityCount = 0;

routes['POST /gacha/draw'] = (body) => {
  const pools = routes['GET /gacha']().pools;
  const pool = pools.find((p) => p.key === body.poolKey);
  if (!pool) return { __status: 400, code: 400, message: '奖池不存在' };
  const times = body.times === 10 ? 10 : 1;
  const cost = times === 10 ? pool.costTen : pool.cost;
  if (gameCoin < cost) return { __status: 400, code: 400, message: '金币不足' };
  gameCoin -= cost;

  // 按 odds 的百分比抽，保底到了强制出稀有——为的是能验证前端的稀有演出分支
  const prizes = [];
  for (let i = 0; i < times; i++) {
    pityCount += 1;
    const forced = pool.pity > 0 && pityCount >= pool.pity;
    let picked;
    if (forced) {
      picked = pool.odds.filter((o) => o.rare)[0] || pool.odds[0];
      pityCount = 0;
    } else {
      let roll = Math.random() * 100;
      picked = pool.odds[pool.odds.length - 1];
      for (const o of pool.odds) {
        roll -= o.percent;
        if (roll <= 0) {
          picked = o;
          break;
        }
      }
      if (picked.rare) pityCount = 0;
    }
    const converted = picked.rare && Math.random() < 0.3;
    if (converted) gameCoin += pool.dupeCoin;
    prizes.push({
      entryKey: picked.key,
      name: picked.name,
      kind: picked.rare ? 'collection' : 'coin',
      amount: converted ? pool.dupeCoin : 0,
      itemKey: null,
      qty: 1,
      rare: picked.rare,
      converted,
    });
  }

  return {
    poolKey: pool.key,
    times,
    cost,
    prizes,
    wallet: { gameCoin, marketingPoint: 200 },
    pity: pityCount,
    duplicated: false,
  };
};
ALLOWED['POST /gacha/draw'] = ['bizId', 'poolKey', 'times'];

// ---- 赛跑 ----

const races = new Map();
let raceSeq = 0;

routes['POST /race/start'] = (body) => {
  const track = routes['GET /race/tracks']().tracks.find((t) => t.key === body.trackKey);
  if (!track) return { __status: 400, code: 400, message: '赛道不存在' };
  if (pet.stamina < track.staminaCost) return { __status: 400, code: 400, message: '体力不足' };
  if (gameCoin < track.entryCoin) return { __status: 400, code: 400, message: '金币不足' };

  pet.stamina -= track.staminaCost;
  gameCoin -= track.entryCoin;
  pet.lastSeenAt = now();

  raceSeq += 1;
  const raceId = String(1000 + raceSeq);
  const rank = 1 + Math.floor(Math.random() * 4);
  const finishTime = Number((track.targetTime * (0.9 + Math.random() * 0.35)).toFixed(3));
  const grade = ['S', 'A', 'B', 'C'][rank - 1];
  const opponents = [1, 2, 3].map((i) => Number((finishTime + i * 1.4).toFixed(3))).sort((a, b) => a - b);

  const race = {
    raceId,
    trackKey: track.key,
    rank,
    totalRacers: 4,
    finishTime,
    grade,
    opponentFinishTimes: opponents,
    ghostSource: 'npc',
    playerScore: Number((100 / finishTime).toFixed(3)),
    staminaLeft: pet.stamina,
    status: 'pending',
    baseReward: track.baseReward,
  };
  races.set(raceId, race);
  const out = { ...race };
  delete out.baseReward;
  return out;
};
ALLOWED['POST /race/start'] = ['bizId', 'trackKey', 'petId'];

routes['POST /race/settle'] = (body) => {
  const race = races.get(body.raceId);
  if (!race) return { __status: 400, code: 400, message: '比赛不存在' };
  const factor = [1, 0.6, 0.35, 0.15][race.rank - 1] || 0;
  const rewardCoin = Math.round(race.baseReward * factor);
  const duplicated = race.status === 'settled';
  if (!duplicated) {
    gameCoin += rewardCoin;
    race.status = 'settled';
    race.rewardCoin = rewardCoin;
  }
  return {
    raceId: race.raceId,
    rank: race.rank,
    totalRacers: race.totalRacers,
    finishTime: race.finishTime,
    grade: race.grade,
    rewardCoin: race.rewardCoin || rewardCoin,
    gameCoin,
    duplicated,
  };
};
ALLOWED['POST /race/settle'] = ['bizId', 'raceId'];

routes['POST /race/reward/double'] = (body) => {
  const race = races.get(body.raceId);
  if (!race) return { __status: 400, code: 400, message: '比赛不存在' };
  if (race.status !== 'settled') return { __status: 400, code: 400, message: '该场比赛还未结算' };
  if (race.doubled) {
    return { raceId: race.raceId, bonusCoin: race.rewardCoin, totalRewardCoin: race.rewardCoin * 2, gameCoin, duplicated: true };
  }
  race.doubled = true;
  gameCoin += race.rewardCoin;
  return { raceId: race.raceId, bonusCoin: race.rewardCoin, totalRewardCoin: race.rewardCoin * 2, gameCoin, duplicated: false };
};
ALLOWED['POST /race/reward/double'] = ['bizId', 'raceId', 'adToken'];

/** 离线收益领取。领过一次就清零，好验证「可领为 0 时按钮禁用」 */
routes['POST /pet/offline/claim'] = () => {
  const offline = routes['GET /pet/offline']();
  if (offline.claimableCoin < 1) {
    return { __status: 400, code: 400, message: '暂无可领取的离线收益' };
  }
  gameCoin += offline.claimableCoin;
  offlineClaimed = true;
  return { gained: offline.claimableCoin, gameCoin };
};
ALLOWED['POST /pet/offline/claim'] = ['bizId'];

/**
 * Cocos 编辑器预览跑在 localhost 的另一个端口上，属于跨域请求，
 * 没有这几个头浏览器会直接拦掉，控制台只会看到一句含糊的 CORS 报错。
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Max-Age': '86400',
};

function send(res, status, payload) {
  const raw = JSON.stringify(payload);
  res.writeHead(status, {
    ...CORS,
    'Content-Type': 'application/json; charset=utf-8',
  });
  res.end(raw);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // 带 Authorization 头的请求会先发一次 OPTIONS 预检
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  const key = `${req.method} ${url.pathname}`;

  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : {};
    const handler = routes[key];
    if (!handler) return send(res, 404, { code: 404, message: '接口不存在' });

    // 鉴权：/health 与 /auth/login 免鉴权
    if (key !== 'GET /health' && key !== 'POST /auth/login') {
      const auth = req.headers.authorization || '';
      const token = auth.replace('Bearer ', '');
      if (!token) return send(res, 401, { code: 401, message: '缺少访问令牌' });
      if (!validTokens.has(token)) return send(res, 401, { code: 401, message: '令牌无效或已过期' });
    }

    // 参数白名单
    const allowed = ALLOWED[key];
    if (allowed) {
      const got = req.method === 'GET' ? [...url.searchParams.keys()] : Object.keys(body);
      const extra = got.filter((k) => !allowed.includes(k));
      if (extra.length) {
        return send(res, 400, { code: 400, message: extra.map((k) => `property ${k} should not exist`) });
      }
    }

    // 幂等回放
    const bizId = body && body.bizId;
    if (bizId && idem.has(bizId)) return send(res, 200, idem.get(bizId));

    const out = handler(body);
    if (out && out.__status) {
      delete out.__status;
      return send(res, out.code, out);
    }
    if (bizId) idem.set(bizId, out);
    send(res, 200, out);
  });
});

server.listen(PORT, () => console.log(`mock backend listening on http://127.0.0.1:${PORT}`));
