/**
 * 玩法面板的通用件。
 *
 * 五个玩法面板（护理室 / 洗浴间 / 育婴室 / 商店 / 花园）长得高度一致：
 * 顶部钱包条 → 中间可滚动列表 → 每行一个操作按钮，
 * 外加「加载中 / 加载失败可重试 / 空列表」三种非正常态。
 * 把这些收在这里，各面板只写自己的行内容与业务分支。
 *
 * 三条纪律直接编进了这些控件，不靠各面板自觉：
 * - **软失败不死亡**：`asyncBody` 的失败态一定带重试按钮，绝不停在空白。
 * - **不静默**：`tapButton` 在 disabled 时点了会 toast 出禁用原因，不是无反应。
 * - **防连点**：`tapButton` 的异步回调期间自动置忙，避免重复提交（幂等的前提）。
 */

import {
  Node,
  Label,
  Graphics,
  Color,
  UITransform,
  UIOpacity,
  EventTouch,
  Vec3,
  tween,
} from 'cc';
import {
  COLOR,
  makeNode,
  makeLabel,
  fillRoundRect,
  fillRoundRectRim,
  softShadow,
} from './widgets';
import { toast } from './toast';
import store from '../core/store';
import type { Pool, WalletView } from '../net/types';

/** 列表行的默认高度，各面板可覆盖 */
export const ROW_H = 84;
export const ROW_GAP = 8;
/** 判定「拖动」还是「点击」的位移阈值。和 MapView 保持一致的手感 */
const TAP_SLOP = 12;

// ---- 钱包条 ----

/**
 * 顶部余额条：金币 + 营销积分各一枚药丸。
 *
 * 两个池必须一眼可分（铁律：积分双池隔离），靠**色相**区分而不是文案：
 * 金币暖金、积分冷紫。返回一个 refresh 函数，买完东西调它就地刷新。
 */
export function walletBar(parent: Node, width: number, y: number): () => void {
  const h = 32;
  const pillW = (width - 12) / 2;

  const g = makeNode('WalletBar', parent, width, h).addComponent(Graphics);
  g.node.setPosition(0, y, 0);
  fillRoundRectRim(g, -width / 2, -h / 2, pillW, h, h / 2, COLOR.panelLight, 2);
  fillRoundRectRim(g, -width / 2 + pillW + 12, -h / 2, pillW, h, h / 2, COLOR.panelLight, 2);

  const coin = makeLabel('', parent, { size: 17, color: COLOR.coin, align: 'center', bold: true });
  coin.node.setPosition(-width / 2 + pillW / 2, y, 0);
  const point = makeLabel('', parent, { size: 17, color: COLOR.point, align: 'center', bold: true });
  point.node.setPosition(-width / 2 + pillW + 12 + pillW / 2, y, 0);

  const refresh = () => {
    if (!coin.node.isValid || !point.node.isValid) return;
    const w: WalletView = store.wallet;
    coin.string = `金币 ${w.gameCoin}`;
    point.string = `积分 ${w.marketingPoint}`;
  };
  refresh();
  return refresh;
}

/** 价格文案。pool 决定币种名，别把两个池混着说 */
export function priceText(price: number, pool: Pool): string {
  if (price <= 0) return '免费';
  return pool === 'marketing' ? `${price} 积分` : `${price} 金币`;
}

/** 余额是否够。判定只用于**按钮置灰**，真正的裁决在服务端（服务端权威） */
export function affordable(price: number, pool: Pool): boolean {
  const w = store.wallet;
  return (pool === 'marketing' ? w.marketingPoint : w.gameCoin) >= price;
}

// ---- 按钮 ----

export interface TapButtonOpts {
  width: number;
  height?: number;
  /** 主色实心（主操作）还是浅色描边（次要操作） */
  primary?: boolean;
  /** 置灰。**必须同时给 disabledReason**，否则就是静默失败 */
  disabled?: boolean;
  disabledReason?: string;
}

export interface TapButton {
  node: Node;
  label: Label;
  /** 改文案/禁用态，会重绘底板 */
  update(text: string, disabled?: boolean, reason?: string): void;
  /** 异步操作期间置忙，防连点 */
  setBusy(busy: boolean): void;
}

/**
 * 一个能点的按钮。
 *
 * 禁用时**不是**不响应，而是点了 toast 出原因——「点了没反应」玩家无法区分
 * 「不能点」和「坏了」，这是规则里反复强调的那条静默失败。
 *
 * onTap 返回 Promise 时自动进入忙态（文案变「…」、期间不再响应），
 * 这样每个写接口天然只会被提交一次，配合后端 bizId 幂等就不会重复扣费。
 */
