/**
 * 量截图里墙/地各占屏幕高度的百分比。
 *
 * 判据：沿一条竖线自上而下扫，找**明度或饱和度突变**那一行 = 墙地交界。
 * 墙有条纹、地板是浅色平铺，交界处饱和度会明显掉下来。
 * 取多条竖线的中位数，避开家具和 UI 的干扰。
 */
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const sat = (r, g, b) => {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  return mx ? ((mx - mn) / mx) * 100 : 0;
};

for (const [label, path] of process.argv.slice(2).reduce((a, v, i, arr) => {
  if (i % 2 === 0) a.push([v, arr[i + 1]]);
  return a;
}, [])) {
  const png = PNG.sync.read(readFileSync(path));
  const { width: W, height: H, data } = png;

  // 按行算平均饱和度，只取中间 60% 宽度（躲开左右两侧的 UI 按钮）
  const x1 = Math.round(W * 0.2), x2 = Math.round(W * 0.8);
  const rows = [];
  for (let y = 0; y < H; y++) {
    let s = 0, n = 0;
    for (let x = x1; x < x2; x += 2) {
      const i = (W * y + x) * 4;
      if (data[i + 3] < 200) continue;
      s += sat(data[i], data[i + 1], data[i + 2]); n++;
    }
    rows.push(n ? s / n : 0);
  }

  // 墙地交界：在屏幕上半部找「饱和度从高走低」的最大跌幅处
  const from = Math.round(H * 0.10);
  const to = Math.round(H * 0.75);
  let bestY = -1, bestDrop = 0;
  const win = Math.max(4, Math.round(H * 0.012));
  for (let y = from; y < to - win; y++) {
    const before = rows.slice(Math.max(0, y - win), y).reduce((a, b) => a + b, 0) / win;
    const after = rows.slice(y, y + win).reduce((a, b) => a + b, 0) / win;
    const drop = before - after;
    if (drop > bestDrop) { bestDrop = drop; bestY = y; }
  }

  const pct = ((bestY / H) * 100).toFixed(0);
  console.log(`${label.padEnd(8)} ${W}x${H}  墙地交界 y=${bestY} (${pct}% 处)  跌幅 ${bestDrop.toFixed(1)}`);
  console.log(`  → 墙占屏 ${pct}%   地板占屏 ${(100 - Number(pct)).toFixed(0)}%`);
}
