/**
 * 主界面用到的接口走一遍，验证四个互动按钮、冷却、体力不足、离线领取。
 * 用法：node --import ./_research/loader.mjs _research/run-mainflow.mjs
 */

import './wx-stub.mjs';

const { login } = await import('../assets/scripts/net/auth.ts');
const { syncClock } = await import('../assets/scripts/net/clock.ts');
const api = (await import('../assets/scripts/net/api/index.ts')).default;
const actions = await import('../assets/scripts/core/actions.ts');
const cooldown = await import('../assets/scripts/core/cooldown.ts');
const store = (await import('../assets/scripts/core/store.ts')).default;
const { gainedText } = await import('../assets/scripts/ui/toast.ts');
const { describeMood, expProgress } = await import('../assets/scripts/core/predict.ts');

const line = (s) => console.log(s);

await syncClock();
await login();
store.applyPet((await api.pet.state()).pet);
store.applyWallet((await api.wallet.balance()).wallet);
store.applyOffline(await api.pet.offline());
store.applyHome(await api.home.info());

const pet = store.petView;
line(`宠物: Lv${pet.level} ${pet.nickname}  饱食${Math.round(pet.hunger)} 清洁${Math.round(pet.cleanliness)} 心情${Math.round(pet.mood)} 体力${Math.round(pet.stamina)}/${pet.staminaMax}`);
line(`经验条: ${(expProgress(pet) * 100).toFixed(1)}%   气泡: "${describeMood(pet) || '(无)'}"`);
line(`钱包: 游戏币 ${store.wallet.gameCoin}  营销积分 ${store.wallet.marketingPoint}`);
line(`离线可领: ${store.offline.claimableCoin}  弹窗应${store.hasOfflineReward ? '弹出' : '不弹'}  封顶=${store.offlineCapped}\n`);

line('--- 四个互动按钮各点一次 ---');
for (const action of ['feed', 'bath', 'pet', 'play']) {
  const res = await actions.interact(action);
  if (res.ok) {
    const d = res.data;
    line(
      `${action.padEnd(5)} ok   ${gainedText(d.gained).padEnd(30)} 冷却 ${d.cooldownRemainMs / 1000}s  升级=${d.levelUp}  余额=${d.gameCoin}`,
    );
  } else {
    line(`${action.padEnd(5)} 失败 [${res.error.code}] ${res.error.message}`);
  }
}

line('\n--- 冷却态（按钮此时应全部置灰）---');
for (const action of ['feed', 'bath', 'pet', 'play']) {
  // 冷却是按 petId 分开记的，要和 actions 里用的键一致
  line(`${action.padEnd(5)} 剩余 ${cooldown.remainText(store.activePetId, action) || '就绪'}`);
}

line('\n--- 冷却中再点一次，应被本地拦下、不发请求 ---');
const blocked = await actions.interact('feed');
line(`结果: ok=${blocked.ok}  [${blocked.error.code}] ${blocked.error.message}`);

line('\n--- 领取离线收益 ---');
const claim = await actions.claimOffline();
line(claim.ok ? `领到 ${claim.data.gained} 币，余额 ${claim.data.gameCoin}` : `失败: ${claim.error.message}`);

const again = await actions.claimOffline();
line(`再领一次: ok=${again.ok}  ${again.error ? again.error.message : ''}（按钮应已禁用）`);

const after = store.petView;
line(`\n互动后: 饱食${Math.round(after.hunger)} 清洁${Math.round(after.cleanliness)} 心情${Math.round(after.mood)} 体力${Math.round(after.stamina)}/${after.staminaMax}`);
