/**
 * 静态检查道具摆位：是否互相重叠、或压到分区/楼梯上。
 *
 * 覆盖**所有**占位物（墙上三个分区 + 地面护理室 + 楼梯）。
 * 第一版只查了护理室/楼梯，漏了墙上分区，于是窗户压在花园拱门上没被发现 ——
 * 检查表漏一类等于没查。
 *
 * 数值必须和 mapLayout.ts 同步，改那边要改这里。
 */
const VW = 720;
const VH = 846;
const HUD_TOP = 44;
const HUD_BOTTOM = 134;
const WALL_RATIO = 0.23;
const WORLD_SCALE = 1.6;
const TOP_INSET = 20;
const SKIRT_H = 18;

const worldW = VW * WORLD_SCALE;
const wl = -worldW / 2;

const top = VH / 2 - TOP_INSET - HUD_TOP;
const bottom = -VH / 2 + HUD_BOTTOM;
const stageH = Math.max(240, top - bottom);
const SIGN_H2 = 30, ZONE_H = 201, ZONE_SINK = 36;
const wallBottom = VH / 2 - VH * WALL_RATIO;
const floorH = wallBottom - bottom;
const wallH = VH / 2 - wallBottom;

const zoneH = ZONE_H;
const wallZoneCy = wallBottom + SKIRT_H - ZONE_SINK + zoneH / 2;
const hangBottom = wallBottom;
const hangH = top - hangBottom;

const storeH = Math.min(176, floorH * 0.62);
const stairH = Math.min(200, floorH * 0.62);
const stairW = stairH * (371 / 384);
const RIGHT_BLEED = 0.28;
const stairCx = worldW / 2 - stairW / 2 + stairW * RIGHT_BLEED;

const fixed = [
  { key: '[洗浴间]', cx: wl + worldW * 0.26, cy: wallZoneCy, w: VW*0.26, h: zoneH },
  { key: '[花园]', cx: wl + worldW * 0.44, cy: wallZoneCy, w: VW*0.28, h: zoneH },
  { key: '[育婴室]', cx: wl + worldW * 0.62, cy: wallZoneCy, w: VW*0.26, h: zoneH },
  { key: '[护理室]', cx: wl + 10 + 152 / 2, cy: bottom + storeH / 2, w: 152, h: storeH },
  { key: '[楼梯]', cx: stairCx, cy: bottom + stairH / 2, w: stairW, h: stairH },
];

const PROPS = [
  { key: 'window', on: 'wall', rx: 0.083, ry: 0.42, w: 88, h: 77 },
  { key: 'clock', on: 'wall', rx: 0.955, ry: 0.60, w: 40, h: 47 },
  { key: 'frames', on: 'wall', rx: 0.884, ry: 0.44, w: 50, h: 67 },
  { key: 'rug', on: 'floor', rx: 0.5, ry: 0.26, w: 290, h: 184 },
  { key: 'lamp', on: 'floor', rx: 0.17, ry: 0.58, w: 50, h: 127, anchor: 'bottom' },
  { key: 'shelf', on: 'floor', rx: 0.28, ry: 0.62, w: 92, h: 91, anchor: 'bottom' },
  { key: 'plant', on: 'floor', rx: 0.38, ry: 0.56, w: 52, h: 65, anchor: 'bottom' },
  { key: 'tower', on: 'floor', rx: 0.52, ry: 0.50, w: 72, h: 122, anchor: 'bottom' },
  { key: 'horse', on: 'floor', rx: 0.64, ry: 0.60, w: 74, h: 77, anchor: 'bottom' },
  { key: 'plant2', on: 'floor', rx: 0.72, ry: 0.66, w: 46, h: 58, anchor: 'bottom' },
  { key: 'shelf2', on: 'floor', rx: 0.78, ry: 0.54, w: 68, h: 67, anchor: 'bottom' },
  { key: 'cushion2', on: 'floor', rx: 0.72, ry: 0.36, w: 78, h: 47, anchor: 'bottom' },
  { key: 'plant3', on: 'floor', rx: 0.20, ry: 0.34, w: 42, h: 53, anchor: 'bottom' },
  { key: 'cushion', on: 'floor', rx: 0.26, ry: 0.09, w: 92, h: 55, anchor: 'bottom' },
  { key: 'bowls', on: 'floor', rx: 0.44, ry: 0.07, w: 84, h: 32, anchor: 'bottom' },
];

const rect = (p) => {
  const cx = wl + worldW * p.rx;
  const base = p.on === 'wall' ? wallBottom : bottom;
  const span = p.on === 'wall' ? (top - wallBottom) : floorH;
  const line = base + span * p.ry;
  const cy = p.anchor === 'bottom' ? line + p.h / 2 : line;
  return { key: p.key, on: p.on, cx, cy, w: p.w, h: p.h };
};

const boxes = PROPS.map(rect);
const ov = (a, b) => {
  const ox = Math.min(a.cx + a.w / 2, b.cx + b.w / 2) - Math.max(a.cx - a.w / 2, b.cx - b.w / 2);
  const oy = Math.min(a.cy + a.h / 2, b.cy + b.h / 2) - Math.max(a.cy - a.h / 2, b.cy - b.h / 2);
  return ox > 0 && oy > 0 ? { ox: Math.round(ox), oy: Math.round(oy) } : null;
};

console.log(`世界宽 ${worldW} (视口 ${VW}, 可拖 ±${((worldW - VW) / 2).toFixed(0)})`);
console.log(`top=${top.toFixed(0)} hangBottom=${hangBottom.toFixed(0)} wallBottom=${wallBottom.toFixed(0)} bottom=${bottom.toFixed(0)}`);
console.log(`墙占屏 ${((wallH / VH) * 100).toFixed(0)}%  地板占屏 ${((floorH / VH) * 100).toFixed(0)}%  挂件带 ${hangH.toFixed(0)}px  分区高 ${zoneH.toFixed(0)}px`);

let bad = 0;
console.log('--- 道具 vs 所有固定占位物 ---');
for (const b of boxes) {
  for (const f of fixed) {
    const o = ov(b, f);
    if (o && o.ox > 14 && o.oy > 14) {
      console.log(`  撞: ${b.key} × ${f.key} 交叠 ${o.ox}x${o.oy}`);
      bad++;
    }
  }
}
console.log('--- 道具之间（地毯是底层，跳过）---');
for (let i = 0; i < boxes.length; i++) {
  for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    if (a.on !== b.on || a.key === 'rug' || b.key === 'rug') continue;
    const o = ov(a, b);
    if (o && o.ox > 10 && o.oy > 10) {
      console.log(`  撞: ${a.key} × ${b.key} 交叠 ${o.ox}x${o.oy}`);
      bad++;
    }
  }
}
console.log('--- 挂件是否越界 ---');
for (const b of boxes.filter((x) => x.on === 'wall')) {
  if (b.cy - b.h / 2 < wallBottom - 2) {
    console.log(`  越界: ${b.key} 下沿 ${(b.cy - b.h / 2).toFixed(0)} < hangBottom ${hangBottom.toFixed(0)}`);
    bad++;
  }
  if (b.cy + b.h / 2 > top + 2) {
    console.log(`  越界: ${b.key} 上沿 ${(b.cy + b.h / 2).toFixed(0)} > top ${top.toFixed(0)}`);
    bad++;
  }
}
console.log(bad === 0 ? 'PASS 无重叠、无越界' : `FAIL ${bad} 处问题`);
console.log(`宠物 x=${(wl + worldW * 0.20).toFixed(0)}~${(wl + worldW * 0.80).toFixed(0)} y=${(bottom + floorH * 0.30).toFixed(0)}`);
