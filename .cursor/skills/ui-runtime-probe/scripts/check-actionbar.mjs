/**
 * 校验内联互动条不和宠物 / 底部 HUD 撞上。
 *
 * ⚠️ 常量是 `mapLayout.ts` 与 `MapActionBar.ts` 的**副本** ——
 * 改了那两处必须同步这里，否则查的是个假的（规则 `map-scroll-view`）。
 */
const HUD_BOTTOM = 134;
const WALL_RATIO = 0.23;
// MapActionBar
const BTN_H = 46;
const BAR_H = 7;
const BAR_GAP = 4;
const BARS = 3;
// mapLayout.ACTION_BAR_H：宠物抬升用的占位高度
const ACTION_BAR_H = 92;

// fitWidth 下高度随机型变，几档都要过
const HEIGHTS = [846, 896, 736, 640];

let bad = 0;
for (const vh of HEIGHTS) {
  const bottom = -vh / 2 + HUD_BOTTOM;
  const wallBottom = vh / 2 - vh * WALL_RATIO;
  const floorH = wallBottom - bottom;
  const petY = Math.max(bottom + floorH * 0.30, bottom + ACTION_BAR_H + 22);

  const barsH = BARS * BAR_H + (BARS - 1) * BAR_GAP;
  const btnCy = bottom + 6 + BTN_H / 2;
  const barsBottom = btnCy + BTN_H / 2 + 6;
  const barTop = barsBottom + barsH + 5;

  // 互动条实际占的高度，用来核对 mapLayout 的 ACTION_BAR_H 常量够不够
  const actual = barTop - bottom;
  if (actual > ACTION_BAR_H) {
    console.log(`  ⚠ ACTION_BAR_H=${ACTION_BAR_H} 小于实测 ${actual.toFixed(0)}`);
    bad++;
  }

  // 猫脚下还有状态条（petY - 10）和接地阴影，留 12 余量
  const clearance = petY - 10 - barTop;
  const ok = clearance >= 12;
  if (!ok) bad++;
  console.log(
    `vh=${vh} floorH=${floorH.toFixed(0)} petY=${petY.toFixed(0)} ` +
    `barTop=${barTop.toFixed(0)} clearance=${clearance.toFixed(0)} ${ok ? 'OK' : 'FAIL'}`,
  );
}
console.log(bad === 0 ? 'ALL OK' : `${bad} FAIL`);
