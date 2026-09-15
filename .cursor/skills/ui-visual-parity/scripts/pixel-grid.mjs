/**
 * 把一小块区域的像素明度打成字符网格，用肉眼判断「结构」。
 *
 * **为什么需要它**：判断小字的「字色 vs 描边色」时，
 * 直方图和包围盒都会失效 —— 20px 高的字在 JPG 里被压缩糊掉，
 * 笔画和它的描边混在一起，统计出的「离底色最远的一档」
 * 往往是**描边**而不是笔画。我因此连续量错四次竞品的字色。
 *
 * 网格法给的是结构信息：**哪一行是笔画的横画、哪一行是纯底色**，
 * 一眼就能定论。代价是要人看，不能自动化 —— 但比自动化错四次划算。
 *
 * 读法：
 * - 连续一整排同一个符号 = 一条横画，或者纯底色区
 * - 找「最亮档连成一排」的行 → 那是白字；「最暗档连成一排」→ 深色字
 *
 * 用法：node scripts/pixel-grid.mjs <png> <x0> <y0> <w> <h>
 */
import fs from 'node:fs';
import { PNG } from 'pngjs';

const [file, xs, ys, ws, hs] = process.argv.slice(2);
if (!hs) {
  console.error('用法: node scripts/pixel-grid.mjs <png> <x0> <y0> <w> <h>');
  console.error('建议 w<=80, h<=40，否则一行放不下');
  process.exit(1);
}
const d = PNG.sync.read(fs.readFileSync(file));
const x0 = +xs;
const y0 = +ys;
const w = Math.min(+ws, d.width - x0);
const h = Math.min(+hs, d.height - y0);

const lum = (x, y) => {
  const i = (y * d.width + x) * 4;
  return Math.round(0.299 * d.data[i] + 0.587 * d.data[i + 1] + 0.114 * d.data[i + 2]);
};
const sym = (L) => (L > 235 ? '@' : L > 210 ? '+' : L > 180 ? '.' : L > 140 ? 'o' : L > 110 ? 'O' : '#');

console.log(`${file} 区域 x=${x0}..${x0 + w - 1} y=${y0}..${y0 + h - 1}`);
for (let y = y0; y < y0 + h; y++) {
  let s = '';
  for (let x = x0; x < x0 + w; x++) s += sym(lum(x, y));
  console.log(String(y).padStart(4) + ' ' + s);
}
console.log('图例: @ >235(最亮)  + 210-235  . 180-210  o 140-180  O 110-140  # <110(最暗)');
console.log('提示: 连续一整排同符号 = 横画或纯底色。找「@连成排」= 白字，「#连成排」= 深色字。');
