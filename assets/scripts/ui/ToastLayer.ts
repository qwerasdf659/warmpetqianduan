/**
 * 引擎内自绘 toast。
 *
 * 为什么要这一层：`platform/minigame.showToast` 在**没有 wx 的环境里只 console.log**，
 * 而开发期我们一直跑编辑器预览。于是「点了分区 → 只 toast → 屏幕毫无变化」，
 * 症状和「按钮坏了」完全一样，实测被误判过（规则 `spine-2d-pet`：静默失败 = 设计缺陷）。
 *
 * 真机上 wx.showToast 是原生层、盖在 canvas 之上，观感更好，所以那边继续用它；
 * 这一层只兜住「没有 wx」的环境。挂载由 toast.ts 统一调度，业务代码不直接碰。
 *
 * 层级：挂在 Canvas 下最后一个子节点，永远在最上面；不吃触摸（不加 contentSize 的
 * 命中依赖，也不注册任何 TOUCH 事件），所以不会挡住底下的按钮。
 */

import { _decorator, Component, Node, Label, UIOpacity, Layers, UITransform, view, tween } from 'cc';
import { makeNode, makeGraphics, makeLabel, fillRoundRect, COLOR } from './widgets';

const { ccclass } = _decorator;

/** 同屏最多几条，超出就把最旧的挤掉——连点时不该堆成一面墙 */
const MAX_ROWS = 3;
const ROW_GAP = 8;
const PAD_X = 20;
const PAD_Y = 12;
const FONT = 20;
const SHOW_SEC = 2;
const FADE_SEC = 0.25;
/** 底部起始高度：抬到接近屏幕中部，避免被合规块和互动按钮压住 */
const BOTTOM_RATIO = 0.28;

@ccclass('ToastLayer')
export class ToastLayer extends Component {
  /** 单例：整个游戏只需要一层，换界面时 Main 会 removeAllChildren，所以要能重挂 */
  private static inst: ToastLayer | null = null;

  private rows: Node[] = [];

  /**
   * 取（或重建）toast 层。宿主节点通常是 Canvas 下的 Main 节点。
   *
   * 界面切换会 `removeAllChildren()` 把这一层一起删掉，所以每次都校验 isValid，
   * 失效就重建——否则第一次换界面之后 toast 就再也不出现了。
   */
  public static ensure(parent: Node): ToastLayer {
    const cur = ToastLayer.inst;
    if (cur && cur.node && cur.node.isValid && cur.node.parent === parent) {
      // 始终排到最后一个兄弟 → 渲染在最上层（规则：渲染顺序 = 兄弟节点次序）
      cur.node.setSiblingIndex(parent.children.length - 1);
      return cur;
    }
    const host = new Node('ToastLayer');
    host.layer = Layers.Enum.UI_2D;
    host.addComponent(UITransform);
    host.parent = parent;
    const comp = host.addComponent(ToastLayer);
    ToastLayer.inst = comp;
    return comp;
  }

  public static show(parent: Node, text: string) {
    ToastLayer.ensure(parent).push(text);
  }

  onDestroy() {
    if (ToastLayer.inst === this) ToastLayer.inst = null;
  }

  private push(text: string) {
    const msg = String(text || '').trim();
    if (!msg) return;

    const size = view.getVisibleSize();
    // 宽度按字数估：中文字宽≈字号，英文≈0.6 倍，取偏大的一档保证不裁字
    const estW = Math.min(size.width - 48, msg.length * FONT * 0.92 + PAD_X * 2);
    const rowH = FONT + 6 + PAD_Y * 2;

    const row = makeNode('Toast', this.node, estW, rowH);
    // 先 Graphics 再 Label：反过来会被底板盖住（规则：渲染顺序 = 兄弟次序）
    const g = makeGraphics('bg', row);
    fillRoundRect(g, -estW / 2, -rowH / 2, estW, rowH, rowH / 2, COLOR.title);

    const label = makeLabel(msg, row, {
      size: FONT,
      color: COLOR.accentText,
      align: 'center',
      width: estW - PAD_X * 2,
    });
    label.node.setPosition(0, 0, 0);
    // makeLabel 传了 width 会切到 RESIZE_HEIGHT + 换行，居中锚点已由它按 align 设好

    const opacity = row.addComponent(UIOpacity);
    opacity.opacity = 0;

    this.rows.push(row);
    while (this.rows.length > MAX_ROWS) this.dropOldest();
    this.relayout(rowH);

    // 上浮 + 淡入 → 停留 → 淡出 → 自销毁。忘了回收的话连点会堆节点
    tween(opacity)
      .to(FADE_SEC, { opacity: 255 })
      .delay(SHOW_SEC)
      .to(FADE_SEC, { opacity: 0 })
      .call(() => this.remove(row))
      .start();
  }

  private dropOldest() {
    const old = this.rows.shift();
    if (old && old.isValid) old.destroy();
  }

  private remove(row: Node) {
    const i = this.rows.indexOf(row);
    if (i >= 0) this.rows.splice(i, 1);
    if (row.isValid) row.destroy();
  }

  /** 最新一条在最下面，旧的往上顶，读起来和聊天列表一致 */
  private relayout(rowH: number) {
    const size = view.getVisibleSize();
    const baseY = -size.height / 2 + size.height * BOTTOM_RATIO;
    const n = this.rows.length;
    this.rows.forEach((row, i) => {
      if (!row.isValid) return;
      const fromBottom = n - 1 - i;
      row.setPosition(0, baseY + fromBottom * (rowH + ROW_GAP), 0);
    });
  }
}
