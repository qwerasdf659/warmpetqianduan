/**
 * Cocos 预览验收：无头浏览器打开编辑器预览页，截图 + 抓控制台 + 读运行时真值。
 *
 * 为什么不靠截图：拖动/命中这类交互，截图看不出对错。直接 evaluate 读引擎里的
 * 节点坐标与组件字段，一次就能定位（例如「纵向拖不动」的真相是 y 一直等于 maxY）。
 *
 * 用法:
 *   node preview-probe.mjs                       截图 + 日志
 *   node preview-probe.mjs --drag                额外做拖动前后坐标对比
 *   node preview-probe.mjs --node MapRoot        指定要读坐标的节点名
 *   node preview-probe.mjs --comp MapView        指定要读字段的组件名
 *   node preview-probe.mjs --url http://...      预览地址（默认 127.0.0.1:7456）
 *   node preview-probe.mjs --out ./shots         截图输出目录
 *   node preview-probe.mjs --wait 20000          进游戏后等待毫秒数
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

const argv = process.argv.slice(2);
const flag = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};
const has = (name) => argv.includes(`--${name}`);

const URL = flag('url', 'http://127.0.0.1:7456/');
const OUT = flag('out', '.build/shots');
const NODE_NAME = flag('node', 'MapRoot');
const COMP_NAME = flag('comp', 'MapView');
const WAIT = Number(flag('wait', 20000));
const W = 414;
const H = 896;

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: W, height: H },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('canvas', { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(WAIT);

// 读运行时真值：目标节点坐标 + 目标组件的数值字段 + 场景树
const probe = `((nodeName, compName) => {
  const cc = window.cc;
  if (!cc || !cc.director) return { err: 'engine not ready' };
  const scene = cc.director.getScene();
  if (!scene) return { err: 'no scene' };
  let target = null, host = null;
  const tree = [];
  const walk = (n, d) => {
    if (n.name === nodeName) target = n;
    if (!host && n.components && n.components.some(c => c.constructor.name === compName)) host = n;
    if (d <= 3) tree.push('  '.repeat(d) + n.name);
    for (const c of (n.children || [])) walk(c, d + 1);
  };
  walk(scene, 0);
  const comp = host ? host.components.find(c => c.constructor.name === compName) : null;
  const fields = {};
  if (comp) {
    for (const k of Object.keys(comp)) {
      const v = comp[k];
      if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') fields[k] = v;
    }
  }
  const ui = target && target.getComponent(cc.UITransform);
  return {
    nodePos: target ? { x: +target.position.x.toFixed(1), y: +target.position.y.toFixed(1) } : null,
    nodeSize: ui ? { w: ui.width, h: ui.height } : null,
    compFields: fields,
    visible: { w: cc.view.getVisibleSize().width, h: cc.view.getVisibleSize().height },
    tree: tree.join('\\n'),
  };
})('${NODE_NAME}', '${COMP_NAME}')`;

const info = await page.evaluate(probe);
console.log('=== runtime ===');
console.log(JSON.stringify({ ...info, tree: undefined }, null, 2));
console.log('--- scene tree ---');
console.log(info.tree);

await page.screenshot({ path: `${OUT}/01-landing.png` });

if (has('drag')) {
  const cx = W / 2;
  const cy = H / 2;
  const drag = async (fx, fy, tx, ty, label) => {
    await page.mouse.move(fx, fy);
    await page.mouse.down();
    for (let i = 1; i <= 15; i++) {
      await page.mouse.move(fx + ((tx - fx) * i) / 15, fy + ((ty - fy) * i) / 15);
      await page.waitForTimeout(20);
    }
    await page.mouse.up();
    await page.waitForTimeout(400);
    const r = await page.evaluate(probe);
    console.log(`${label}: ${JSON.stringify(r.nodePos)}`);
  };
  console.log('=== drag test ===');
  await drag(cx, cy + 200, cx, cy - 200, 'finger UP   ');
  await drag(cx, cy - 200, cx, cy + 200, 'finger DOWN ');
  await drag(cx + 150, cy, cx - 150, cy, 'finger LEFT ');
  await drag(cx - 150, cy, cx + 150, cy, 'finger RIGHT');
  await page.screenshot({ path: `${OUT}/02-after-drag.png` });
}

console.log('=== console logs (last 40) ===');
console.log(logs.slice(-40).join('\n'));

await browser.close();
console.log('shots ->', OUT);
