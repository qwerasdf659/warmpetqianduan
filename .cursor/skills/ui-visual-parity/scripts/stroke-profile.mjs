/**
 * 沿一条水平扫描线打印逐像素颜色，用来数「字的描边有几层」。
 *
 * 为什么要这个：放大截图只能看出「边缘有点颜色」，数不清层数。
 * 而层数决定做法 —— 单层能用一个 LabelOutline 搞定，
 * 两层就得叠两个 Label 或换方案，两者工作量差很远。
 *
 * 读法：从牌面色进入笔画时，中间出现的**中间色**就是描边。
 * 只有一种中间色 = 单层描边；两种明显不同的中间色 = 双层。
 *
 * 用法：node scripts/stroke-profile.mjs <png> <y> <x0> <x1>
 */
import fs from 'node:fs';
import { PNG } from 'pngjs';

const [file, ys, x0s, x1s] = process.argv.slice(2);
if (!x1s) {
  console.error('用法: node scripts/stroke-profile.mjs <png> <y> <x0> <x1>');
  process.exit(1);
}
const y = +ys;
const x0 = +x0s;
const x1 = +x1s;

const d = PNG.sync.read(fs.readFileSync(file));
const rows = [];
for (let x = x0; x <= Math.min(x1, d.width - 1); x++) {
  const i = (y * d.width + x) * 4;
  const r = d.data[i];
  const g = d.data[i + 1];
  const b = d.data[i + 2];
  const lum = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  // 用字符宽度直观表示明暗：越暗块越长
  const bar = '#'.repeat(Math.max(0, Math.round((255 - lum) / 12)));
  rows.push(`x=${String(x).padStart(4)} rgb(${String(r).padStart(3)},${String(g).padStart(3)},${String(b).padStart(3)}) L=${String(lum).padStart(3)} ${bar}`);
}
console.log(`扫描线 y=${y}, x=${x0}..${x1}  (文件 ${d.width}x${d.height})`);
console.log(rows.join('\n'));
