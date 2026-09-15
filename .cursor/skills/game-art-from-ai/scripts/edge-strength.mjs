// 量「轮廓有多清脆」+「大色块有多少」，用来解释同尺寸下为什么竞品细节读得清。
//
// 单色剪影和多色但糊成一团，在「彩色占比 / 色相种类」上都可能及格，
// 但小尺寸下读不清。决定读得清不清的是**相邻像素的明度落差**（轮廓对比）。
//
// 用法: node edge-strength.mjs <a.png> <b.png> <rx0> <ry0> <rx1> <ry1>
import { PNG } from 'pngjs';
import fs from 'fs';

function lum(d, i) {
  return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
}

function stats(file, rx0, ry0, rx1, ry1) {
  const p = PNG.sync.read(fs.readFileSync(file));
  const x0 = Math.floor(p.width * rx0), x1 = Math.floor(p.width * rx1);
  const y0 = Math.floor(p.height * ry0), y1 = Math.floor(p.height * ry1);
  let n = 0, sum = 0, strong = 0, veryStrong = 0, darkest = 255;
  for (let y = y0 + 1; y < y1 - 1; y++) {
    for (let x = x0 + 1; x < x1 - 1; x++) {
      const i = (y * p.width + x) * 4;
      if (p.data[i + 3] < 8) continue;
      const c = lum(p.data, i);
      if (c < darkest) darkest = c;
      // Sobel 近似：横向 + 纵向一阶差分
      const gx = Math.abs(lum(p.data, i + 4) - lum(p.data, i - 4));
      const gy = Math.abs(lum(p.data, i + p.width * 4) - lum(p.data, i - p.width * 4));
      const g = gx + gy;
      sum += g; n++;
      if (g > 20) strong++;
      if (g > 50) veryStrong++;
    }
  }
  return {
    w: x1 - x0, h: y1 - y0,
    avg: (sum / Math.max(1, n)).toFixed(1),
    strong: ((strong / Math.max(1, n)) * 100).toFixed(1),
    veryStrong: ((veryStrong / Math.max(1, n)) * 100).toFixed(1),
    darkest: Math.round(darkest),
  };
}

const [, , a, b, ...r] = process.argv;
const box = r.length === 4 ? r.map(Number) : [0, 0, 1, 1];
console.log(`采样区域: rx ${box[0]}~${box[2]}  ry ${box[1]}~${box[3]}\n`);
for (const [label, f] of [['竞品', a], ['我们', b]]) {
  const s = stats(f, box[0], box[1], box[2], box[3]);
  console.log(
    `${label}\t区域 ${s.w}x${s.h}px  平均边缘强度 ${s.avg}  ` +
    `明显轮廓占比 ${s.strong}%  强轮廓占比 ${s.veryStrong}%  最深像素明度 ${s.darkest}`
  );
}
