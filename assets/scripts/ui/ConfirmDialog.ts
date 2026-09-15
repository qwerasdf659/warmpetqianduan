/**
 * 引擎内自绘的确认框，替代没有 wx 时失效的 wx.showModal。
 *
 * 和 ToastLayer 同一个理由：`showModal` 在浏览器里只 console.log 然后 **resolve(true)**，
 * 于是预览里「花 300 币确认购买」这类二次确认会被静默当成「玩家点了确定」——
 * 比没提示更危险。这里给一个真的能点的确认框。
 *
 * 真机上仍走原生 wx.showModal（观感更好、能盖住 canvas），调度在 toast.ts。
 */

import { _decorator, Component, Node, Graphics, Color, UITransform, view, tween, Vec3, Layers } from 'cc';
import { makeNode, makeLabel, fillRoundRectRim, softShadow, COLOR } from './widgets';

const { ccclass } = _decorator;

const PANEL_W_RATIO = 0.78;
const BTN_H = 46;
const BTN_GAP = 12;
const PAD = 20;

@ccclass('ConfirmDialog')
export class ConfirmDialog extends Component {
  private resolve: ((ok: boolean) => void) | null = null;
  /** 防止重复 resolve：遮罩点击和按钮点击可能在同一帧都触发 */
  private settled = false;

  /**
   * 弹出确认框。showCancel 为 false 时只有「知道了」，语义等同提示框。
   * 一定会 resolve，不会悬着——上层常常 `await modal(...)` 后接着做事。
   */
  public static show(parent: Node, title: string, content: string, showCancel: boolean): Promise<boolean> {
    const hostNode = new Node('ConfirmDialog');
    hostNode.layer = Layers.Enum.UI_2D;
    hostNode.addComponent(UITransform);
    hostNode.parent = parent;
    const comp = hostNode.addComponent(ConfirmDialog);
    return new Promise<boolean>((res) => {
      comp.resolve = res;
      comp.build(title, content, showCancel);
    });
  }

  private build(title: string, content: string, showCancel: boolean) {
    const size = view.getVisibleSize();
    const pw = size.width * PANEL_W_RATIO;
    const bodyW = pw - PAD * 2;

    // 遮罩：吃掉点击，防止穿透到底下的界面。点遮罩 = 取消（有取消键时才允许）
    const mask = makeNode('Mask', this.node, size.width, size.height);
    const mg = mask.addComponent(Graphics);
    mg.fillColor = new Color(0, 0, 0, 150);
    mg.rect(-size.width / 2, -size.height / 2, size.width, size.height);
    mg.fill();
    mask.on(Node.EventType.TOUCH_END, () => {
      if (showCancel) this.finish(false);
    }, this);

    // 先量文字高度，再按内容撑面板——写死高度会让长文案溢出面板外
    const titleLabel = makeLabel(title, this.node, {
      size: 22, color: COLOR.title, align: 'center', bold: true, width: bodyW,
    });
    const bodyLabel = makeLabel(content, this.node, {
      size: 19, color: COLOR.text, align: 'center', width: bodyW,
    });
    const titleH = titleLabel.node.getComponent(UITransform)!.height;
    const bodyH = bodyLabel.node.getComponent(UITransform)!.height;
    const ph = PAD * 2 + titleH + 10 + bodyH + 16 + BTN_H;

    const panel = makeNode('Panel', this.node, pw, ph);
    const pg = panel.addComponent(Graphics);
    softShadow(pg, -pw / 2, -ph / 2, pw, ph, 22, 10);
    fillRoundRectRim(pg, -pw / 2, -ph / 2, pw, ph, 22, COLOR.panel, 3);
    panel.on(Node.EventType.TOUCH_END, () => {}, this);

    // 文字先建后挂：Label 要在面板底板之上，所以重挂一次父节点（兄弟次序 = 层级）
    titleLabel.node.parent = panel;
    bodyLabel.node.parent = panel;
    titleLabel.node.setPosition(0, ph / 2 - PAD - titleH / 2, 0);
    bodyLabel.node.setPosition(0, ph / 2 - PAD - titleH - 10 - bodyH / 2, 0);

    const btnY = -ph / 2 + PAD + BTN_H / 2;
    if (showCancel) {
      const bw = (pw - PAD * 2 - BTN_GAP) / 2;
      this.makeButton(panel, '取消', -bw / 2 - BTN_GAP / 2, btnY, bw, false, () => this.finish(false));
      this.makeButton(panel, '确定', bw / 2 + BTN_GAP / 2, btnY, bw, true, () => this.finish(true));
    } else {
      this.makeButton(panel, '知道了', 0, btnY, pw - PAD * 2, true, () => this.finish(true));
    }

    panel.setScale(0.88, 0.88, 1);
    tween(panel).to(0.15, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
  }

  private makeButton(parent: Node, text: string, x: number, y: number, w: number, primary: boolean, onTap: () => void) {
    const btn = makeNode('Btn', parent, w, BTN_H);
    btn.setPosition(x, y, 0);
    const g = btn.addComponent(Graphics);
    fillRoundRectRim(g, -w / 2, -BTN_H / 2, w, BTN_H, BTN_H / 2, primary ? COLOR.accent : COLOR.panelLight, 3);
    const lbl = makeLabel(text, btn, {
      size: 20, color: primary ? COLOR.accentText : COLOR.text, align: 'center', bold: true,
    });
    lbl.node.setPosition(0, 0, 0);
    btn.on(Node.EventType.TOUCH_END, onTap, this);
  }

  /** 只 resolve 一次，然后销毁自己 */
  private finish(ok: boolean) {
    if (this.settled) return;
    this.settled = true;
    const cb = this.resolve;
    this.resolve = null;
    if (this.node.isValid) this.node.destroy();
    if (cb) cb(ok);
  }
}
