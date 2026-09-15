/**
 * 只量**指定区域**的色彩丰富度，用来判断「某块 UI 是否够丰富」。
 *
 * 全图统计会被大片墙地稀释 —— 实测全图彩色占比已接近竞品（9.2% vs 9.8%），
 * 但用户仍觉得按钮区域单薄。所以要单独量那一块。
 *
 * 用法: node region-compare.mjs <竞品png> <我们png> <rx1> <ry1> <rx2> <ry2>
 * 坐标是 0~1 的相对值，(0,0) 是左上角。
 */
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const [a, b, rx1, ry1, rx2, ry2] = process.argv.slice(2);
if (!b) {
  console.error('用法: node region-compare.mjs <A.png> <B.png> [rx1 ry1 rx2 ry2]');
  process.exit(1);
}
const box = [rx1, ry1, rx2, ry2].map(Number);
const [X1, Y1, X2, Y2] = box.some(Number.isNaN) ? [0.6, 0.82, 1.0, 1.0] : box;

const stat = (path, label) => {
  const png = PNG.sync.read(readFileSync(path));
  const { width: W, height: H, data } = png;
  const x1 = Math.round(W * X1), x2 = Math.round(W * X2);
  const y1 = Math.round(H * Y1), y2 = Math.round(H * Y2);

  let n = 0, sSum = 0, vSum = 0, vivid = 0;
  const hues = new Map();
  for (let y = y1; y < y2; y++) {
    for (let x = x1; x < x2; x++) {
      const i = (W * y + x) * 4;
      if (data[i + 3] < 200) continue;
      let r = data[i] / 255, g = data[i + 1] / 255, bb = data[i + 2] / 255;
      const mx = Math.max(r, g, bb), mn = Math.min(r, g, bb), d = mx - mn;
      let h = 0;
      if (d) {
        if (mx === r) h = ((g - bb) / d) % 6;
        else if (mx === g) h = (bb - r) / d + 2;
        else h = (r - g) / d + 4;
        h *= 60; if (h < 0) h += 360;
      }
      const s = mx ? (d / mx) * 100 : 0, v = mx * 100;
      if (v < 12) continue;
      n++; sSum += s; vSum += v;
      if (s > 25) {
        vivid++;
        // 色相按 30° 分桶，数「用了几种颜色」
        hues.set(Math.floor(h / 30), true);
      }
    }
  }
  console.log(`${label.padEnd(6)} 区域 ${x2 - x1}x${y2 - y1}px  ` +
    `平均饱和 ${(sSum / n).toFixed(1)}  平均明度 ${(vSum / n).toFixed(1)}  ` +
    `彩色占比 ${((vivid / n) * 100).toFixed(1)}%  色相种类 ${hues.size}/12`);
};

console.log(`采样区域: rx ${X1}~${X2}, ry ${Y1}~${Y2}\n`);
stat(a, '竞品');
stat(b, '我们');
