/**
 * 家庭地图 · 房间底层与装饰绘制。
 *
 * 只画「不可点的环境」：条纹墙、菱形格地板、墙裙、楼梯、以及一批装饰
 * （窗户+窗帘、相框、地毯、花盆、气球、木马）。可点的分区在 `mapZones.ts`。
 *
 * **装饰是这次改动的重点之一**。旧版只画了分区本体 + 招牌 + 楼梯横线，
 * 概念稿里那十几个装饰元素一个都没有，于是画面读成「几个色块摆在空地上」
 * 而不是「一个有人住的房间」。装饰零包体、纯 Graphics，成本只有几次 fill。
 *
 * 全部走同一个 Graphics（合批），所以本文件的函数都接收 `g` 而不是自建节点。
 * 调用顺序即叠放顺序：底色 → 墙/地 → 楼梯 → 装饰。
 */

import { Graphics } from 'cc';
import { fillRoundRect, fillRoundRectRim, softShadow } from './widgets';
import { MAP_COLOR, STRIPE_W, SKIRT_H, TILE, PROPS, bl } from './mapLayout';
import type { Rect, StageLayout } from './mapLayout';

/** 画整间房：底色 + 条纹墙 + 菱形格地板 + 墙裙 */
export function paintRoom(g: Graphics, L: StageLayout): void {
  paintWall(g, L);
  paintFloor(g, L);
  paintSkirt(g, L);
}

/**
 * 墙面：奶油底 + 竖条纹 + 爪印暗纹。
 *
 * **爪印是关键的一层**。只有竖条纹时墙面读成「一块布」，参考图里那种
 * 「宠物主题的房间」感来自条纹之间散布的小爪印暗纹 —— 成本是几十个圆，
 * 但它把纯色墙变成了有图案的墙纸。
 *
 * 对比度要压得很低（`wallPaw` 只比底色深一点）：暗纹一深就抢主体，
 * 而它的作用只是让大片墙面不至于空得发慌。
 */
function paintWall(g: Graphics, L: StageLayout): void {
  // 用 **wallTop（屏幕顶端）**而不是 top（内容上沿）：墙纸要铺满整屏，
  // 让 HUD 直接压在墙纸上。用 top 会在顶部留一条纯米色空带（白占屏高 12%）。
  const h = L.wallTop - L.wallBottom;
  fillRoundRect(g, -L.worldW / 2, L.wallBottom, L.worldW, h, 0, MAP_COLOR.wall);

  // 竖条纹
  g.fillColor = MAP_COLOR.wallStripe;
  for (let x = -L.worldW / 2; x < L.worldW / 2; x += STRIPE_W * 2) {
    g.rect(x, L.wallBottom, STRIPE_W, h);
  }
  g.fill();

  // 爪印暗纹：错行排布，落在条纹之间的浅色带上
  g.fillColor = MAP_COLOR.wallPaw;
  const stepX = STRIPE_W * 2;
  const stepY = 74;
  let row = 0;
  for (let y = L.wallBottom + 26; y < L.wallTop - 10; y += stepY, row++) {
    const offset = row % 2 === 0 ? STRIPE_W * 1.5 : STRIPE_W * 0.5;
    for (let x = -L.worldW / 2 + offset; x < L.worldW / 2; x += stepX) {
      paintPawGlyph(g, x, y, 4.6);
    }
  }
  g.fill();
}

/**
 * 爪印图案：掌垫 + 三个趾头。
 * 不 fill —— 由调用方统一收口，几十个爪印才不会各自占一次 DrawCall。
 */
function paintPawGlyph(g: Graphics, cx: number, cy: number, r: number): void {
  g.circle(cx, cy, r);
  g.circle(cx - r * 1.35, cy + r * 1.25, r * 0.52);
  g.circle(cx, cy + r * 1.7, r * 0.52);
  g.circle(cx + r * 1.35, cy + r * 1.25, r * 0.52);
}

/**
 * 地板：浅米底 + 菱形格。
 *
 * 菱形用四边形路径画（Graphics 没有旋转变换），每行错开半格形成格纹。
 * 一次 fill 收掉所有格子，不要每格 fill 一次 —— 那会把 DrawCall 打爆。
 */
