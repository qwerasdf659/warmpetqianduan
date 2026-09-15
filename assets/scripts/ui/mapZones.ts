/**
 * 家庭地图 · 可点分区的绘制。
 *
 * 每个分区都是「嵌在墙上的壁龛 / 地面上的柜台」，共享同一面墙，
 * 所以读成「一个房间里的几个功能角」。独立店面各自带地面和屋檐，
 * 并排放会读成「一条商业街」，不是家 —— 这是概念稿的核心取舍。
 *
 * **每种 shape 都必须画出东西**：漏一个 case 那块墙会空着，
 * 而空墙和「资源没到货」看起来一模一样，排查时会白走一轮。
 * 所以 `paintZone` 的 default 分支退回圆拱，至少有画面。
 */

import { Graphics } from 'cc';
import { fillRoundRect, fillRoundRectRim, softShadow } from './widgets';
import { MAP_COLOR, SIGN_H } from './mapLayout';
import type { Zone } from './mapLayout';

/**
 * 招牌高度。**真身在 `mapLayout.ts`**（`computeLayout` 要用它反推分区高度，
 * 而本文件 import 了 mapLayout，反过来引会成循环依赖）。这里转发一次，
 * 让既有的 `from './mapZones'` 引用点不用改。
 *
 * 注意：`export { X } from '...'` 只做转发、**不会把名字带进本文件作用域**，
 * 而下面的绘制函数要用 SIGN_H，所以必须同时 import 进来再导出。
 */
export { SIGN_H };

/** 按形态分派。大厅（open）是纯活动区，概念稿里那块就是空地板 + 宠物，不画 */
export function paintZone(g: Graphics, z: Zone): void {
  switch (z.shape) {
    case 'alcove':
      paintAlcove(g, z);
      break;
    case 'arch':
      paintArch(g, z);
      break;
    case 'tent':
      paintTent(g, z);
      break;
    case 'store':
      paintStore(g, z);
      break;
    case 'open':
      break;
    default:
      paintAlcove(g, z);
  }
}

/** 招牌牌面宽度（按分区宽算，但有上限，免得宽分区的牌子太长） */
export function signWidth(z: Zone): number {
  return Math.min(z.w * 0.86, 132);
}

/**
 * 招牌牌面，**画在自己的节点原点上**（不是分区坐标）。
 *
 * 为什么独立成节点：招牌必须**常驻**。它曾经画在兜底层里，
 * 真图全部到货后兜底层整层隐掉，招牌木牌跟着消失，只剩文字飘在空墙上 ——
 * 而分区图里本来就没有招牌（图里的字号我们控制不了，所以一直是代码画的）。
 *
 * 位置由 MapView 决定：图到货后贴着图的实际顶边，没图时贴分区顶边。
 */
export function paintSignPlate(g: Graphics, w: number): void {
  const x = -w / 2;
  const y = -SIGN_H / 2;
  softShadow(g, x, y, w, SIGN_H, SIGN_H / 2, 4);
  fillRoundRectRim(g, x, y, w, SIGN_H, SIGN_H / 2, MAP_COLOR.sign, 3, MAP_COLOR.roof);
}

/**
 * 圆拱壁龛（洗浴间）。
 *
 * 「凹进墙面」的观感靠三层叠出来：外框深一档当墙体开口 → 内壁浅色 → 底部地台。
 * **不能只画一个浅色圆角矩形**，那读成一块贴在墙上的白板。
 */
function paintAlcove(g: Graphics, z: Zone): void {
  const h = z.h - SIGN_H;
  const top = z.cy + z.h / 2 - SIGN_H;
  const y = top - h;
  const x = z.cx - z.w / 2;
  const r = Math.min(z.w / 2, 60);

  // 外框（墙体开口，深一档 → 出「厚度」）
  fillRoundRectRim(g, x, y, z.w, h, r, MAP_COLOR.skirt, 3, MAP_COLOR.line);
  // 内壁（往内收，露出外框那一圈厚度）
  const pad = 9;
  fillRoundRect(g, x + pad, y + pad, z.w - pad * 2, h - pad * 2, r - pad / 2, MAP_COLOR.hut);
  // 底部地台（里面的东西坐在这上面，不悬空）
  fillRoundRect(g, x + pad, y + pad, z.w - pad * 2, 16, 6, MAP_COLOR.skirt);

  paintTub(g, z, y + pad + 16);
}

/** 浴缸：上宽下窄的圆角盆 + 三团泡泡（洗浴间的内容物） */
function paintTub(g: Graphics, z: Zone, baseY: number): void {
  const w = z.w * 0.6;
  const h = 44;
  const x = z.cx - w / 2;
  fillRoundRectRim(g, x, baseY + 6, w, h, 16, MAP_COLOR.bubble, 3, MAP_COLOR.line);
  g.fillColor = MAP_COLOR.water;
  [-w * 0.24, 0, w * 0.24].forEach((dx, i) => {
    g.circle(z.cx + dx, baseY + h - 4 + (i === 1 ? 7 : 0), i === 1 ? 12 : 9);
  });
  g.fill();
}

