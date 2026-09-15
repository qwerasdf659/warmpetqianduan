/**
 * 读壁龛图**实际渲染尺寸**，确认「加高分区」真的让图变大了。
 *
 * 教训：上一轮把分区从 150 加宽到 194，图只从 75x80 变 80x86 ——
 * 因为 placeArt 等比缩放、被高度卡住。所以判断有没有生效必须看
 * **图的渲染尺寸**，不是看分区框的尺寸。
 */
import { chromium } from 'playwright';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 414, height: 896 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:7456/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('canvas', { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(22000);

const out = await page.evaluate(() => {
  const cc = window.cc;
  const res = { zones: [], arts: [] };
  let comp = null;
  const walk = (n) => {
    if (!comp && n.components) comp = n.components.find((c) => c.constructor.name === 'MapView') || null;
    const sp = n.getComponent && n.getComponent(cc.Sprite);
    if (sp && sp.spriteFrame && /alcove/.test(sp.spriteFrame.name)) {
      const ui = n.getComponent(cc.UITransform);
      res.arts.push({
        name: sp.spriteFrame.name,
        w: ui ? +ui.width.toFixed(0) : null,
        h: ui ? +ui.height.toFixed(0) : null,
        y: +n.position.y.toFixed(0),
      });
    }
    for (const c of (n.children || [])) walk(c);
  };
  walk(cc.director.getScene());
  if (comp && comp.L) {
    res.zones = comp.L.zones.filter((z) => z.art).map((z) => ({
      key: z.key, w: +z.w.toFixed(0), h: +z.h.toFixed(0),
      bottom: +(z.cy - z.h / 2).toFixed(0),
    }));
    res.wallBottom = +comp.L.wallBottom.toFixed(0);
  }
  return res;
});

console.log('分区框:', JSON.stringify(out.zones));
console.log('墙地交界 y =', out.wallBottom);
console.log('\n图实际渲染尺寸:');
for (const a of out.arts) console.log(`  ${a.name.padEnd(16)} ${a.w}x${a.h}  y=${a.y}`);
console.log('\n参考: 改前 75x80 → 目标 ~134x144 (竞品等比)');
await page.screenshot({ path: '.build/shots/zone-size.png' });
await browser.close();