export function tapButton(
  parent: Node,
  text: string,
  x: number,
  y: number,
  opts: TapButtonOpts,
  onTap: () => void | Promise<unknown>,
): TapButton {
  const w = opts.width;
  const h = opts.height || 40;
  const node = makeNode('TapBtn', parent, w, h);
  node.setPosition(x, y, 0);

  const g = node.addComponent(Graphics);
  const label = makeLabel(text, node, {
    size: 17,
    color: COLOR.accentText,
    align: 'center',
    bold: true,
  });
  label.node.setPosition(0, 0, 0);

  let disabled = !!opts.disabled;
  let reason = opts.disabledReason || '';
  let busy = false;
  let pressed = false;

  const paint = () => {
    if (!node.isValid) return;
    g.clear();
    const off = disabled || busy;
    const fill = off ? COLOR.disabled : pressed ? COLOR.accentPressed : opts.primary === false ? COLOR.panelLight : COLOR.accent;
    fillRoundRectRim(g, -w / 2, -h / 2, w, h, h / 2, fill, 2);
    label.color = off ? COLOR.dim : opts.primary === false ? COLOR.text : COLOR.accentText;
  };
  paint();

  node.on(Node.EventType.TOUCH_START, () => {
    pressed = true;
    paint();
  });
  const release = () => {
    pressed = false;
    paint();
  };
  node.on(Node.EventType.TOUCH_CANCEL, release);

  node.on(Node.EventType.TOUCH_END, () => {
    release();
    if (busy) return;
    if (disabled) {
      // 说清楚为什么不能点，而不是无反应
      if (reason) toast(reason);
      return;
    }
    const ret = onTap();
    if (!ret || typeof (ret as Promise<unknown>).then !== 'function') return;
    busy = true;
    const prev = label.string;
    label.string = '…';
    paint();
    (ret as Promise<unknown>).then(
      () => finishBusy(prev),
      () => finishBusy(prev),
    );
  });

  function finishBusy(prev: string) {
    busy = false;
    if (!node.isValid) return;
    label.string = prev;
    paint();
  }

  return {
    node,
    label,
    update(next: string, nextDisabled?: boolean, nextReason?: string) {
      if (!node.isValid) return;
      label.string = next;
      if (nextDisabled !== undefined) disabled = nextDisabled;
      if (nextReason !== undefined) reason = nextReason;
      paint();
    },
    setBusy(next: boolean) {
      busy = next;
      paint();
    },
  };
}

// ---- 列表行底板 ----

/** 一行的底板 + 标题 + 副文案。返回行节点，调用方往里加按钮 */
export function listRow(
  parent: Node,
  width: number,
  y: number,
  height: number,
  title: string,
  sub: string,
): Node {
  const row = makeNode('Row', parent, width, height);
  row.setPosition(0, y, 0);

  const g = row.addComponent(Graphics);
  softShadow(g, -width / 2, -height / 2, width, height, 14, 4);
  fillRoundRectRim(g, -width / 2, -height / 2, width, height, 14, COLOR.panelGlass, 2);

  const t = makeLabel(title, row, { size: 19, color: COLOR.title, bold: true });
  t.node.setPosition(-width / 2 + 14, height / 2 - 22, 0);

  const s = makeLabel(sub, row, { size: 15, color: COLOR.dim, width: width - 130 });
  s.node.setPosition(-width / 2 + 14, height / 2 - 48, 0);

  return row;
}

/** 细进度条，用于任务进度、保底进度这类「还差多少」 */
export function miniBar(parent: Node, width: number, y: number, ratio: number, color: Color): void {
  const h = 8;
  const g = makeNode('MiniBar', parent, width, h).addComponent(Graphics);
  g.node.setPosition(0, y, 0);
  fillRoundRect(g, -width / 2, -h / 2, width, h, h / 2, COLOR.track);
  const r = Math.max(0, Math.min(1, ratio));
  if (r > 0) fillRoundRect(g, -width / 2, -h / 2, width * r, h, h / 2, color);
}

// ---- 可滚动列表容器 ----

export interface ScrollList {
  /** 行内容挂到这里，坐标以「可视区顶部往下」为参照 */
  content: Node;
  /** 排完内容后调用，据实际高度算可拖范围 */
  setContentHeight(h: number): void;
  clear(): void;
}

