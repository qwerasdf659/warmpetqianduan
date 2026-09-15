/**
 * 算地板的「纵向占用率」：道具沿 y 轴铺开了多少、哪一段是空的。
 *
 * 「地板显得空」要能量出来才改得动 —— 靠目测调 ry 会来回摆。
 * 把地板按 y 分成 10 档，看每档有几件道具覆盖。
 */
const VW = 720;
const VH = 846;
const HUD_TOP = 104;
const HUD_BOTTOM = 134;
const WALL_RATIO = 0.40;
const WORLD_SCALE = 1.6;
const TOP_INSET = 60;

const worldW = VW * WORLD_SCALE;
const wl = -worldW / 2;
const top = VH / 2 - TOP_INSET - HUD_TOP;
const bottom = -VH / 2 + HUD_BOTTOM;
const stageH = Math.max(240, top - bottom);
const wallBottom = top - stageH * WALL_RATIO;
const floorH = wallBottom - bottom;

const PROPS = [
  { key: 'rug', rx: 0.5, ry: 0.26, w: 290, h: 184 },
  { key: 'lamp', rx: 0.17, ry: 0.58, w: 50, h: 127, anchor: 'bottom' },
  { key: 'shelf', rx: 0.28, ry: 0.62, w: 92, h: 91, anchor: 'bottom' },
  { key: 'plant', rx: 0.38, ry: 0.56, w: 52, h: 65, anchor: 'bottom' },
  { key: 'tower', rx: 0.52, ry: 0.50, w: 72, h: 122, anchor: 'bottom' },
  { key: 'horse', rx: 0.64, ry: 0.60, w: 74, h: 77, anchor: 'bottom' },
  { key: 'plant2', rx: 0.72, ry: 0.66, w: 46, h: 58, anchor: 'bottom' },
  { key: 'shelf2', rx: 0.78, ry: 0.54, w: 68, h: 67, anchor: 'bottom' },
  { key: 'cushion2', rx: 0.72, ry: 0.36, w: 78, h: 47, anchor: 'bottom' },
  { key: 'plant3', rx: 0.20, ry: 0.34, w: 42, h: 53, anchor: 'bottom' },
  { key: 'cushion', rx: 0.26, ry: 0.09, w: 92, h: 55, anchor: 'bottom' },
  { key: 'bowls', rx: 0.44, ry: 0.07, w: 84, h: 32, anchor: 'bottom' },
];

const boxes = PROPS.map((p) => {
  const cx = wl + worldW * p.rx;
  const line = bottom + floorH * p.ry;
  const cy = p.anchor === 'bottom' ? line + p.h / 2 : line;
  return { key: p.key, x1: cx - p.w / 2, x2: cx + p.w / 2, y1: cy - p.h / 2, y2: cy + p.h / 2 };
});

console.log(`地板 y ${bottom.toFixed(0)} ~ ${wallBottom.toFixed(0)} (高 ${floorH.toFixed(0)}px, 占屏 ${((floorH / VH) * 100).toFixed(0)}%)`);
console.log(`世界 x ${wl} ~ ${worldW / 2}`);

console.log('\n纵向 10 档覆盖（每档列出覆盖它的道具）：');
for (let i = 9; i >= 0; i--) {
  const y1 = bottom + (floorH * i) / 10;
  const y2 = bottom + (floorH * (i + 1)) / 10;
  const hit = boxes.filter((b) => b.y2 > y1 && b.y1 < y2).map((b) => b.key);
  const ry = `${(i / 10).toFixed(1)}-${((i + 1) / 10).toFixed(1)}`;
  console.log(`  ry ${ry}  ${hit.length ? hit.join(',') : '(空)'}`);
}

console.log('\n横向 8 档覆盖：');
for (let i = 0; i < 8; i++) {
  const x1 = wl + (worldW * i) / 8;
  const x2 = wl + (worldW * (i + 1)) / 8;
  const hit = boxes.filter((b) => b.x2 > x1 && b.x1 < x2).map((b) => b.key);
  const rx = `${(i / 8).toFixed(2)}-${((i + 1) / 8).toFixed(2)}`;
  console.log(`  rx ${rx}  ${hit.length ? hit.join(',') : '(空)'}`);
}
