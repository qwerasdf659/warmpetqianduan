/**
 * 联调自检页。
 *
 * 接入期的临时首屏：把整条链路跑一遍并把结果画在屏幕上，
 * 后端改完配置、前端改完网络层，进游戏就能看到哪一项红了。
 * 玩法界面接管首屏后，这个组件可以挂到设置里当调试入口。
 *
 * 界面全部在运行时用代码搭出来，不依赖任何 prefab 和图片资源——
 * 这样它既不占主包体积，也不会因为美术资源还没到位就跑不起来。
 */

import {
  _decorator,
  Component,
  Node,
  Label,
  RichText,
  Graphics,
  UITransform,
  ScrollView,
  Mask,
  Layout,
  Color,
  Size,
  view,
  screen,
} from 'cc';
import { getBaseUrl, MOCK_LOGIN_TAG } from '../net/config';
import { CHECKS, runAll } from '../core/selfcheck';
import { getMenuButtonRect } from '../platform/minigame';
import type { CheckResult } from '../core/selfcheck';

const { ccclass } = _decorator;

const COLOR = {
  bg: new Color(28, 26, 36, 255),
  panel: new Color(39, 36, 48, 255),
  accent: new Color(255, 159, 107, 255),
  accentDim: new Color(75, 71, 87, 255),
  title: new Color(255, 255, 255, 255),
  dim: new Color(125, 119, 145, 255),
  ok: new Color(109, 223, 156, 255),
  fail: new Color(255, 123, 123, 255),
};

/** RichText 的颜色标签用十六进制字符串 */
const HEX = {
  ok: '#6ddf9c',
  fail: '#ff7b7b',
  text: '#c9c4d6',
  dim: '#7d7791',
  title: '#ffffff',
  running: '#ffc46b',
};

const PADDING = 16;
const FOOTER_H = 72;

type Status = 'pending' | 'running' | 'ok' | 'fail';

interface Row {
  name: string;
  status: Status;
  detail: string;
  ms: number;
}

@ccclass('NetCheckView')
export class NetCheckView extends Component {
  private rows: Row[] = [];
  private running = false;

  private summaryLabel: Label | null = null;
  private bodyText: RichText | null = null;
  private buttonBg: Graphics | null = null;
  private buttonLabel: Label | null = null;

  onLoad() {
    this.resetRows();
    this.buildUi();
    this.start_();
  }

  // ---- 搭界面 ----

  private buildUi() {
    const size = view.getVisibleSize();
    const headerH = this.topInset() + 76;

    this.drawFullScreenBackground(size);
    this.buildHeader(size, headerH);
    this.buildBody(size, headerH);
    this.buildFooter(size);
  }

  /**
   * 顶部安全区。
   * 微信右上角胶囊按钮的坐标是屏幕物理像素，要按「设计分辨率 / 实际窗口」换算过来，
   * 否则在不同机型上会算偏。取不到就退回一个够用的固定值。
   */
  private topInset(): number {
    try {
      const visible = view.getVisibleSize();
      const window = screen.windowSize;
      const scale = window.height > 0 ? visible.height / window.height : 1;
      const rect = getMenuButtonRect();
      return rect.bottom * scale + 8;
    } catch (e) {
      return 60;
    }
  }

  private drawFullScreenBackground(size: Size) {
    const node = this.makeChild('Background', size.width, size.height);
    node.setPosition(0, 0);
    const g = node.addComponent(Graphics);
    g.fillColor = COLOR.bg;
    g.rect(-size.width / 2, -size.height / 2, size.width, size.height);
    g.fill();
  }

  private buildHeader(size: Size, headerH: number) {
    const top = size.height / 2;

    const title = this.makeLabel('WarmPet 联调自检', 22, COLOR.title);
    title.node.setPosition(-size.width / 2 + PADDING, top - this.topInset());
    this.anchorLeftTop(title.node);

    const env = MOCK_LOGIN_TAG ? `假登录 mock:${MOCK_LOGIN_TAG}` : '真实 wx.login';
    const sub = this.makeLabel(`${getBaseUrl().replace(/^https?:\/\//, '')}   ${env}`, 12, COLOR.dim);
    sub.node.setPosition(-size.width / 2 + PADDING, top - this.topInset() - 30);
    this.anchorLeftTop(sub.node);

    this.summaryLabel = this.makeLabel('准备中…', 15, COLOR.dim);
    this.summaryLabel.node.setPosition(-size.width / 2 + PADDING, top - this.topInset() - 52);
    this.anchorLeftTop(this.summaryLabel.node);

    // 分隔线
    const line = this.makeChild('HeaderLine', size.width, 1);
    line.setPosition(0, top - headerH);
    const g = line.addComponent(Graphics);
    g.fillColor = new Color(51, 47, 61, 255);
    g.rect(-size.width / 2, 0, size.width, 1);
    g.fill();
  }

