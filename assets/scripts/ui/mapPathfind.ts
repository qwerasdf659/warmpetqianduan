/**
 * 家庭地图 · 宠物满地板游走的栅格寻路。
 *
 * 猫从「只沿一条横线走」升级成「整个地板 2D 自由游走、会绕开立体家具」。
 * 做法是把可游走的地板矩形切成栅格，把立体家具（灯/柜/花盆/爬架/木马）的
 * 包围盒标成障碍（按猫半径膨胀，猫身才不会擦进家具里），再用 A* 找路。
 * 平铺物（地毯/坐垫/食盆）不算障碍 —— 猫可以从上面走过去。
 *
 * 坐标系：全部用 **worldRoot 局部坐标**（和 `PROPS` 落位、宠物 position 同一空间）。
 */

import type { StageLayout } from './mapLayout';

/** 栅格边长（世界像素）。调细到 16：精度更高，相邻家具之间的缝隙才表现得出来。 */
const CELL = 16;
/** 猫的碰撞半径（世界像素）：障碍按它膨胀，猫身不会擦进家具。
 *  取 12 —— 只需刚好够猫身，太大(18/26)会把相邻家具之间的过道也堵死、粘成一片。 */
const CAT_RADIUS = 12;
/** 障碍每行的最小宽度（世界像素）：细杆家具（台灯杆）照实只占图宽 10%，
 *  猫会从杆两侧空隙穿过去像「穿过台灯」。保证每行有实体就至少这么宽。 */
const MIN_BLOCK_W = 40;

export interface Vec2 { x: number; y: number; }

interface Rect { x0: number; y0: number; x1: number; y1: number; }

/**
 * 障碍（世界坐标，中心 + 半宽半高）—— 由调用方从道具**实际渲染节点**推导。
 *
 * `mask`：道具图的 alpha 采样器 `(u,v)→是否不透明`（u,v∈[0,1]，v 自上而下）。
 *   有它就**按真实像素形状**标障碍 —— 斜楼梯挡斜楼梯、爬架挡爬架，不用矩形框
 *   一刀切（矩形套不准斜楼梯，会把斜边外的空地也标上）。以后用户放任何道具
 *   都自动精准、零手调。
 * `solid` / 无 mask 时的退路：`solid`=实心落地结构挡大部分高度，否则只挡底座。
 */
export interface ObstacleBox {
  cx: number; cy: number; hw: number; hh: number;
  solid?: boolean;
  mask?: (u: number, v: number) => boolean;
}

export class PetGrid {
  private cols = 0;
  private rows = 0;
  private ox = 0; // 栅格原点（世界坐标左下）
  private oy = 0;
  private minX = 0;
  private maxX = 0;
  private minY = 0;
  private maxY = 0;
  /** blocked[r*cols+c] = true 表示该格不可走 */
  private blocked: Uint8Array = new Uint8Array(0);

  /**
   * @param L      布局（给出可游走范围）
   * @param boxes  障碍框（世界坐标）。**由调用方从道具的实际渲染边界推导**，
   *               不在这里按布局表重算 —— 表里的目标框和 placeArt 缩放后的实际
   *               尺寸对不上，正是「障碍标记偏」的根因。空数组表示暂无障碍
   *               （道具还没加载完），猫先满地板走，加载完再 rebuild。
   */
  constructor(L: StageLayout, boxes: ObstacleBox[] = []) {
    this.build(L, boxes);
  }

