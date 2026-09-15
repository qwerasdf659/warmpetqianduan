/**
 * 算墙面上分区之间的空档，给挂件挑 rx。
 * 手工试 rx 会陷入「挪开花园又撞育婴室」的循环 —— 直接算。
 */
const VW = 720;
const WORLD_SCALE = 1.6;
const worldW = VW * WORLD_SCALE;
const wl = -worldW / 2;

const zones = [
  { key: '洗浴间', rx: 0.26, w: 720*0.26 },
  { key: '花园', rx: 0.44, w: 720*0.28 },
  { key: '育婴室', rx: 0.62, w: 720*0.26 },
];

const spans = zones
  .map((z) => {
    const cx = wl + worldW * z.rx;
    return { key: z.key, x1: cx - z.w / 2, x2: cx + z.w / 2 };
  })
  .sort((a, b) => a.x1 - b.x1);

console.log(`世界 x ${wl} ~ ${worldW / 2}  (宽 ${worldW})`);
for (const s of spans) {
  console.log(`  ${s.key.padEnd(6)} x ${s.x1.toFixed(0)} ~ ${s.x2.toFixed(0)}  rx ${((s.x1 - wl) / worldW).toFixed(3)}~${((s.x2 - wl) / worldW).toFixed(3)}`);
}

// 空档：世界左端→第一个分区、分区之间、最后一个分区→世界右端
const gaps = [];
gaps.push({ x1: wl, x2: spans[0].x1 });
for (let i = 0; i < spans.length - 1; i++) {
  gaps.push({ x1: spans[i].x2, x2: spans[i + 1].x1 });
}
gaps.push({ x1: spans[spans.length - 1].x2, x2: worldW / 2 });

console.log('\n可用空档（挂件要塞进这些）：');
const hangs = [
  { key: 'clock', w: 44 },
  { key: 'window', w: 96 },
  { key: 'frames', w: 84 },
];
for (const g of gaps) {
  const w = g.x2 - g.x1;
  const cx = (g.x1 + g.x2) / 2;
  const fits = hangs.filter((h) => h.w + 16 <= w).map((h) => h.key).join('/') || '(太窄)';
  console.log(`  x ${g.x1.toFixed(0)} ~ ${g.x2.toFixed(0)}  宽 ${w.toFixed(0)}  中心 rx=${((cx - wl) / worldW).toFixed(3)}  放得下: ${fits}`);
}