  /**
   * 正文用一个 RichText 承载全部结果。
   *
   * 起初想给每一项做一张卡片，但那需要手动测量每段文字换行后的高度才能排版，
   * 而 Label 的尺寸要等下一帧才更新。RichText 自带按宽度折行和自动撑高，
   * 颜色标签也够表达通过/失败，用一个节点就够了。
   */
  private buildBody(size: Size, headerH: number) {
    const viewH = size.height - headerH - FOOTER_H;
    const viewW = size.width;

    const viewport = this.makeChild('Viewport', viewW, viewH);
    viewport.setPosition(0, size.height / 2 - headerH - viewH / 2);
    viewport.addComponent(Mask);

    const content = new Node('Content');
    const contentTr = content.addComponent(UITransform);
    contentTr.setContentSize(viewW, viewH);
    contentTr.setAnchorPoint(0.5, 1);
    content.setPosition(0, viewH / 2);
    content.parent = viewport;

    const layout = content.addComponent(Layout);
    layout.type = Layout.Type.VERTICAL;
    layout.resizeMode = Layout.ResizeMode.CONTAINER;
    layout.paddingTop = PADDING;
    layout.paddingBottom = PADDING;

    const textNode = new Node('Rows');
    const textTr = textNode.addComponent(UITransform);
    textTr.setContentSize(viewW - PADDING * 2, 10);
    textNode.parent = content;

    const rich = textNode.addComponent(RichText);
    rich.fontSize = 13;
    rich.lineHeight = 20;
    rich.maxWidth = viewW - PADDING * 2;
    rich.horizontalAlign = RichText.HorizontalAlign.LEFT;
    rich.string = '';
    this.bodyText = rich;

    const scroll = viewport.addComponent(ScrollView);
    scroll.content = content;
    scroll.vertical = true;
    scroll.horizontal = false;
    scroll.inertia = true;
    scroll.elastic = true;
  }

  private buildFooter(size: Size) {
    const btnW = size.width - PADDING * 2;
    const btnH = FOOTER_H - 28;

    const btn = this.makeChild('RetryButton', btnW, btnH);
    btn.setPosition(0, -size.height / 2 + FOOTER_H / 2);

    this.buttonBg = btn.addComponent(Graphics);
    this.drawButton(btnW, btnH, false);

    const label = this.makeLabel('重新自检', 16, new Color(42, 29, 22, 255));
    label.node.parent = btn;
    label.node.setPosition(0, 0);
    this.buttonLabel = label;

    btn.on(Node.EventType.TOUCH_END, () => this.start_(), this);
  }

  private drawButton(w: number, h: number, disabled: boolean) {
    const g = this.buttonBg;
    if (!g) return;
    g.clear();
    g.fillColor = disabled ? COLOR.accentDim : COLOR.accent;
    g.roundRect(-w / 2, -h / 2, w, h, h / 2);
    g.fill();
  }

  // ---- 小工具 ----

  private makeChild(name: string, width: number, height: number): Node {
    const node = new Node(name);
    const tr = node.addComponent(UITransform);
    tr.setContentSize(width, height);
    node.parent = this.node;
    return node;
  }

  private makeLabel(text: string, fontSize: number, color: Color): Label {
    const node = new Node('Label');
    node.addComponent(UITransform);
    node.parent = this.node;
    const label = node.addComponent(Label);
    label.string = text;
    label.fontSize = fontSize;
    label.lineHeight = fontSize + 4;
    label.color = color;
    label.horizontalAlign = Label.HorizontalAlign.LEFT;
    label.verticalAlign = Label.VerticalAlign.TOP;
    return label;
  }

  private anchorLeftTop(node: Node) {
    const tr = node.getComponent(UITransform);
    if (tr) tr.setAnchorPoint(0, 1);
  }

  // ---- 跑自检 ----

  private resetRows() {
    this.rows = CHECKS.map((c) => ({ name: c.name, status: 'pending' as Status, detail: '', ms: 0 }));
  }

  private start_() {
    if (this.running) return;
    this.running = true;
    this.resetRows();
    this.rows[0].status = 'running';
    this.refresh();

    runAll((index: number, result: CheckResult) => {
      this.rows[index] = {
        name: result.name,
        status: result.ok ? 'ok' : 'fail',
        detail: result.detail,
        ms: result.ms,
      };
      if (this.rows[index + 1]) this.rows[index + 1].status = 'running';
      this.refresh();
    }).then(() => {
      this.running = false;
      this.refresh();
    });
  }

  private refresh() {
    const ok = this.rows.filter((r) => r.status === 'ok').length;
    const fail = this.rows.filter((r) => r.status === 'fail').length;

    if (this.summaryLabel) {
      this.summaryLabel.string = `${ok} 通过 / ${fail} 失败 / 共 ${this.rows.length} 项`;
      this.summaryLabel.color = fail > 0 ? COLOR.fail : ok === this.rows.length ? COLOR.ok : COLOR.dim;
    }

    if (this.bodyText) {
      this.bodyText.string = this.rows.map((r, i) => this.renderRow(r, i)).join('\n');
    }

    if (this.buttonLabel) {
      this.buttonLabel.string = this.running ? '自检进行中…' : '重新自检';
      this.buttonLabel.color = this.running ? COLOR.dim : new Color(42, 29, 22, 255);
    }
    const size = view.getVisibleSize();
    this.drawButton(size.width - PADDING * 2, FOOTER_H - 28, this.running);
  }

  private renderRow(row: Row, index: number): string {
    const mark =
      row.status === 'ok' ? '✓' : row.status === 'fail' ? '✕' : row.status === 'running' ? '…' : '·';
    const markColor =
      row.status === 'ok'
        ? HEX.ok
        : row.status === 'fail'
          ? HEX.fail
          : row.status === 'running'
            ? HEX.running
            : HEX.dim;

    const head = `<color=${markColor}>${mark}</color> <color=${HEX.title}>${index + 1}. ${row.name}</color>`;
    const cost = row.ms ? ` <color=${HEX.dim}>${row.ms}ms</color>` : '';
    if (!row.detail) return `${head}${cost}\n`;

    const detailColor = row.status === 'fail' ? HEX.fail : HEX.text;
    return `${head}${cost}\n<color=${detailColor}>    ${row.detail}</color>\n`;
  }
}