function paintFloor(g: Graphics, L: StageLayout): void {
  const h = L.wallBottom - L.bottom;
  fillRoundRect(g, -L.worldW / 2, L.bottom, L.worldW, h, 0, MAP_COLOR.floor);

  g.fillColor = MAP_COLOR.floorTile;
  const half = TILE / 2;
  const left = -L.worldW / 2;
  for (let row = 0; row * half < h; row++) {
    const cy = L.bottom + row * half + half;
    if (cy - half > L.wallBottom) break;
    const offset = row % 2 === 0 ? 0 : half;
    for (let col = -1; left + col * TILE + offset < L.worldW / 2 + TILE; col++) {
      const cx = left + col * TILE + offset;
      g.moveTo(cx, cy + half);
      g.lineTo(cx + half, cy);
      g.lineTo(cx, cy - half);
      g.lineTo(cx - half, cy);
      g.close();
    }
  }
  g.fill();
}

/**
 * 墙裙：踢脚板 + 上沿压条。
 *
 * 参考图里墙地之间是**一条有厚度的木质踢脚板 + 一道更深的压条**，
 * 不是一条纯色带。压条只有 4px，但它给出了「板子有厚度」的暗示，
 * 少了这一道墙和地就像两块色纸拼在一起。
 */
function paintSkirt(g: Graphics, L: StageLayout): void {
  fillRoundRect(g, -L.worldW / 2, L.wallBottom, L.worldW, SKIRT_H, 0, MAP_COLOR.skirt);
  // 上沿压条：用**比踢脚板只深一点**的 skirtLine，绝不能用描边色 line。
  // 曾用 line（140,106,74 深棕）画这一道，结果是一条深色横线横贯整屏、
  // 把画面切成上下两半 —— 这就是「割裂感」最直接的来源。
  // 参考图的墙地交界几乎看不出线，视线是滑过去的。
  fillRoundRect(g, -L.worldW / 2, L.wallBottom + SKIRT_H - 3, L.worldW, 3, 0, MAP_COLOR.skirtLine);
}

/**
 * 楼梯的**兜底轮廓**：踏步 + 扶手 + 栏杆立柱。
 * 真图是 `map/props/prop_stairs`，这一层是它加载失败时的保底。
 *
 * 概念稿右下角那道通往二楼的楼梯。它**不是入口**（没有对应玩法），
 * 纯粹是「这栋房子还有别的楼层」的暗示，所以不做成 Zone。
 *
 * `s` 已经被 `computeLayout` 推出屏幕右侧一截，所以这里照它的矩形画就会
 * **跟着一起被屏幕边缘裁掉** —— 兜底和真图的「通向二楼」暗示才一致。
 * 别在这里自己把矩形夹回屏幕内，那会让兜底画出一座完整楼梯、
 * 和真图的观感对不上。
 */
export function paintStairs(g: Graphics, s: Rect): void {
  const [x, y] = bl(s);
  const steps = 5;
  const stepH = s.h / steps;
  const stepW = s.w / steps;

  // 踏步：从左下往右上，每级比上一级窄，读作透视
  for (let i = 0; i < steps; i++) {
    const w = s.w - i * stepW * 0.5;
    softShadow(g, x + i * stepW * 0.5, y + i * stepH, w, stepH, 4, 3);
    fillRoundRectRim(g, x + i * stepW * 0.5, y + i * stepH, w, stepH, 4, MAP_COLOR.stair, 2, MAP_COLOR.skirt);
  }

  // 扶手：斜着一条，用一串小圆近似（Graphics 画不了斜矩形）
  g.fillColor = MAP_COLOR.roof;
  for (let i = 0; i <= steps * 4; i++) {
    const t = i / (steps * 4);
    g.circle(x + t * s.w * 0.86 + 6, y + t * s.h + s.h * 0.18, 5);
  }
  g.fill();

  // 栏杆立柱
  g.fillColor = MAP_COLOR.stair;
  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    g.rect(x + t * s.w * 0.86 + 4, y + t * s.h + stepH, 4, s.h * 0.16);
  }
  g.fill();
}

