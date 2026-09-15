/**
 * 截一张当前预览图到指定绝对路径。
 *
 * 为什么单独写：其它探针里的 `page.screenshot({path:'.build/shots/x.png'})`
 * 是**相对 cwd** 的，从 `.build/` 目录跑时会写到 `.build/.build/shots/`，
 * 于是量到的一直是几小时前的旧文件、数值当然不变。
 * 这里用 process.argv 传绝对路径，杜绝这个坑。
 */
import { chromium } from 'playwright';

const out = process.argv[2];
if (!out) {
  console.error('用法: node shot-now.mjs <输出绝对路径>');
  process.exit(1);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 414, height: 896 }, isMobile: true, hasTouch: true,
});
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:7456/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('canvas', { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(24000);
await page.screenshot({ path: out });
console.log('shot ->', out);
await browser.close();