  private build(L: StageLayout, boxes: ObstacleBox[]) {
    this.minX = L.petMinX;
    this.maxX = L.petMaxX;
    this.minY = L.petMinY;
    this.maxY = L.petMaxY;
    this.cols = Math.max(1, Math.ceil((this.maxX - this.minX) / CELL));
    this.rows = Math.max(1, Math.ceil((this.maxY - this.minY) / CELL));
    this.ox = this.minX;
    this.oy = this.minY;
    this.blocked = new Uint8Array(this.cols * this.rows);

    for (const b of boxes) {
      if (b.mask) {
        this.blockByMask(b);        // 按真实像素形状（斜楼梯/爬架都精准）
      } else if (b.solid) {
        // 无 mask 退路 —— 实心落地结构：挡大部分高度
        const bottom = b.cy - b.hh;
        this.blockRect({ x0: b.cx - b.hw * 0.86, x1: b.cx + b.hw * 0.86, y0: bottom, y1: bottom + b.hh * 2 * 0.78 });
      } else {
        // 无 mask 退路 —— 细高家具：只挡贴地底座，范围收紧（留出相邻过道）
        const bottom = b.cy - b.hh;
        const footH = Math.min(34, b.hh * 2 * 0.26);
        this.blockRect({ x0: b.cx - b.hw * 0.72, x1: b.cx + b.hw * 0.72, y0: bottom, y1: bottom + footH });
      }
    }

    // 障碍按猫半径膨胀：mask 标的是道具真实形状，再统一往外扩 CAT_RADIUS。
    this.dilate(CAT_RADIUS);
  }

  /**
   * 按道具的 alpha mask 标障碍：遍历道具包围盒覆盖的格子，把格中心映射到图的
   * (u,v) 采样，不透明就标为障碍。这样斜楼梯只挡它斜的实体、爬架只挡爬架，
   * 矩形框套不准的问题自然消失。
   */
  private blockByMask(b: ObstacleBox) {
    const x0 = b.cx - b.hw, x1 = b.cx + b.hw;
    const y0 = b.cy - b.hh, y1 = b.cy + b.hh;
    const c0 = Math.max(0, Math.floor((x0 - this.ox) / CELL));
    const c1 = Math.min(this.cols - 1, Math.floor((x1 - this.ox) / CELL));
    const r0 = Math.max(0, Math.floor((y0 - this.oy) / CELL));
    const r1 = Math.min(this.rows - 1, Math.floor((y1 - this.oy) / CELL));
    // 障碍最小宽度（格数）：细杆家具（台灯杆只占图宽 10%）如果照实标，猫会从
    // 杆两侧的空隙穿过去，看着像「穿过台灯」。所以每一行有实体就保证至少这么宽。
    const minCells = Math.max(1, Math.round(MIN_BLOCK_W / CELL));
    for (let rr = r0; rr <= r1; rr++) {
      // 先算这一行 mask 标住的列范围 [lo, hi]
      let lo = -1, hi = -1;
      for (let cc = c0; cc <= c1; cc++) {
        const wx = this.ox + cc * CELL + CELL / 2;
        const wy = this.oy + rr * CELL + CELL / 2;
        const u = (wx - x0) / (b.hw * 2);
        const v = 1 - (wy - y0) / (b.hh * 2); // v 自上而下
        if (u < 0 || u > 1 || v < 0 || v > 1) continue;
        if (b.mask!(u, v)) { if (lo < 0) lo = cc; hi = cc; }
      }
      if (lo < 0) continue; // 这一行没有实体
      // 不足最小宽度就以实体中心为准对称补足（细杆被撑到 minCells 宽）
      let span = hi - lo + 1;
      if (span < minCells) {
        const mid = (lo + hi) / 2;
        lo = Math.max(c0, Math.round(mid - minCells / 2));
        hi = Math.min(c1, lo + minCells - 1);
      }
      for (let cc = lo; cc <= hi; cc++) this.blocked[rr * this.cols + cc] = 1;
    }
  }