/**
 * 拱门（宠物花园）。概念稿里是一道爬满绿藤的双开木门，门内透出草地。
 * 「能走进去」的暗示靠两扇半开的门板 + 门内更亮的绿，不是靠一个洞。
 */
function paintArch(g: Graphics, z: Zone): void {
  const h = z.h - SIGN_H;
  const top = z.cy + z.h / 2 - SIGN_H;
  const y = top - h;
  const x = z.cx - z.w / 2;
  const r = Math.min(z.w / 2, 70);

  // 门框
  fillRoundRectRim(g, x, y, z.w, h, r, MAP_COLOR.roof, 3, MAP_COLOR.line);
  // 门内草地（比门框亮 → 读作「外面」）
  const pad = 10;
  fillRoundRect(g, x + pad, y + pad, z.w - pad * 2, h - pad * 2, r - pad / 2, MAP_COLOR.grass);

  // 两扇半开门板，贴在左右内壁
  const leafW = z.w * 0.22;
  const leafH = h * 0.56;
  [x + pad, x + z.w - pad - leafW].forEach((lx) => {
    fillRoundRectRim(g, lx, y + pad, leafW, leafH, 8, MAP_COLOR.hut, 2, MAP_COLOR.line);
  });

  // 门楣绿藤：一排交错的圆，压在门框上沿
  g.fillColor = MAP_COLOR.leaf;
  for (let bx = x + 12; bx < x + z.w - 8; bx += 22) {
    g.circle(bx, y + h - 4 + (bx % 44 === 0 ? 6 : 0), 12);
  }
  g.fill();

}

/**
 * 圆顶帐篷（育婴室）。概念稿里是粉色圆顶帐篷 + 门帘 + 顶上一颗小球。
 * 圆顶用大圆角矩形近似 —— Graphics 没有真三角，硬拼折线会有毛边。
 */
function paintTent(g: Graphics, z: Zone): void {
  const h = z.h - SIGN_H;
  const top = z.cy + z.h / 2 - SIGN_H;
  const y = top - h;
  const x = z.cx - z.w * 0.42;
  const w = z.w * 0.84;

  // 帐篷身（下半部）
  fillRoundRectRim(g, x, y, w, h * 0.7, 14, MAP_COLOR.tent, 3, MAP_COLOR.line);
  // 圆顶：半径取宽的一半 → 半圆，压在身子顶部
  fillRoundRectRim(g, x, y + h * 0.42, w, h * 0.5, w / 2, MAP_COLOR.tent, 3, MAP_COLOR.line);
  // 门帘：中间一个浅色拱形开口
  const doorW = w * 0.34;
  const doorH = h * 0.5;
  fillRoundRect(g, z.cx - doorW / 2 - z.w * 0.005, y, doorW, doorH, doorW / 2, MAP_COLOR.hut);
  // 顶上小球
  g.fillColor = MAP_COLOR.roof;
  g.circle(x + w / 2, y + h * 0.94, 8);
  g.fill();

}

/**
 * 药柜店面（护理室）。它在地面上、不在墙上，所以形态是「柜体 + 拱形门头」，
 * 概念稿左下角那个带红十字的药柜就是这个。
 */
function paintStore(g: Graphics, z: Zone): void {
  const h = z.h - SIGN_H;
  const top = z.cy + z.h / 2 - SIGN_H;
  const y = top - h;
  const x = z.cx - z.w / 2;
  const r = Math.min(z.w / 2, 56);

  // 门头拱框
  softShadow(g, x, y, z.w, h, r, 5);
  fillRoundRectRim(g, x, y, z.w, h, r, MAP_COLOR.skirt, 3, MAP_COLOR.line);
  // 柜体（玻璃门）
  const pad = 12;
  fillRoundRectRim(g, x + pad, y + pad, z.w - pad * 2, h - pad * 2 - 10, 8, MAP_COLOR.bubble, 2, MAP_COLOR.line);

  // 两层横板 + 药瓶
  const innerW = z.w - pad * 2;
  for (let i = 1; i <= 2; i++) {
    const sy = y + pad + ((h - pad * 2) / 3) * i;
    fillRoundRect(g, x + pad + 4, sy, innerW - 8, 4, 2, MAP_COLOR.skirt);
    // 板上摆三个瓶
    g.fillColor = i === 1 ? MAP_COLOR.water : MAP_COLOR.sign;
    [-innerW * 0.26, 0, innerW * 0.26].forEach((dx) => {
      g.rect(z.cx + dx - 6, sy + 4, 12, 16);
    });
    g.fill();
  }

  // 红十字，压在柜体正中
  g.fillColor = MAP_COLOR.cross;
  const ccy = y + h * 0.52;
  g.roundRect(z.cx - 4, ccy - 12, 8, 24, 3);
  g.roundRect(z.cx - 12, ccy - 4, 24, 8, 3);
  g.fill();

}
