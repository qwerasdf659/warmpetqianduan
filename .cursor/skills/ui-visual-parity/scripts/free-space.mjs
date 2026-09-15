/**
 * 打印地板上「后排」这条带子被谁占了、还剩哪些空档。
 *
 * 手工挪坐标挪到第三次就该算了 —— 一个一个试会陷入「修好 A 撞到 B」的循环。
 */
const VW = 720;
const VH = 846;
const HUD_TOP = 104;
const HUD_BOTTOM = 134;
const WALL_RATIO = 0.56;
const TOP_INSET = 60;
const SKIRT_H = 18;

const top = VH / 2 - TOP_INSET - HUD_TOP;
const bottom = -VH / 2 + HUD_BOTTOM;
const stageH = Math.max(240, top - bottom);
const wallBottom = top - stageH * WALL_RATIO;
const floorH = wallBottom - bottom;

const storeH = Math.min(176, floorH * 0.62);
const stairH = floorH * 0.95;
const stairW = stairH * (371 / 384);

// 固定占位物在地板上的横向投影
const blockers = [
  { key: '护理室', x1: -VW / 2 + 10, x2: -VW / 2 + 10 + 152 },
  { key: '楼梯', x1: VW / 2 - stairW + stairW * 0.28, x2: VW / 2 },
];

console.log(`地板: x ${-VW / 2} ~ ${VW / 2}, 高 ${floorH.toFixed(0)}px`);
console.log(`楼梯: ${stairW.toFixed(0)}x${stairH.toFixed(0)}  占 x ${blockers[1].x1.toFixed(0)}~${blockers[1].x2.toFixed(0)} (rx ${((blockers[1].x1 + VW / 2) / VW).toFixed(2)}~${((blockers[1].x2 + VW / 2) / VW).toFixed(2)})`);
console.log(`护理室: 占 x ${blockers[0].x1.toFixed(0)}~${blockers[0].x2.toFixed(0)} (rx ${((blockers[0].x1 + VW / 2) / VW).toFixed(2)}~${((blockers[0].x2 + VW / 2) / VW).toFixed(2)})`);

const freeX1 = blockers[0].x2 + 8;
const freeX2 = blockers[1].x1 - 8;
console.log(`\n后排可用横向区间: x ${freeX1.toFixed(0)} ~ ${freeX2.toFixed(0)}  宽 ${(freeX2 - freeX1).toFixed(0)}px`);
console.log(`  → rx ${((freeX1 + VW / 2) / VW).toFixed(3)} ~ ${((freeX2 + VW / 2) / VW).toFixed(3)}`);

// 后排要放的四件家具（宽度含 8px 间隙）
const rear = [
  { key: 'lamp', w: 50 },
  { key: 'shelf', w: 92 },
  { key: 'plant', w: 52 },
  { key: 'tower', w: 72 },
  { key: 'horse', w: 74 },
];
const gap = 10;
const total = rear.reduce((s, r) => s + r.w, 0) + gap * (rear.length - 1);
console.log(`\n后排五件总宽 ${total}px (含 ${gap}px 间隙) vs 可用 ${(freeX2 - freeX1).toFixed(0)}px → ${total <= freeX2 - freeX1 ? '放得下' : '放不下，需要减一件或缩小'}`);

// 均匀排布方案
let cursor = freeX1 + (freeX2 - freeX1 - total) / 2;
console.log('\n均匀排布建议 (rx):');
for (const r of rear) {
  const cx = cursor + r.w / 2;
  console.log(`  ${r.key.padEnd(8)} rx=${((cx + VW / 2) / VW).toFixed(3)}  (x=${cx.toFixed(0)}, w=${r.w})`);
  cursor += r.w + gap;
}
