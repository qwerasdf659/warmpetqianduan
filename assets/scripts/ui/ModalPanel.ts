/**
 * 通用弹窗容器：半透明遮罩 + 圆角面板 + 标题 + 关闭按钮。
 *
 * 装修商店、活动面板、设置页都长这个样子，所以抽出来共用：
 * 各面板只管往 body 里塞内容，遮罩/标题栏/关闭/点外部关闭都由这里处理。
 *
 * 用法：
 *   const modal = ModalPanel.open(parentNode, '装修商店');
 *   // 往 modal.body 下加内容，坐标以面板中心为原点
 */

import { _decorator, Component, Node, Graphics, Color, UITransform, view, tween, Vec3 } from 'cc';
import { makeNode, makeLabel, fillRoundRectRim, softShadow, COLOR } from './widgets';

const { ccclass } = _decorator;

/** 面板占屏比例：留出边距，让遮罩可见，暗示「点外面能关」 */
const PANEL_W_RATIO = 0.9;
const PANEL_H_RATIO = 0.76;
const TITLE_H = 56;
const CLOSE_SIZE = 40;

@ccclass('ModalPanel')
export class ModalPanel extends Component {
  /** 内容区节点：调用方把自己的元素挂到这里，原点在内容区中心 */
  public body: Node | null = null;
  /** 内容区可用尺寸，调用方排版时用 */
  public bodyW = 0;
  public bodyH = 0;
  /**
   * 关闭回调。宿主面板用它销毁自己那一层节点。
   *
   * 没有这个钩子时 close() 只销毁 Modal 节点，宿主（如 CarePanel 节点）会一直留着，
   * 结果是「关掉面板后再点同一个分区打不开」——外层还以为面板开着。
   */
  public onClose: (() => void) | null = null;

  private root: Node | null = null;

  /**
   * 打开一个弹窗，返回实例（内容自己往 body 里加）。
   *
   * `parent` 传的是**宿主面板自己的节点**（如 CarePanel 的节点），
   * 所以默认的 onClose 就是把宿主整层一起销毁——不这么做的话关掉弹窗后
   * 宿主空节点还挂着，Main 会以为面板还开着、再点同一个分区打不开。
   * 需要保留宿主的调用方（如嵌套的大图预览）自行覆盖 onClose。
   */
  public static open(parent: Node, title: string): ModalPanel {
    const host = new Node('Modal');
    host.parent = parent;
    const comp = host.addComponent(ModalPanel);
    comp.onClose = () => {
      if (parent && parent.isValid) parent.destroy();
    };
    comp.build(title);
    return comp;
  }

  private build(title: string) {
    const size = view.getVisibleSize();
    const pw = size.width * PANEL_W_RATIO;
    const ph = size.height * PANEL_H_RATIO;
    this.root = this.node;

    // 遮罩：铺满全屏，吃掉点击，防止穿透到底下的舞台/按钮
    const mask = makeNode('Mask', this.node, size.width, size.height);
    const mg = mask.addComponent(Graphics);
    mg.fillColor = new Color(0, 0, 0, 140);
    mg.rect(-size.width / 2, -size.height / 2, size.width, size.height);
    mg.fill();
    mask.on(Node.EventType.TOUCH_END, () => this.close(), this);

    // 面板本体
    const panel = makeNode('Panel', this.node, pw, ph);
    const pg = panel.addComponent(Graphics);
    softShadow(pg, -pw / 2, -ph / 2, pw, ph, 24, 10);
    fillRoundRectRim(pg, -pw / 2, -ph / 2, pw, ph, 24, COLOR.panel, 3);
    // 面板自己也要吃掉点击，否则点面板会被遮罩当成「点外面」而关闭
    panel.on(Node.EventType.TOUCH_END, () => {}, this);

    const titleLabel = makeLabel(title, panel, {
      size: 26,
      color: COLOR.title,
      align: 'center',
      bold: true,
    });
    titleLabel.node.setPosition(0, ph / 2 - TITLE_H / 2, 0);

    // 关闭按钮：右上角
    const close = makeNode('Close', panel, CLOSE_SIZE, CLOSE_SIZE);
    close.setPosition(pw / 2 - CLOSE_SIZE / 2 - 12, ph / 2 - CLOSE_SIZE / 2 - 8, 0);
    const cg = close.addComponent(Graphics);
    fillRoundRectRim(cg, -CLOSE_SIZE / 2, -CLOSE_SIZE / 2, CLOSE_SIZE, CLOSE_SIZE, CLOSE_SIZE / 2, COLOR.accent, 3);
    const cl = makeLabel('×', close, { size: 24, color: COLOR.accentText, align: 'center', bold: true });
    cl.node.setPosition(0, 0, 0);
    close.on(Node.EventType.TOUCH_END, () => this.close(), this);

    // 内容区
    const body = new Node('Body');
    body.parent = panel;
    body.addComponent(UITransform);
    this.bodyW = pw - 32;
    this.bodyH = ph - TITLE_H - 24;
    body.setPosition(0, -TITLE_H / 2, 0);
    this.body = body;

    // 弹出动画：从小放大，给点「出现」的感觉
    panel.setScale(0.86, 0.86, 1);
    tween(panel).to(0.16, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
  }

  /** 关闭。先回调再销毁，回调里通常会把宿主整层一起销毁 */
  public close() {
    const cb = this.onClose;
    this.onClose = null;
    if (this.root && this.root.isValid) this.root.destroy();
    if (cb) cb();
  }
}
