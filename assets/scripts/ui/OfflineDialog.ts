/**
 * 离线收益弹窗。
 *
 * 冷启动时如果 /pet/offline 预览有可领的收益就弹出来。
 * 两条来自对接文档的硬性要求：
 *   - claimableCoin < 1 时领取按钮必须禁用（服务端会 400）
 *   - elapsedSec 超过封顶时长要提示玩家「已经满了，快来领」
 */

import { Node, Label, Graphics, BlockInputEvents, Color, view } from 'cc';
import { COLOR, makeNode, makeGraphics, makeLabel, fillRoundRect, floatText, pop } from './widgets';
import { claimOffline } from '../core/actions';
import { showError } from './toast';
import store from '../core/store';
import type { OfflineView } from '../net/types';

const PANEL_W = 560;
const PANEL_H = 380;

export class OfflineDialog {
  private root: Node;
  private claiming = false;

  /** 领取成功后要把按钮重画成禁用态，所以留着这几个引用 */
  private gfx: Graphics | null = null;
  private btnLabel: Label | null = null;
  private btnRect = { x: 0, y: 0, w: 0, h: 0 };

  static show(parent: Node, onClosed?: () => void): OfflineDialog | null {
    const offline = store.offline;
    if (!offline) return null;
    return new OfflineDialog(parent, offline, onClosed);
  }

  private constructor(
    parent: Node,
    private offline: OfflineView,
    private onClosed?: () => void,
  ) {
    const size = view.getVisibleSize();
    this.root = makeNode('OfflineDialog', parent, size.width, size.height);
    // 挡住底层界面的点击，否则玩家能隔着弹窗点到互动按钮
    this.root.addComponent(BlockInputEvents);

    this.build(size.width, size.height);
  }

  private build(screenW: number, screenH: number) {
    const claimable = this.offline.claimableCoin;
    const canClaim = claimable >= 1;
    const capped = this.offline.elapsedSec > this.offline.maxHours * 3600;

    // ---- 先画所有图形 ----
    const g = makeGraphics('Gfx', this.root);
    this.gfx = g;

    g.fillColor = new Color(0, 0, 0, 170);
    g.rect(-screenW / 2, -screenH / 2, screenW, screenH);
    g.fill();

    fillRoundRect(g, -PANEL_W / 2, -PANEL_H / 2, PANEL_W, PANEL_H, 24, COLOR.panel);

    const btnW = 320;
    const btnH = 76;
    const btnY = -PANEL_H / 2 + 44;
    this.btnRect = { x: -btnW / 2, y: btnY, w: btnW, h: btnH };
    fillRoundRect(g, -btnW / 2, btnY, btnW, btnH, btnH / 2, canClaim ? COLOR.accent : COLOR.disabled);

    // ---- 再挂所有文字 ----
    const top = PANEL_H / 2;

    makeLabel('离线收益', this.root, { size: 30, color: COLOR.title, align: 'center', bold: true })
      .node.setPosition(0, top - 56);

    const hours = Math.floor(this.offline.elapsedSec / 3600);
    const minutes = Math.floor((this.offline.elapsedSec % 3600) / 60);
    const awayText = hours > 0 ? `${hours} 小时 ${minutes} 分钟` : `${minutes} 分钟`;

    makeLabel(`你离开了 ${awayText}`, this.root, { size: 20, color: COLOR.text, align: 'center' })
      .node.setPosition(0, top - 104);

    const coinLabel = makeLabel(`+${claimable}`, this.root, {
      size: 64,
      color: COLOR.coin,
      align: 'center',
      bold: true,
    });
    coinLabel.node.setPosition(0, top - 178);
    makeLabel('游戏币', this.root, { size: 18, color: COLOR.dim, align: 'center' })
      .node.setPosition(0, top - 222);

    // 时薪构成写出来，让玩家看得见「升级和布置家园能提高收益」
    const rate = this.offline.coinPerHour.toFixed(1);
    const bonus = this.offline.comfortFactor > 0
      ? `，家园加成 +${Math.round(this.offline.comfortFactor * 100)}%`
      : '';
    makeLabel(`时薪 ${rate} 币${bonus}`, this.root, { size: 17, color: COLOR.dim, align: 'center' })
      .node.setPosition(0, top - 258);

    if (capped) {
      makeLabel(
        `已达 ${this.offline.maxHours} 小时上限，超出部分不再累积`,
        this.root,
        { size: 17, color: COLOR.warn, align: 'center' },
      ).node.setPosition(0, top - 290);
    }

    const btnLabel = makeLabel(canClaim ? '领取' : '暂无可领取', this.root, {
      size: 24,
      color: canClaim ? COLOR.accentText : COLOR.dim,
      align: 'center',
      bold: true,
    });
    btnLabel.node.setPosition(0, btnY + btnH / 2);
    this.btnLabel = btnLabel;

    // ---- 交互 ----
    const btnHit = makeNode('ClaimHit', this.root, btnW, btnH);
    btnHit.setPosition(0, btnY + btnH / 2);
    if (canClaim) {
      btnHit.on(Node.EventType.TOUCH_END, () => this.claim(), this);
    }

    const closeHit = makeNode('CloseHit', this.root, 88, 88);
    closeHit.setPosition(PANEL_W / 2 - 40, top - 40);
    closeHit.on(Node.EventType.TOUCH_END, () => this.close(), this);
    makeLabel('✕', this.root, { size: 26, color: COLOR.dim, align: 'center' })
      .node.setPosition(PANEL_W / 2 - 40, top - 40);

    pop(this.root, 1.04);
  }

  private async claim() {
    const btnLabel = this.btnLabel;
    if (this.claiming || !btnLabel) return;
    this.claiming = true;
    btnLabel.string = '领取中…';

    const res = await claimOffline();
    if (!this.root || !this.root.isValid) return;

    if (!res.ok) {
      this.claiming = false;
      btnLabel.string = '领取';
      showError(res.error);
      return;
    }

    floatText(this.root, `+${res.data.gained} 币`, COLOR.coin, 40);
    btnLabel.string = '已领取';
    btnLabel.color = COLOR.dim;

    // 重画成禁用态，避免玩家以为还能再点一次
    const r = this.btnRect;
    if (this.gfx) fillRoundRect(this.gfx, r.x, r.y, r.w, r.h, r.h / 2, COLOR.disabled);

    this.scheduleClose(900);
  }

  private scheduleClose(delayMs: number) {
    setTimeout(() => this.close(), delayMs);
  }

  private close() {
    if (!this.root || !this.root.isValid) return;
    this.root.destroy();
    if (this.onClosed) this.onClosed();
  }
}
