/**
 * 通用节点树探针：读运行时任意节点的 active / 子节点数 / contentSize / 世界坐标。
 *
 * 代码画的 UI 失败（空白 / 不显示 / 点不动）长得都一样，只能靠这些真值分清。
 * 见规则 `ui-runtime-verification` 的判据速查表。
 *
 * 用法:
 *   node probe-nodes.mjs "<名字正则>" [等待ms] [截图输出路径]
 * 例:
 *   node probe-nodes.mjs "Bubble|MapActionBar|MapBtn_" 24000
 *   node probe-nodes.mjs "MapInput|Sign_"
 *
 * 需要预览(7456)在跑；连不上会明确报错，不要当成「没有节点」。
 */
import { chromium } from 'playwright';

const pattern = process.argv[2] || '.';
const waitMs = Number(process.argv[3] || 24000);
const shot = process.argv[4] || 'C:/Users/Administrator/Desktop/warmpet/.build/shots/probe-nodes.png';

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 414, height: 896 }, isMobile: true, hasTouch: true,
});
const page = await ctx.newPage();
try {
  await page.goto('http://127.0.0.1:7456/', { waitUntil: 'domcontentloaded', timeout: 60000 });
} catch (e) {
  console.log('预览连不上（7456）——先确认编辑器预览开着，别把这当成「节点不存在」');
  await browser.close();
  process.exit(1);
}
await page.waitForSelector('canvas', { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(waitMs);

const out = await page.evaluate((pat) => {
  const cc = window.cc;
  const re = new RegExp(pat);
  const rows = [];
  const wp = new cc.Vec3();
  // ⚠️ 页面上下文里 `cc.UITransform` 等符号是 undefined（被 treeshake），
  // 所以 getComponent(cc.Xxx) 一律拿不到。改成**按构造函数名**在 components 里找。
  const byName = (n, name) => (n.components || []).find((c) => c.constructor.name === name) || null;
  const walk = (n, depth) => {
    if (n.name && re.test(n.name)) {
      const tr = byName(n, 'UITransform');
      n.getWorldPosition(wp);
      const sp = byName(n, 'Sprite');
      const lb = byName(n, 'Label');
      rows.push({
        name: n.name,
        active: n.activeInHierarchy,
        kids: (n.children || []).length,
        size: tr ? `${Math.round(tr.contentSize.width)}x${Math.round(tr.contentSize.height)}` : 'noTR',
        world: `${Math.round(wp.x)},${Math.round(wp.y)}`,
        frame: sp && sp.spriteFrame ? sp.spriteFrame.name : (sp ? 'NONE' : undefined),
        text: lb ? JSON.stringify(lb.string) : undefined,
      });
    }
    for (const c of (n.children || [])) walk(c, depth + 1);
  };
  walk(cc.director.getScene(), 0);
  return { count: rows.length, rows, vw: cc.view.getVisibleSize().width, vh: cc.view.getVisibleSize().height };
}, pattern);

console.log(`视口 ${out.vw}x${out.vh}，匹配 "${pattern}" 共 ${out.count} 个节点:`);
for (const r of out.rows) {
  let line = `  ${r.name} active=${r.active} kids=${r.kids} size=${r.size} world=${r.world}`;
  if (r.frame !== undefined) line += ` frame=${r.frame}`;
  if (r.text !== undefined) line += ` text=${r.text}`;
  console.log(line);
}
if (out.count === 0) console.log('  （0 个 —— 建节点的代码可能没跑，或名字正则不对）');

await page.screenshot({ path: shot });
console.log('shot ->', shot);
await browser.close();