/**
 * 墙上装饰的**兜底轮廓**。
 *
 * 真实美术图会盖在这之上（见 `MapView.loadProps()`）。这一层留着是因为
 * **图加载失败时墙不能是空的** —— 空墙和「图还没到货」看起来一模一样，
 * 排查时会白走一轮。只画到「能看出那儿有个窗/有幅画」的程度，细节交给图。
 *
 * **坐标从同一张 `PROPS` 表算**，不再各写一遍：两边手写坐标必然会漂，
 * 已经踩过一次（窗户和相框都写了 x=0，相框正好压在窗户上糊成一团）。
 */
export function paintWallDecor(g: Graphics, L: StageLayout): void {
  // 以 wallBottom 为基准、跨整个墙高（和 MapView.loadProps 一致）
  const wallH = L.top - L.wallBottom;

  PROPS.filter((p) => p.on === 'wall').forEach((p) => {
    const x = -L.worldW / 2 + L.worldW * p.rx;
    const y = L.wallBottom + wallH * p.ry;
    if (p.key === 'window') {
      paintWindow(g, x, y, p.w * 0.68, p.h * 0.8);
    } else if (p.key === 'frames') {
      // 一张图里是两幅并排，兜底也画两幅，间距按图的比例给
      [-p.w * 0.24, p.w * 0.24].forEach((dx, i) => {
        paintPicture(g, x + dx, y, p.w * 0.4, p.h * 0.92, i === 0);
      });
    } else if (p.key === 'clock') {
      paintClock(g, x, y, p.w * 0.45);
    }
  });
}

/** 挂钟兜底：外框圆 + 浅色表盘 + 两根指针 */
function paintClock(g: Graphics, cx: number, cy: number, r: number): void {
  g.fillColor = MAP_COLOR.roof;
  g.circle(cx, cy, r);
  g.fill();
  g.fillColor = MAP_COLOR.hut;
  g.circle(cx, cy, r * 0.78);
  g.fill();
  g.fillColor = MAP_COLOR.line;
  g.rect(cx - 1.5, cy, 3, r * 0.5);
  g.rect(cx, cy - 1.5, r * 0.38, 3);
  g.fill();
}

/** 窗户：木框 + 天空 + 十字窗棂 + 两片粉窗帘 */
function paintWindow(g: Graphics, cx: number, cy: number, w: number, h: number): void {
  const x = cx - w / 2;
  const y = cy - h / 2;
  fillRoundRectRim(g, x, y, w, h, 10, MAP_COLOR.sky, 4, MAP_COLOR.roof);

  // 窗棂：一横一竖，把窗分成四格
  g.fillColor = MAP_COLOR.roof;
  g.rect(cx - 2, y, 4, h);
  g.rect(x, cy - 2, w, 4);
  g.fill();

  // 窗帘：两片粉色，上宽下窄，挂在窗框外侧
  const curW = w * 0.3;
  [x - 6, x + w + 6 - curW].forEach((lx) => {
    fillRoundRectRim(g, lx, y + h * 0.1, curW, h * 0.95, 12, MAP_COLOR.tent, 2, MAP_COLOR.line);
  });

  // 帘头横杆
  fillRoundRect(g, x - 10, y + h - 4, w + 20, 8, 4, MAP_COLOR.roof);
}

/** 相框：木边 + 浅底 + 一个简笔内容（爪印 / 鱼） */
function paintPicture(g: Graphics, cx: number, cy: number, w: number, h: number, paw: boolean): void {
  const x = cx - w / 2;
  const y = cy - h / 2;
  softShadow(g, x, y, w, h, 6, 4);
  fillRoundRectRim(g, x, y, w, h, 6, MAP_COLOR.hut, 3, MAP_COLOR.roof);

  g.fillColor = MAP_COLOR.skirt;
  if (paw) {
    // 爪印：一个大圆 + 三个小圆
    g.circle(cx, cy - 4, 9);
    [-9, 0, 9].forEach((dx, i) => g.circle(cx + dx, cy + 11 + (i === 1 ? 3 : 0), 4));
  } else {
    // 鱼：身子一个圆 + 尾巴一个小圆
    g.circle(cx + 3, cy, 10);
    g.circle(cx - 11, cy, 6);
  }
  g.fill();
}

/**
 * 落地道具的接地阴影：脚下一片很淡的扁椭圆。
 *
 * **必须画在贴图之下**，所以单独一层、由 MapView 排在 SpriteLayer 前面。
 * 没有它的话所有家具都像贴纸浮在地板上，这是「塑料感」除配色之外的另一半来源。
 *
 * 只给 `anchor: 'bottom'` 的道具画 —— 那些才是「站在地上」的物件；
 * 地毯本身就是平铺在地上的，再加阴影反而脏。
 */
