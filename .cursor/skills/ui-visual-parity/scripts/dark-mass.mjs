/**
 * 明度分布诊断：不透明像素的明度直方图 + 暗像素占比。
 *
 * 为什么需要它：`edge-strength.mjs` 报「我们最深像素明度 40 / 竞品 84」，
 * 但那只说明存在暗像素，说不出**暗的有多少、堆在哪**。
 * 「一大块暗部」和「均匀分布的深描边」在那个指标上看不出区别，
 * 而两者的修法正好相反（前者要提亮，后者要保留）。
 *
 * 用法：node scripts/dark-mass.mjs <png> [<png>...]
 */
import fs from 'node:fs';
import { PNG } from 'pngjs';

/**
 * 感知亮度（Rec.601），**不是 HSV 的 V**。
 *
 * 这里必须用加权亮度：`V = max(r,g,b)` 对暖色/高饱和色天然偏高 ——
 * 粉色 `#E08C9E` 的 max 是 224（落进最亮档），而感知亮度只有 167（中间调）。
 * 我第一版用 max，于是把粉色主导的育婴室误判成「全是近白色」，
 * 照着这个结论重出了一轮图、指标纹丝不动，白跑三分钟。
 */
function vOf(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

for (const p of process.argv.slice(2)) {
  const d = PNG.sync.read(fs.readFileSync(p));
  let n = 0;
  let sum = 0;
  const bins = new Array(10).fill(0); // 每 26 一档
  let d50 = 0;
  let d70 = 0;
  let d90 = 0;
  // 暗像素的重心，用来判断暗部是集中还是散布
  let dx = 0;
  let dy = 0;
  let dn = 0;
  for (let y = 0; y < d.height; y++) {
    for (let x = 0; x < d.width; x++) {
      const i = (y * d.width + x) * 4;
      if (d.data[i + 3] < 128) continue;
      const v = vOf(d.data[i], d.data[i + 1], d.data[i + 2]);
      n++;
      sum += v;
      bins[Math.min(9, Math.floor(v / 25.6))]++;
      if (v < 50) d50++;
      if (v < 70) {
        d70++;
        dx += x;
        dy += y;
        dn++;
      }
      if (v < 90) d90++;
    }
  }
  if (!n) {
    console.log(`${p}  (无不透明像素)`);
    continue;
  }
  const pct = (k) => ((k / n) * 100).toFixed(1) + '%';
  console.log(
    `${p.split(/[\\/]/).pop().padEnd(22)} ${d.width}x${d.height}` +
      `  平均明度 ${(sum / n).toFixed(1)}` +
      `  V<50 ${pct(d50)}  V<70 ${pct(d70)}  V<90 ${pct(d90)}`
  );
  if (dn) {
    console.log(
      `  暗像素(V<70)重心 rx=${(dx / dn / d.width).toFixed(2)} ry=${(dy / dn / d.height).toFixed(2)}` +
        `  (0.5/0.5 = 居中；贴边说明暗部是外框)`
    );
  }
  console.log('  直方图 ' + bins.map((b, i) => `${i * 26}:${pct(b)}`).join(' '));
}
