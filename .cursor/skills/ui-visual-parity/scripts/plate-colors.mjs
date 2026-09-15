/**
 * 量一块招牌的「底色」和「字色」，用明度直方图分离两者。
 *
 * **为什么必须按块量、不能一次量完所有招牌**：竞品的每块招牌配色都不同
 * （实测浴室是木底白字、护理室是白底深字），
 * 用一个采样点或一个平均值会得出「都差不多」的错误结论。
 *
 * 判据：框住牌面，做明度直方图。
 * - **面积最大的那一档 = 底色**（底一定比字占面积大）
 * - 离它最远的那一档 = 字色
 *
 * 用法：node scripts/plate-colors.mjs <png> <x0> <y0> <w> <h> [标签]
 */
import fs from 'node:fs';
import { PNG } from 'pngjs';

const [file, xs, ys, ws, hs, tag] = process.argv.slice(2);
if (!hs) {
  console.error('用法: node scripts/plate-colors.mjs <png> <x0> <y0> <w> <h> [标签]');
  process.exit(1);
}
const d = PNG.sync.read(fs.readFileSync(file));
const x0 = +xs;
const y0 = +ys;
const w = +ws;
const h = +hs;

const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
const BIN = 26;
const bins = [];
for (let i = 0; i < 10; i++) bins.push({ n: 0, r: 0, g: 0, b: 0 });

let total = 0;
for (let y = y0; y < Math.min(y0 + h, d.height); y++) {
  for (let x = x0; x < Math.min(x0 + w, d.width); x++) {
    const i = (y * d.width + x) * 4;
    if (d.data[i + 3] < 200) continue;
    const r = d.data[i];
    const g = d.data[i + 1];
    const b = d.data[i + 2];
    const k = Math.min(9, Math.floor(lum(r, g, b) / BIN));
    bins[k].n++;
    bins[k].r += r;
    bins[k].g += g;
    bins[k].b += b;
    total++;
  }
}
if (!total) {
  console.log('区域内无不透明像素');
  process.exit(0);
}

const hex = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const desc = [];
bins.forEach((b, i) => {
  if (b.n < total * 0.04) return;
  const ar = b.r / b.n;
  const ag = b.g / b.n;
  const ab = b.b / b.n;
  desc.push({
    band: i * BIN,
    pct: (b.n / total) * 100,
    L: Math.round(lum(ar, ag, ab)),
    hex: hex(ar, ag, ab),
    rgb: `${Math.round(ar)},${Math.round(ag)},${Math.round(ab)}`,
  });
});

console.log(`${tag || file} 区域 ${w}x${h}`);
desc.forEach((x) =>
  console.log(`  L${String(x.band).padStart(3)}~ ${String(Math.round(x.pct)).padStart(3)}%  ${x.hex} rgb(${x.rgb}) L=${x.L}`)
);
// 底色 = 面积最大的一档；字色 = 与它明度差最大的一档
const base = desc.slice().sort((a, b) => b.pct - a.pct)[0];
const ink = desc.slice().sort((a, b) => Math.abs(b.L - base.L) - Math.abs(a.L - base.L))[0];
console.log(`  → 底色 ${base.hex} L=${base.L}（占 ${Math.round(base.pct)}%）`);
console.log(`  → 字色 ${ink.hex} L=${ink.L}`);
console.log(`  → ${ink.L > base.L ? '浅字配深底' : '深字配浅底'}，明度差 ${Math.abs(ink.L - base.L)}`);