  /**
   * 形态学膨胀：把已标障碍的格子往外扩 radiusPx（世界像素）。
   * **用圆形（欧氏距离）不是方形** —— 方形膨胀在对角方向多扩 √2 倍，正是相邻
   * 家具红区粘连、吃掉过道的主因。圆形只扩必要的量，缝隙能留出来。
   */
  private dilate(radiusPx: number) {
    const n = Math.round(radiusPx / CELL);
    if (n <= 0) return;
    const r2 = (radiusPx / CELL) * (radiusPx / CELL);
    const src = this.blocked.slice();
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (src[r * this.cols + c] !== 1) continue;
        for (let dr = -n; dr <= n; dr++) {
          for (let dc = -n; dc <= n; dc++) {
            if (dr * dr + dc * dc > r2) continue; // 圆形范围内才扩
            const nr = r + dr, nc = c + dc;
            if (nr < 0 || nr >= this.rows || nc < 0 || nc >= this.cols) continue;
            this.blocked[nr * this.cols + nc] = 1;
          }
        }
      }
    }
  }

  /** 把一个世界矩形覆盖到的格子标为障碍（膨胀由最后的 dilate 统一做，这里不加） */
  private blockRect(r: Rect) {
    const x0 = r.x0, x1 = r.x1;
    const y0 = r.y0, y1 = r.y1;
    const c0 = Math.max(0, Math.floor((x0 - this.ox) / CELL));
    const c1 = Math.min(this.cols - 1, Math.floor((x1 - this.ox) / CELL));
    const r0 = Math.max(0, Math.floor((y0 - this.oy) / CELL));
    const r1 = Math.min(this.rows - 1, Math.floor((y1 - this.oy) / CELL));
    for (let rr = r0; rr <= r1; rr++) {
      for (let cc = c0; cc <= c1; cc++) this.blocked[rr * this.cols + cc] = 1;
    }
  }

  private idx(c: number, r: number) { return r * this.cols + c; }
  private inBounds(c: number, r: number) { return c >= 0 && c < this.cols && r >= 0 && r < this.rows; }
  isBlocked(c: number, r: number) { return !this.inBounds(c, r) || this.blocked[this.idx(c, r)] === 1; }

  /** 调试用：栅格尺寸与边长，供 MapView 画网格叠加 */
  get debugInfo() {
    return { cols: this.cols, rows: this.rows, cell: CELL, ox: this.ox, oy: this.oy };
  }
  /** 调试用：遍历每个格子（含是否障碍 + 格中心世界坐标） */
  forEachCell(cb: (c: number, r: number, blocked: boolean, center: Vec2) => void) {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        cb(c, r, this.blocked[this.idx(c, r)] === 1, this.toWorld(c, r));
      }
    }
  }

  /** 世界坐标 → 格坐标 */
  private toCell(x: number, y: number): { c: number; r: number } {
    return {
      c: Math.max(0, Math.min(this.cols - 1, Math.floor((x - this.ox) / CELL))),
      r: Math.max(0, Math.min(this.rows - 1, Math.floor((y - this.oy) / CELL))),
    };
  }
  /** 格中心 → 世界坐标 */
  private toWorld(c: number, r: number): Vec2 {
    return { x: this.ox + c * CELL + CELL / 2, y: this.oy + r * CELL + CELL / 2 };
  }

  /** 把任意世界坐标吸附到最近的可走格中心（拖动宠物松手时用）。找不到就原样返回。 */
  snapToFree(x: number, y: number): Vec2 {
    const cell = this.toCell(x, y);
    const free = this.nearestFree(cell.c, cell.r);
    if (!free) return { x, y };
    return this.toWorld(free.c, free.r);
  }

  /** 随机取一个可走格的世界坐标，找不到返回 null */
  randomFreePoint(): Vec2 | null {
    for (let tries = 0; tries < 80; tries++) {
      const c = Math.floor(Math.random() * this.cols);
      const r = Math.floor(Math.random() * this.rows);
      if (!this.isBlocked(c, r)) return this.toWorld(c, r);
    }
    return null;
  }

  /** 把一个点吸附到最近的可走格（起点可能落在膨胀障碍里） */
  private nearestFree(c: number, r: number): { c: number; r: number } | null {
    if (!this.isBlocked(c, r)) return { c, r };
    for (let radius = 1; radius < Math.max(this.cols, this.rows); radius++) {
      for (let dr = -radius; dr <= radius; dr++) {
        for (let dc = -radius; dc <= radius; dc++) {
          if (Math.abs(dr) !== radius && Math.abs(dc) !== radius) continue;
          const nc = c + dc, nr = r + dr;
          if (!this.isBlocked(nc, nr)) return { c: nc, r: nr };
        }
      }
    }
    return null;
  }

  /**
   * A* 找路，返回一串世界坐标路点（含终点，不含起点）。
   * 找不到路返回 []。允许 8 向移动，但**禁止穿过对角的障碍角**（防切角穿墙）。
   */
  findPath(from: Vec2, to: Vec2): Vec2[] {
    const fc = this.toCell(from.x, from.y);
    const tc = this.toCell(to.x, to.y);
    const s = this.nearestFree(fc.c, fc.r);
    const g = this.nearestFree(tc.c, tc.r);
    if (!s || !g) return [];
    const start = this.idx(s.c, s.r);
    const goal = this.idx(g.c, g.r);
    if (start === goal) return [this.toWorld(g.c, g.r)];

    const n = this.cols * this.rows;
    const gScore = new Float32Array(n).fill(Infinity);
    const fScore = new Float32Array(n).fill(Infinity);
    const came = new Int32Array(n).fill(-1);
    const open: number[] = [start];
    const inOpen = new Uint8Array(n);
    gScore[start] = 0;
    fScore[start] = this.heur(s.c, s.r, g.c, g.r);
    inOpen[start] = 1;

    const dirs = [
      [1, 0], [-1, 0], [0, 1], [0, -1],
      [1, 1], [1, -1], [-1, 1], [-1, -1],
    ];

    while (open.length) {
      // 取 fScore 最小的（数组线性扫，格子数不大够用）
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (fScore[open[i]] < fScore[open[bi]]) bi = i;
      const cur = open.splice(bi, 1)[0];
      inOpen[cur] = 0;
      if (cur === goal) return this.reconstruct(came, cur, s);

      const cc = cur % this.cols;
      const cr = Math.floor(cur / this.cols);
      for (const [dc, dr] of dirs) {
        const nc = cc + dc, nr = cr + dr;
        if (this.isBlocked(nc, nr)) continue;
        // 对角移动时，两个正交邻格都不能是障碍（否则等于从障碍角上切过去）
        if (dc !== 0 && dr !== 0) {
          if (this.isBlocked(cc + dc, cr) || this.isBlocked(cc, cr + dr)) continue;
        }
        const ni = this.idx(nc, nr);
        const step = (dc !== 0 && dr !== 0) ? 1.4142 : 1;
        const tentative = gScore[cur] + step;
        if (tentative < gScore[ni]) {
          came[ni] = cur;
          gScore[ni] = tentative;
          fScore[ni] = tentative + this.heur(nc, nr, g.c, g.r);
          if (!inOpen[ni]) { open.push(ni); inOpen[ni] = 1; }
        }
      }
    }
    return [];
  }

  private heur(c: number, r: number, gc: number, gr: number) {
    // 八向的 octile 距离
    const dx = Math.abs(c - gc), dy = Math.abs(r - gr);
    return (dx + dy) + (1.4142 - 2) * Math.min(dx, dy);
  }

  private reconstruct(came: Int32Array, goal: number, _s: { c: number; r: number }): Vec2[] {
    const cells: number[] = [];
    let cur = goal;
    while (cur !== -1) { cells.push(cur); cur = came[cur]; }
    cells.reverse();
    // 去掉起点格，转世界坐标，再做视线简化（合并共线/无遮挡的段）
    const pts = cells.map((i) => this.toWorld(i % this.cols, Math.floor(i / this.cols)));
    return this.simplify(pts).slice(1);
  }

  /** 路径简化：若从 A 直接到 C 视线无障碍，就丢掉中间的 B（少拐点、走得自然） */
  private simplify(pts: Vec2[]): Vec2[] {
    if (pts.length <= 2) return pts;
    const out: Vec2[] = [pts[0]];
    let anchor = 0;
    for (let i = 2; i < pts.length; i++) {
      if (!this.lineClear(pts[anchor], pts[i])) {
        out.push(pts[i - 1]);
        anchor = i - 1;
      }
    }
    out.push(pts[pts.length - 1]);
    return out;
  }

  /** 两点连线是否不穿过障碍（按格子采样） */
  private lineClear(a: Vec2, b: Vec2): boolean {
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(dist / (CELL / 2)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      const { c, r } = this.toCell(x, y);
      if (this.isBlocked(c, r)) return false;
    }
    return true;
  }
}