/**
 * 竖向拖动的列表。
 *
 * 不用 ScrollView：那要预制体和 Mask 组件，而本项目全部界面是运行时代码搭的，
 * 引一个就要引一串。这里用位移拖动 + 面板边界做视觉遮挡，够用且零依赖
 * （ShopPanel 里已经验证过这个做法）。
 *
 * 命中要点（踩过）：**输入区必须显式设 contentSize**，否则收不到 TOUCH_START，
 * 而拖动因为只依赖 delta 反而还能用，表现为「能拖但点不动」。
 */
export function scrollList(parent: Node, width: number, height: number, centerY = 0): ScrollList {
  const area = makeNode('ScrollArea', parent, width, height);
  area.setPosition(0, centerY, 0);
  const areaTr = area.getComponent(UITransform);
  if (areaTr) {
    areaTr.setAnchorPoint(0.5, 0.5);
    areaTr.setContentSize(width, height);
  }

  const content = makeNode('Content', area, width, height);
  content.setPosition(0, 0, 0);

  let maxY = 0;
  let dragging = false;
  let lastY = 0;
  let moved = 0;

  area.on(Node.EventType.TOUCH_START, (e: EventTouch) => {
    dragging = true;
    moved = 0;
    lastY = e.getUILocation().y;
  });
  area.on(Node.EventType.TOUCH_MOVE, (e: EventTouch) => {
    if (!dragging || maxY <= 0) return;
    const y = e.getUILocation().y;
    const dy = y - lastY;
    lastY = y;
    moved += Math.abs(dy);
    if (moved < TAP_SLOP) return;
    const next = Math.min(maxY, Math.max(0, content.position.y + dy));
    content.setPosition(0, next, 0);
  });
  const end = () => {
    dragging = false;
  };
  area.on(Node.EventType.TOUCH_END, end);
  area.on(Node.EventType.TOUCH_CANCEL, end);

  return {
    content,
    setContentHeight(h: number) {
      maxY = Math.max(0, h - height);
    },
    clear() {
      content.removeAllChildren();
      content.setPosition(0, 0, 0);
      maxY = 0;
    },
  };
}

// ---- 三种非正常态 ----

export interface AsyncBody {
  /** 显示「加载中…」 */
  loading(): void;
  /** 显示失败 + 重试按钮。**必须有重试**，否则玩家只能退出重进 */
  failed(message: string, onRetry: () => void): void;
  /** 显示空列表提示 */
  empty(text: string): void;
  /** 清掉状态提示（数据到货时调） */
  clear(): void;
}

/**
 * 加载态/失败态/空态的统一呈现。
 *
 * 失败态强制带重试是**铁律「软失败不死亡」在 UI 上的形态**：
 * 一次请求失败不该让这个玩法从此不可用。弱网下这是最常见的路径。
 */
export function asyncBody(parent: Node, width: number): AsyncBody {
  const holder = makeNode('AsyncBody', parent, width, 0);
  holder.setPosition(0, 0, 0);

  const reset = () => {
    if (holder.isValid) holder.removeAllChildren();
  };

  const centerLabel = (text: string, color: Color, y: number) => {
    const lbl = makeLabel(text, holder, { size: 18, color, align: 'center', width: width - 40 });
    lbl.node.setPosition(0, y, 0);
    return lbl;
  };

  return {
    loading() {
      reset();
      const lbl = centerLabel('加载中…', COLOR.dim, 0);
      // 呼吸动画：静止的「加载中」看不出是否卡死，动一下玩家就安心
      const op = lbl.node.addComponent(UIOpacity);
      tween(op).repeatForever(tween(op).to(0.6, { opacity: 120 }).to(0.6, { opacity: 255 })).start();
    },
    failed(message: string, onRetry: () => void) {
      reset();
      centerLabel(message || '加载失败', COLOR.danger, 22);
      tapButton(holder, '重试', 0, -26, { width: 140, height: 40 }, onRetry);
    },
    empty(text: string) {
      reset();
      centerLabel(text, COLOR.dim, 0);
    },
    clear() {
      reset();
    },
  };
}

/** 数值变化的强调，用于余额、持有量 */
export function bump(node: Node): void {
  if (!node || !node.isValid) return;
  tween(node)
    .to(0.1, { scale: new Vec3(1.18, 1.18, 1) })
    .to(0.14, { scale: new Vec3(1, 1, 1) })
    .start();
}
