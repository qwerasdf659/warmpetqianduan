/**
 * 在 Node 里跑一遍 assets/scripts/core/selfcheck.ts，验证网络层与 API 封装。
 *
 * 不用开 Cocos、不用构建小游戏，改完网络层几秒钟就能知道有没有跑通。
 * UI 层（依赖 cc 模块）不在验证范围内，那部分靠 Cocos 构建来把关。
 *
 * 打真实后端：node --import ./_research/loader.mjs _research/run-selfcheck.mjs
 * 打本地假后端：node --import ./_research/loader.mjs _research/run-selfcheck.mjs http://127.0.0.1:8899
 */

import './wx-stub.mjs';

const override = process.argv[2];
const config = await import('../assets/scripts/net/config.ts');
if (override) config.setBaseUrl(override);
console.log(`目标: ${config.getBaseUrl()}\n`);

const { runAll } = await import('../assets/scripts/core/selfcheck.ts');

const results = await runAll((i, r) => {
  console.log(`[${r.ok ? 'PASS' : 'FAIL'}] ${String(i + 1).padStart(2)} ${r.name}  (${r.ms}ms)`);
  console.log(`         ${r.detail}`);
});

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
  console.log('失败项：');
  failed.forEach((f) => console.log(`  - ${f.name}: ${f.detail}`));
  process.exitCode = 1;
}
