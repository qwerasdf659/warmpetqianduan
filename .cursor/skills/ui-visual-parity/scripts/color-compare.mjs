/**
 * 对比两张截图的配色：墙/地主色、明度差、以及整体饱和度分布。
 *
 * 「感觉竞品颜色更好」要能落到数值上才改得动。上一轮我凭「参考图饱和度低」
 * 把整套颜色往灰里压，可能压过头了 —— 这次先量再改。
 */
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const rgb2hsv = (r, g, b) => {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return { h, s: mx ? (d / mx) * 100 : 0, v: mx * 100 };
};

/** 取一块矩形区域（相对坐标）的平均色 */
function region(png, rx1, ry1, rx2, ry2) {
  const { width: W, height: H, data } = png;
  const x1 = Math.round(W * rx1), x2 = Math.round(W * rx2);
  const y1 = Math.round(H * ry1), y2 = Math.round(H * ry2);
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = y1; y < y2; y++) {
    for (let x = x1; x < x2; x++) {
      const i = (W * y + x) * 4;
      if (data[i + 3] < 200) continue;
      r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
    }
  }
  if (!n) return null;
  return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
}

/** 整图饱和度/明度统计（忽略近白与近黑） */
function stats(png) {
  const { width: W, height: H, data } = png;
  let sSum = 0, vSum = 0, n = 0, vivid = 0;
  for (let y = 0; y < H; y += 3) {
    for (let x = 0; x < W; x += 3) {
      const i = (W * y + x) * 4;
      if (data[i + 3] < 200) continue;
      const { s, v } = rgb2hsv(data[i], data[i + 1], data[i + 2]);
      if (v < 12) continue;
      sSum += s; vSum += v; n++;
      if (s > 35) vivid++;      // 「有颜色」的像素
    }
  }
  return { s: (sSum / n).toFixed(1), v: (vSum / n).toFixed(1), vivid: ((vivid / n) * 100).toFixed(1) };
}

const show = (label, c) => {
  if (!c) return console.log(`  ${label}: (空)`);
  const { h, s, v } = rgb2hsv(c.r, c.g, c.b);
  console.log(`  ${label.padEnd(10)} rgb(${c.r},${c.g},${c.b})  H${h.toFixed(0)} S${s.toFixed(0)} V${v.toFixed(0)}`);
};

for (const [name, path, wallY, floorY] of [
  ['竞品', process.argv[2], [0.18, 0.24], [0.52, 0.58]],
  ['我们', process.argv[3], [0.14, 0.20], [0.62, 0.68]],
]) {
  const png = PNG.sync.read(readFileSync(path));
  console.log(`\n=== ${name} (${png.width}x${png.height}) ===`);
  const wall = region(png, 0.06, wallY[0], 0.20, wallY[1]);
  const floor = region(png, 0.40, floorY[0], 0.60, floorY[1]);
  show('墙', wall);
  show('地板', floor);
  if (wall && floor) {
    const wv = rgb2hsv(wall.r, wall.g, wall.b).v;
    const fv = rgb2hsv(floor.r, floor.g, floor.b).v;
    console.log(`  墙地明度差 ${(fv - wv).toFixed(1)}  (正 = 地板更亮)`);
  }
  const st = stats(png);
  console.log(`  全图 平均饱和度 ${st.s}  平均明度 ${st.v}  有彩色像素占比 ${st.vivid}%`);
}
