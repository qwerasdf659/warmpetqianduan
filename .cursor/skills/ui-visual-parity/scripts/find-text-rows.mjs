/**
 * 找出截图里「有深色文字」的扫描行，省掉手工试坐标。
 *
 * 为什么需要：招牌位置随布局变（壁龛尺寸调过多轮），手填 y 经常扫在墙纸上 ——
 * 扫出一片纯色，看起来像「文字不见了」，实际只是采样错行。
 *
 * 做法：在给定 x 区间内统计每行的暗像素数，列出最多的几行。
 *
 * 用法：node scripts/find-text-rows.mjs <png> <x0> <x1> [y0] [y1] [暗阈值=150]
 */
import fs from 'node:fs';
import { PNG } from 'pngjs';

const [file, x0s, x1s, y0s, y1s, ths] = process.argv.slice(2);
if (!x1s) {
  console.error('用法: node scripts/find-text-rows.mjs <png> <x0> <x1> [y0] [y1] [阈值]');
  process.exit(1);
}
const d = PNG.sync.read(fs.readFileSync(file));
const x0 = +x0s;
const x1 = Math.min(+x1s, d.width - 1);
const y0 = y0s ? +y0s : 0;
const y1 = y1s ? Math.min(+y1s, d.height - 1) : d.height - 1;
const th = ths ? +ths : 150;

const rows = [];
for (let y = y0; y <= y1; y++) {
  let dark = 0;
  let minL = 255;
  for (let x = x0; x <= x1; x++) {
    const i = (y * d.width + x) * 4;
    const l = 0.299 * d.data[i] + 0.587 * d.data[i + 1] + 0.114 * d.data[i + 2];
    if (l < th) dark++;
    if (l < minL) minL = l;
  }
  if (dark) rows.push({ y, dark, minL: Math.round(minL) });
}
rows.sort((a, b) => b.dark - a.dark);
console.log(`${file}  x=${x0}..${x1} y=${y0}..${y1} 阈值<${th}`);
console.log('暗像素最多的行:');
rows.slice(0, 10).forEach((r) => console.log(`  y=${String(r.y).padStart(4)}  暗像素 ${String(r.dark).padStart(3)}  最暗 ${r.minL}`));
if (!rows.length) console.log('  (该区间内没有暗于阈值的像素 —— 采样区域可能不对)');