export function paintContactShadows(g: Graphics, L: StageLayout): void {
  const floorH = L.wallBottom - L.bottom;

  PROPS.filter((p) => p.on === 'floor' && p.anchor === 'bottom').forEach((p) => {
    const cx = -L.worldW / 2 + L.worldW * p.rx;
    const y = L.bottom + floorH * p.ry;
    // 宽度略大于物件、高度压得很扁，才像投在地上而不是一个球
    const w = p.w * 0.82;
    const h = 13;
    fillRoundRect(g, cx - w / 2, y - h / 2 + 2, w, h, h / 2, MAP_COLOR.contactShadow);
  });

  // 楼梯不在 PROPS 表里（位置由 L.stair 给），要单独补一片，
  // 否则整座楼梯没有接地阴影、又变回「浮在地板上」
  const s = L.stair;
  const sw = s.w * 0.78;
  fillRoundRect(g, s.cx - sw / 2, s.cy - s.h / 2 - 5, sw, 14, 7, MAP_COLOR.contactShadow);
}

/** 宠物脚下的接地阴影。宠物会走动，所以由 MapView 每帧跟随，不进静态层 */
export function paintPetShadow(g: Graphics, w = 62): void {
  const h = 14;
  fillRoundRect(g, -w / 2, -h / 2, w, h, h / 2, MAP_COLOR.contactShadow);
}

/**
 * 地面装饰的**兜底轮廓**：地毯 + 两个花盆 + 气球 + 木马。
 *
 * 地毯/花盆/木马都有真实美术图盖在上面（`prop_rug`/`prop_plant`/`prop_horse`），
 * 这一层是加载失败时的保底。**气球没有图，只有这一份代码绘制** ——
 * 它足够简单，画出来和图差别不大，不值得单独出一张。
 */
export function paintFloorDecor(g: Graphics, L: StageLayout): void {
  const floorH = L.wallBottom - L.bottom;

  PROPS.filter((p) => p.on === 'floor').forEach((p) => {
    const x = -L.worldW / 2 + L.worldW * p.rx;
    const yLine = L.bottom + floorH * p.ry;
    // anchor='bottom' 的物件底边坐在 yLine 上，其余居中
    const cy = p.anchor === 'bottom' ? yLine + p.h / 2 : yLine;
    // 按 **art** 分派而不是 key：plant2/shelf2 这类复用槽位的 key 带后缀，
    // 用 key 会全部落到 default 分支画成通用木箱
    paintFloorProp(g, p.art || p.key, x, yLine, cy, p);
  });

  // 气球**没有出图**，只有这一份代码绘制：它足够简单，
  // 画出来和图差别不大，不值得单独占一张图的体积。
  // 放在木马与楼梯之间那道窄缝里，不和后排家具抢位置。
  paintBalloons(g, -L.worldW / 2 + L.worldW * 0.845, L.bottom + floorH * 0.66);
}

/**
 * 按 key 分派地面道具的兜底画法。
 *
 * 没有实现的 key **画一个通用木箱**而不是什么都不画：那样至少能看出
 * 「这里本该有个东西」，而空地板和「图没加载」看起来一模一样。
 */
function paintFloorProp(
  g: Graphics, key: string, x: number, yLine: number, cy: number, p: { w: number; h: number },
): void {
  switch (key) {
    case 'rug':
      paintRug(g, x, cy, p.w, 54);
      return;
    case 'plant':
      paintPlant(g, x, yLine);
      return;
    case 'horse':
      paintRockingHorse(g, x, cy);
      return;
    case 'cushion':
      paintCushion(g, x, cy, p.w * 0.8);
      return;
    case 'bowls':
      paintBowls(g, x, yLine, p.w * 0.8);
      return;
    default:
      // shelf / lamp / tower 等竖高家具：一个带边的圆角块
      fillRoundRectRim(
        g, x - p.w * 0.34, yLine, p.w * 0.68, p.h * 0.82, 8, MAP_COLOR.roof, 3, MAP_COLOR.line,
      );
  }
}

