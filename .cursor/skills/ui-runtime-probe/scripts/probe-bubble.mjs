/**
 * 读运行时：宠物四项属性、气泡是否 active、气泡图标层有没有子节点。
 * 空白气泡的两种成因（阈值没触发 / 图标画了但没子节点）只能靠真值分清。
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

const out = await page.evaluate(`(() => {
  const findMap = ${findMap.toString()};
  const comp = findMap();
  if (!comp) return { err: 'no MapView' };
  const bubble = comp.bubbleNode;
  const iconHost = comp.bubbleIconHost;
  // 手动跑一次 refreshPetOverlay，看它会不会把图标画出来（隔离 update 的 early-return）
  let refreshErr = null;
  try { comp.refreshPetOverlay(); } catch (e) { refreshErr = String(e); }
  return {
    hasCat: !!comp.catNode,
    hasL: !!comp.L,
    catValid: comp.catNode ? comp.catNode.isValid : null,
    lastPetSig: comp.lastPetSig,
    bubbleActive: bubble ? bubble.active : null,
    bubbleNeed: comp.bubbleNeed,
    iconHostChildren: iconHost ? iconHost.children.length : -1,
    iconHostValid: iconHost ? iconHost.isValid : null,
    refreshErr,
  };
})()`);

console.log(JSON.stringify(out, null, 2));
await page.screenshot({ path: 'C:/Users/Administrator/Desktop/warmpet/.build/shots/bubble-probe.png' });
await browser.close();
