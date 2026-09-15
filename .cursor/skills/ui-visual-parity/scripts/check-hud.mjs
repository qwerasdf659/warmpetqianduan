/**
 * 验证底部积分条放得下、且不和任务条/右下角入口重叠。
 *
 * `buildPointBar` 在空档不足时会**静默 return**（挤在一起比少一条更糟），
 * 所以必须显式算一次 —— 否则积分条悄悄消失了都不知道。
 * 数值同 MapHud.ts，改那边要改这里。
 */
const VW = 720;
const VH = 846;
const MARGIN = 12;
const TASK_H = 44;
const ENTRY = 56;
const PILL_H = 32;
const AVATAR = 56;
const PILL_W = 132;
const TOP_INSET = 60;

const bottom = -VH / 2;
const taskY = bottom + MARGIN + TASK_H / 2;
const taskW = VW * 0.56;
const taskX = -VW / 2 + MARGIN + taskW / 2;
const cx = VW / 2 - MARGIN - ENTRY / 2;

const x1 = taskX + taskW / 2;
const x2 = cx - ENTRY / 2;
const gap = x2 - x1;
const w = Math.min(108, gap - 16);

console.log(`任务条: x ${(taskX - taskW / 2).toFixed(0)} ~ ${x1.toFixed(0)} (宽 ${taskW.toFixed(0)})`);
console.log(`右下入口: x ${x2.toFixed(0)} ~ ${(cx + ENTRY / 2).toFixed(0)}`);
console.log(`空档: ${gap.toFixed(0)}px → 积分条宽 ${w.toFixed(0)}px`);
console.log(w >= 60 ? `PASS 积分条放得下` : `FAIL 空档只有 ${gap.toFixed(0)}px，积分条会被静默跳过`);

// 顶部：只剩金币一条，确认不再越过屏幕中线
const coinX = -VW / 2 + MARGIN + AVATAR + 10;
const coinRight = coinX + PILL_W;
console.log(`\n顶部金币条: x ${coinX.toFixed(0)} ~ ${coinRight.toFixed(0)}  屏幕中线 x=0`);
console.log(coinRight < VW * 0.25
  ? `PASS 顶部只占左侧 ${((coinRight + VW / 2) / VW * 100).toFixed(0)}% 以内`
  : `注意 顶部金币条右端到 x=${coinRight.toFixed(0)}`);

// 墙纸是否铺到屏幕顶
const HUD_TOP = 104;
const top = VH / 2 - TOP_INSET - HUD_TOP;
console.log(`\n内容上沿 top=${top.toFixed(0)}  墙纸上沿 wallTop=${(VH / 2).toFixed(0)}`);
console.log(`墙纸比内容多铺 ${((VH / 2) - top).toFixed(0)}px（原来这段是纯色空带，占屏高 ${(((VH / 2) - top) / VH * 100).toFixed(0)}%）`);
