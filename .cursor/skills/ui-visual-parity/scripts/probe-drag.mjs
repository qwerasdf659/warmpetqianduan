/**
 * 验证横向拖动：读 WorldRoot 的 x，拖前拖后对比。
 *
 * 「拖不动」在截图上看不出来 —— 旧滚动版就吃过这个亏（真相是 x 一直等于
 * clamp 边界，而不是事件没收到）。必须打印真实坐标。
 */
import { chromium } from 'playwright';

const W = 414;
const H = 896;
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: W, height: H }, isMobile: true, hasTouch: true,
});
const page = await ctx.newPage();
await page.goto(process.argv[2] || 'http://127.0.0.1:7456/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('canvas', { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(Number(process.argv[3] || 22000));

const probe = `(() => {
  const cc = window.cc;
  const scene = cc.director.getScene();
  let comp = null, world = null;
  const walk = (n) => {
    if (n.name === 'WorldRoot') world = n;
    if (!comp && n.components) comp = n.components.find(c => c.constructor.name === 'MapView') || null;
    for (const c of (n.children || [])) walk(c);
  };
  walk(scene);
  const L = comp && comp.L;
  return {
    worldX: world ? +world.position.x.toFixed(1) : null,
    worldChildren: world ? world.children.length : -1,
    worldW: L ? +L.worldW.toFixed(0) : null,
    minX: L ? +L.minX.toFixed(0) : null,
    maxX: L ? +L.maxX.toFixed(0) : null,
    wallPct: L ? +(((L.top - L.wallBottom) / L.vh) * 100).toFixed(0) : null,
    sprites: (() => {
      let n = 0;
      const w = (x) => { if (x.getComponent && x.getComponent(cc.Sprite) && x.getComponent(cc.Sprite).spriteFrame) n++; for (const c of (x.children||[])) w(c); };
      if (world) w(world);
      return n;
    })(),
  };
})()`;

const before = await page.evaluate(probe);
console.log('初始:', JSON.stringify(before));

const drag = async (fromX, toX, label) => {
  const y = H / 2;
  await page.mouse.move(fromX, y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(fromX + ((toX - fromX) * i) / 12, y);
    await page.waitForTimeout(20);
  }
  await page.mouse.up();
  await page.waitForTimeout(400);
  const r = await page.evaluate(probe);
  console.log(`${label}: worldX=${r.worldX}`);
  return r.worldX;
};

const left = await drag(W - 60, 60, '手指往左拖');
const right = await drag(60, W - 60, '手指往右拖');

const moved = Math.abs(left - before.worldX) > 5 && Math.abs(right - left) > 5;
console.log(moved ? 'PASS 横向可拖动' : 'FAIL 拖不动（x 没变化）');
console.log(`墙占屏 ${before.wallPct}%  世界宽 ${before.worldW}  可拖范围 ${before.minX}~${before.maxX}`);
console.log(`WorldRoot 子层 ${before.worldChildren} 个，其中带图 Sprite ${before.sprites} 个`);

await page.screenshot({ path: '.build/shots/map-latest.png' });
await browser.close();
