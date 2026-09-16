/**
 * 验证「点哪都跳转」修掉了、且互动条真的在画面上。
 *
 * 只看截图不够（编辑器编译会滞后，产物里搜到新常量也可能只有部分 chunk 更新），
 * 所以这里读**运行时真值**：
 *   1. zones 里不能再有 lobby / shape==='open'
 *   2. 互动条节点存在且有子节点（`SpriteLayer: 0 children` 那类静默失败靠数子节点才发现）
 *   3. petY 高于互动条上沿（小屏上猫会陷进按钮）
 *   4. 点一下空地板，确认**没有**跳走（MapView 还在）
 */
import { chromium } from 'playwright';

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 414, height: 896 }, isMobile: true, hasTouch: true,
});
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:7456/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('canvas', { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(Number(process.argv[2] || 24000));

const findMap = () => {
  const cc = window.cc;
  let comp = null;
  const walk = (n) => {
    if (!comp && n.components) comp = n.components.find((c) => c.constructor.name === 'MapView') || null;
    for (const c of (n.children || [])) walk(c);
  };
  walk(cc.director.getScene());
  return comp;
};

const before = await page.evaluate(`(${findMap.toString()})();
  (() => {
    const comp = (${findMap.toString()})();
    if (!comp) return { err: 'no MapView' };
    if (!comp.L) return { err: 'no MapView.L' };
    const names = (n) => (n.children || []).map((c) => c.name);
    const barNode = comp.node.children.find((c) => c.name === 'MapActionBar');
    const bar = barNode && barNode.components
      ? barNode.components.find((c) => c.constructor.name === 'MapActionBar')
      : null;
    return {
      zones: comp.L.zones.map((z) => z.key + '/' + z.shape),
      hasLobby: comp.L.zones.some((z) => z.key === 'lobby' || z.shape === 'open'),
      petY: Math.round(comp.L.petY),
      bottom: Math.round(comp.L.bottom),
      barFound: !!bar,
      barTop: bar ? Math.round(bar.topY) : null,
      barChildren: barNode ? names(barNode).length : -1,
      barChildNames: barNode ? names(barNode) : [],
      childLayers: names(comp.node),
    };
  })()`);

console.log('--- 运行时布局 ---');
console.log(JSON.stringify(before, null, 2));

if (!before.err) {
  const clearance = before.petY - 10 - before.barTop;
  console.log(`clearance(petY-10 - barTop) = ${clearance} ${clearance >= 12 ? 'OK' : 'FAIL'}`);
  console.log(`hasLobby = ${before.hasLobby} ${before.hasLobby ? 'FAIL' : 'OK'}`);
  console.log(`barChildren = ${before.barChildren} ${before.barChildren > 0 ? 'OK' : 'FAIL'}`);
}

// 点一下空地板中段（避开互动条和分区壁龛）：MapView 应当还在
await page.mouse.click(207, 500);
await page.waitForTimeout(1500);
const after = await page.evaluate(`(() => {
  const comp = (${findMap.toString()})();
  return { mapStillAlive: !!comp };
})()`);
console.log('--- 点空地板之后 ---');
console.log(`mapStillAlive = ${after.mapStillAlive} ${after.mapStillAlive ? 'OK（没跳走）' : 'FAIL（跳走了）'}`);

await page.screenshot({ path: process.argv[3] || 'C:/Users/Administrator/Desktop/warmpet/.build/shots/actionbar-probe.png' });
await browser.close();
