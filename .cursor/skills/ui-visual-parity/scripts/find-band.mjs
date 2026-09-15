/**
 * 找分区图里的「留字横带」位置（占图的比例）。
 *
 * **和 `find-plate.mjs` 的区别**：横带不再是近白牌面，
 * 而是「和小屋同色系的一段平整横向区域」（竞品的做法 —— 育婴室的字直接
 * 写在粉帐篷上、花园写在绿藤带上，都没有独立白牌）。
 * 所以判据从「找近白」换成**找颜色方差最小的连续横带**。
 *
 * 做法：对图的上 40%，逐行算「中间 60% 宽度内的颜色标准差」。
 * 平整横带那几行方差最小（因为提示词要求那里不要有装饰和纹理）。
 * 取连续的低方差带，中心即为落字点。
 *
 * 用法：node scripts/find-band.mjs <png> [<png>...]
 */
import fs from 'node:fs';
import { PNG } from 'pngjs';

for (const file of process.argv.slice(2)) {
  const d = PNG.sync.read(fs.readFileSync(file));
  const W = d.width;
  const H = d.height;
  const x0 = Math.round(W * 0.2);
  const x1 = Math.round(W * 0.8);

  const rows = [];
  for (let y = 0; y < Math.floor(H * 0.45); y++) {
    let n = 0;
    let sum = 0;
    let sum2 = 0;
    let opaque = 0;
    for (let x = x0; x <= x1; x++) {
      const i = (y * W + x) * 4;
      if (d.data[i + 3] < 250) continue;
      opaque++;
      const L = 0.299 * d.data[i] + 0.587 * d.data[i + 1] + 0.114 * d.data[i + 2];
      n++;
      sum += L;
      sum2 += L * L;
    }
    // 要求这一行基本填满（横带应当横跨中段），否则是背景空隙
    const fill = opaque / (x1 - x0 + 1);
    if (n < 10 || fill < 0.9) {
      rows.push(null);
      continue;
    }
    const mean = sum / n;
    const sd = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
    rows.push({ y, mean, sd });
  }

  // 低方差阈值：取所有有效行 sd 的 35 分位
  const valid = rows.filter(Boolean);
  if (!valid.length) {
    console.log(`${file.split(/[\\/]/).pop().padEnd(20)} 未找到横带`);
    continue;
  }
  const sds = valid.map((r) => r.sd).sort((a, b) => a - b);
  const th = sds[Math.floor(sds.length * 0.35)];

  let bands = [];
  let s = -1;
  rows.forEach((r, y) => {
    if (r && r.sd <= th) {
      if (s < 0) s = y;
    } else if (s >= 0) {
      bands.push([s, y - 1]);
      s = -1;
    }
  });
  if (s >= 0) bands.push([s, rows.length - 1]);

  // 取最厚的那条（横带比零散的平整行厚）
  const band = bands.sort((a, b) => b[1] - b[0] - (a[1] - a[0]))[0];
  const name = file.split(/[\\/]/).pop();
  if (!band || band[1] - band[0] < 6) {
    console.log(`${name.padEnd(20)} ${W}x${H}  横带太薄或未找到（bands=${bands.length}）`);
    continue;
  }
  const [y0, y1] = band;
  const cy = ((y0 + y1) / 2) / H;
  const mid = rows[Math.floor((y0 + y1) / 2)];
  console.log(
    `${name.padEnd(20)} ${W}x${H}  横带 y=${y0}..${y1}` +
      `  cy=${cy.toFixed(3)}  平均明度=${Math.round(mid.mean)}  sd=${mid.sd.toFixed(1)}`
  );
}
