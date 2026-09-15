/**
 * 招牌文字的「分量」诊断。
 *
 * 用来回答「为什么竞品的字像画进去的、我们的像文本框贴上去的」。
 * 三个指标各对应一种做法上的差别：
 *
 * - **暗像素占比**：字笔画占了多少面积。细笔画的系统字体占比低。
 * - **中间调占比**：有描边/多层色的字会在字色和底色之间产生过渡像素；
 *   纯色字直接从字色跳到底色，中间调几乎为零。**这是最灵敏的一项。**
 * - **最暗/最亮**：字色与牌面色的实际取值。
 *
 * 用法：node scripts/text-weight.mjs <png> <x> <y> <w> <h> [标签]
 */
import fs from 'node:fs';
import { PNG } from 'pngjs';

const [file, xs, ys, ws, hs, tag] = process.argv.slice(2);
if (!file || !hs) {
  console.error('用法: node scripts/text-weight.mjs <png> <x> <y> <w> <h> [标签]');
  process.exit(1);
}
const x0 = +xs;
const y0 = +ys;
const w = +ws;
const h = +hs;

const d = PNG.sync.read(fs.readFileSync(file));
// 感知亮度（Rec.601）。不能用 max(r,g,b)：暖色/高饱和色会被算得偏亮，
// 详见 skill ui-visual-parity 的 ④f。
const lum = (i) => 0.299 * d.data[i] + 0.587 * d.data[i + 1] + 0.114 * d.data[i + 2];

let n = 0;
let dark = 0; // 笔画
let mid = 0; // 字与底之间的过渡（描边/抗锯齿之外的额外层）
let min = 255;
let max = 0;
let sum = 0;
for (let y = y0; y < Math.min(y0 + h, d.height); y++) {
  for (let x = x0; x < Math.min(x0 + w, d.width); x++) {
    const i = (y * d.width + x) * 4;
    if (d.data[i + 3] < 128) continue;
    const v = lum(i);
    n++;
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
    if (v < 110) dark++;
    else if (v < 200) mid++;
  }
}
if (!n) {
  console.log('区域内没有不透明像素');
  process.exit(0);
}
const pct = (k) => ((k / n) * 100).toFixed(1) + '%';
console.log(
  `${(tag || file.split(/[\\/]/).pop()).padEnd(16)} ${w}x${h}` +
    `  笔画(V<110) ${pct(dark)}  过渡(110~200) ${pct(mid)}` +
    `  最暗 ${min.toFixed(0)}  最亮 ${max.toFixed(0)}  平均 ${(sum / n).toFixed(0)}`
);
