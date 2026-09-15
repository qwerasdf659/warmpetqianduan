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

/**
 * 按形态分派。大厅（open）是纯活动区，概念稿里那块就是空地板 + 宠物，不画。
 *
 * ⚠️ 这一整层是**兜底**：真图到齐后 `MapView` 会把它整层隐掉。
 * 真图里已经带了招牌，所以兜底这边也要画一块牌面（`paintSignPlate`），
 * 否则图加载失败时文字会飘在空墙上 —— 两条路径都必须出完整画面。
 */
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
      return; // 大厅没有招牌，直接返回（别往下画牌面）
    default:
      paintAlcove(g, z);
  }

  // 兜底留字横带。真图里门楣本身就是一条同色横带（不是白牌，见
  // `mapLayout.Zone.plate` 的说明），这一层是「图没到货」时的唯一画面，
  // 所以也画成一条**木色横带**而不是白牌 ——
  // 字色是白色（`signInk`）、描边是深棕（`signText`），
  // 底必须是中等明度（L≈190~220）白字才立得住，白牌会让字消失。
  const w = z.w * 0.6;
  const cy = z.cy + z.h / 2 - SIGN_H / 2;
  fillRoundRect(g, z.cx - w / 2, cy - SIGN_H / 2, w, SIGN_H, 4, MAP_COLOR.roof);
}

/**
 * > 曾经这里有 `signWidth(z, chars)`（按字数算牌面宽），2026-09-16 删除。
 * > 牌面不再由代码决定宽度 —— 留字横带画在图里、宽度占图 60%，
 * > 代码改为按 `Zone.plate.w` 读图上的实际宽度来定字号
 * > （见 `MapView.placeSignOnArt`）。
 */

/**
 * > 曾经这里有个 `paintSignPlate`（代码画的木牌 + 圆钉），2026-09-16 删除。
 * > 原因：代码画的牌面是同一块棕木牌，压在浴室(蓝瓷砖)/花园(绿藤)/育婴室(粉帐篷)
 * > 三个完全不同的门面上，那个棕色是整屏最深最突兀的一块。
 * > 现在牌面画进分区图里、材质随门面，代码只叠文字（见 `MapView.placeSignOnArt`）。
 * > 兜底层的简版牌面在 `paintZone` 末尾。
 */

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
