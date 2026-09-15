/**
 * 验证楼梯确实被屏幕右边缘裁掉了 —— 「上面还有一层」的观感全靠这个裁切。
 *
 * 光看 PASS 不够：不重叠 ≠ 有溢出。必须显式算出「右边缘超出屏幕多少」，
 * 溢出为 0 就说明整座楼梯完整可见，又会读成一件家具。
 */
const VW = 720;
const VH = 846;
const HUD_TOP = 104;
const HUD_BOTTOM = 134;
const WALL_RATIO = 0.56;
const TOP_INSET = 60;

const top = VH / 2 - TOP_INSET - HUD_TOP;
const bottom = -VH / 2 + HUD_BOTTOM;
const stageH = Math.max(240, top - bottom);
const wallBottom = top - stageH * WALL_RATIO;
const floorH = wallBottom - bottom;

const stairH = floorH * 0.95;
const stairW = stairH * (371 / 384);
const RIGHT_BLEED = 0.28;
const cx = VW / 2 - stairW / 2 + stairW * RIGHT_BLEED;

const left = cx - stairW / 2;
const right = cx + stairW / 2;
const screenRight = VW / 2;
const bleed = right - screenRight;
const visibleRatio = (screenRight - left) / stairW;

console.log(`楼梯 ${stairW.toFixed(0)}x${stairH.toFixed(0)}`);
console.log(`  左边缘 x=${left.toFixed(0)}  右边缘 x=${right.toFixed(0)}  屏幕右界 x=${screenRight}`);
console.log(`  溢出屏幕 ${bleed.toFixed(0)}px  可见比例 ${(visibleRatio * 100).toFixed(0)}%`);
console.log(`  顶端 y=${(bottom + stairH).toFixed(0)}  墙地交界 y=${wallBottom.toFixed(0)}  ${bottom + stairH > wallBottom ? '(顶端伸进墙面区域)' : '(顶端仍在地板内)'}`);

const ok = bleed > 20 && visibleRatio > 0.6 && visibleRatio < 0.9;
console.log(ok
  ? `PASS 有明显裁切（溢出 ${bleed.toFixed(0)}px），能读出「通向楼上」`
  : `FAIL 裁切不足或过头：溢出 ${bleed.toFixed(0)}px、可见 ${(visibleRatio * 100).toFixed(0)}%（期望溢出>20px 且可见 60~90%）`);
