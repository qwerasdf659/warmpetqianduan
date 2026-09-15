/**
 * 诊断「像贴上去的」：查每张图是不是把**自己的背景**一起烘进去了。
 *
 * 判据：
 * 1. 四角 alpha —— 抠干净的异形物件四角必须透明；四角不透明说明图是个实心矩形
 * 2. 包围盒填充率 —— 圆拱/帐篷这类异形轮廓正常在 55~75%，>85% 基本是矩形
 * 3. 边缘一圈的主色 —— 如果外圈有大片同色不透明像素，那就是烘进去的背景板
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';

const dir = process.argv[2];

for (const f of readdirSync(dir).filter((n) => n.toLowerCase().endsWith('.png'))) {
  const png = PNG.sync.read(readFileSync(join(dir, f)));
  const { width: W, height: H, data } = png;
  const A = (x, y) => data[(W * y + x) * 4 + 3];
  const RGB = (x, y) => {
    const i = (W * y + x) * 4;
    return `${data[i]},${data[i + 1]},${data[i + 2]}`;
  };

  // 1. 四角
  const corners = [[2, 2], [W - 3, 2], [2, H - 3], [W - 3, H - 3]];
  const opaqueCorners = corners.filter(([x, y]) => A(x, y) > 40).length;

  // 2. 填充率
  let opaque = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (A(x, y) > 8) opaque++;
  const fill = (opaque / (W * H)) * 100;

  // 3. 最外圈两像素的不透明比例 + 主色
  let edgeOpaque = 0;
  let edgeTotal = 0;
  const colorCount = new Map();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const onEdge = x < 3 || y < 3 || x > W - 4 || y > H - 4;
      if (!onEdge) continue;
      edgeTotal++;
      if (A(x, y) > 40) {
        edgeOpaque++;
        const c = RGB(x, y);
        colorCount.set(c, (colorCount.get(c) || 0) + 1);
      }
    }
  }
  const edgeRatio = (edgeOpaque / edgeTotal) * 100;
  const topColor = [...colorCount.entries()].sort((a, b) => b[1] - a[1])[0];

  const verdict = [];
  if (opaqueCorners >= 3) verdict.push('四角不透明→实心矩形');
  if (fill > 85) verdict.push('填充率过高');
  if (edgeRatio > 60) verdict.push('外圈大面积不透明→有烘进去的背景板');

  console.log(
    `${f.padEnd(22)} ${String(W).padStart(4)}x${String(H).padEnd(4)} ` +
    `填充${fill.toFixed(0).padStart(3)}% 四角${opaqueCorners}/4 外圈${edgeRatio.toFixed(0).padStart(3)}%` +
    (topColor ? ` 外圈主色 ${topColor[0]}` : '') +
    (verdict.length ? `  ⚠ ${verdict.join(' + ')}` : '  ok')
  );
}