/** 地毯：扁圆角矩形近似椭圆 + 浅色内圈做编织感 */
function paintRug(g: Graphics, cx: number, cy: number, w: number, h: number): void {
  fillRoundRectRim(g, cx - w / 2, cy - h / 2, w, h, h / 2, MAP_COLOR.rug, 3, MAP_COLOR.skirt);
  fillRoundRect(g, cx - w / 2 + 16, cy - h / 2 + 10, w - 32, h - 20, (h - 20) / 2, MAP_COLOR.floor);
}

/** 坐垫：扁圆 + 中间凹一档 */
function paintCushion(g: Graphics, cx: number, cy: number, w: number): void {
  const h = w * 0.5;
  fillRoundRectRim(g, cx - w / 2, cy - h / 2, w, h, h / 2, MAP_COLOR.tent, 3, MAP_COLOR.line);
  fillRoundRect(g, cx - w / 2 + 10, cy - h / 2 + 7, w - 20, h - 14, (h - 14) / 2, MAP_COLOR.hut);
}

/** 食水碗：两个小碗并排 */
function paintBowls(g: Graphics, cx: number, yLine: number, w: number): void {
  const bw = w * 0.42;
  const bh = bw * 0.62;
  [cx - w / 2, cx + w / 2 - bw].forEach((bx, i) => {
    fillRoundRectRim(g, bx, yLine, bw, bh, bh / 2, MAP_COLOR.hut, 2, MAP_COLOR.line);
    g.fillColor = i === 0 ? MAP_COLOR.balloon : MAP_COLOR.water;
    g.circle(bx + bw / 2, yLine + bh * 0.62, bw * 0.26);
    g.fill();
  });
}

/** 花盆：陶盆 + 三团叶子 */
function paintPlant(g: Graphics, cx: number, cy: number): void {
  const potW = 34;
  const potH = 26;
  // 叶子先画（在盆后面）
  g.fillColor = MAP_COLOR.leaf;
  [[-11, 20, 13], [0, 32, 15], [12, 21, 12]].forEach(([dx, dy, r]) => {
    g.circle(cx + dx, cy + dy, r);
  });
  g.fill();
  // 盆：上宽下窄
  fillRoundRectRim(g, cx - potW / 2, cy - potH / 2, potW, potH, 6, MAP_COLOR.roof, 2, MAP_COLOR.line);
  fillRoundRect(g, cx - potW / 2 - 3, cy + potH / 2 - 8, potW + 6, 9, 4, MAP_COLOR.skirt);
}

/** 木马：马身 + 头 + 弧形摇板 */
function paintRockingHorse(g: Graphics, cx: number, cy: number): void {
  const bodyW = 46;
  const bodyH = 26;
  // 摇板：一条扁圆角矩形当弧
  fillRoundRect(g, cx - bodyW / 2 - 6, cy - bodyH / 2 - 12, bodyW + 12, 9, 4, MAP_COLOR.roof);
  // 身子
  fillRoundRectRim(g, cx - bodyW / 2, cy - bodyH / 2, bodyW, bodyH, 12, MAP_COLOR.hut, 3, MAP_COLOR.line);
  // 头：右上一个圆 + 一个小口鼻
  g.fillColor = MAP_COLOR.hut;
  g.circle(cx + bodyW / 2 - 4, cy + bodyH / 2 + 4, 12);
  g.fill();
  g.fillColor = MAP_COLOR.tent;
  g.circle(cx + bodyW / 2 + 4, cy + bodyH / 2 + 2, 5);
  g.fill();
  // 鬃毛
  g.fillColor = MAP_COLOR.roof;
  [0, 7, 14].forEach((d) => g.circle(cx + bodyW / 2 - 14 + d, cy + bodyH / 2 + 12, 5));
  g.fill();
}

/** 气球：两颗 + 细线 */
function paintBalloons(g: Graphics, cx: number, cy: number): void {
  // 线（细矩形近似）
  g.fillColor = MAP_COLOR.line;
  g.rect(cx - 1, cy - 34, 2, 40);
  g.rect(cx + 13, cy - 34, 2, 32);
  g.fill();
  // 球
  g.fillColor = MAP_COLOR.balloon;
  g.circle(cx, cy + 16, 16);
  g.fill();
  g.fillColor = MAP_COLOR.tent;
  g.circle(cx + 14, cy + 8, 13);
  g.fill();
}
