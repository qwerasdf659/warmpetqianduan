/**
 * 洗浴间：洗澡互动 + 冷却倒计时。对应地图分区 `bath`，接口 `POST /pet/bath`。
 *
 * 这是最小的一个玩法面板，但把「不信任客户端时钟」演示得最完整：
 * 冷却锚点存的是**服务端时间戳**（`core/cooldown` 用 `serverNow()`），
 * 玩家改系统时间不会让按钮提前亮；就算亮了，后端也会回 429，
 * 那时用错误里的秒数把本地倒计时校正回去（`startFromError`）。
 *
 * 属性数值一律读 `store.petView`（服务端值 + 本地衰减预测），
 * 预测只用于视觉平滑，不参与「能不能洗」的判定。
 */

import { _decorator, Component, Node, Label } from 'cc';
import { COLOR, STAT_COLOR, makeLabel, floatText } from './widgets';
import { ModalPanel } from './ModalPanel';
import { tapButton, miniBar } from './panelKit';
import type { TapButton } from './panelKit';
import { interact } from '../core/actions';
import * as cooldown from '../core/cooldown';
import store from '../core/store';
import { toast, gainedText } from './toast';

const { ccclass } = _decorator;

@ccclass('BathPanel')
export class BathPanel extends Component {
  private modal: ModalPanel | null = null;
  private cleanLabel: Label | null = null;
  private hintLabel: Label | null = null;
  private btn: TapButton | null = null;
  private busy = false;
  /** 上一帧显示的秒数，变了才刷文案（避免每帧改 Label 触发重排） */
  private lastSec = -1;
  /** 进度条每次重画都要新建节点，所以只在清洁度整数变化时重建 */
  private lastClean = -1;
  private barHost: Node | null = null;

  public static open(parent: Node): BathPanel {
    const host = new Node('BathPanel');
    host.parent = parent;
    const comp = host.addComponent(BathPanel);
    comp.build();
    return comp;
  }

  private build() {
    this.modal = ModalPanel.open(this.node, '洗浴间 · 洗澡');
    const body = this.modal.body;
    if (!body) return;

    const w = this.modal.bodyW;

    const tip = makeLabel(
      '泡个澡能把清洁度拉满，心情也会跟着好起来。\n洗完需要休息一会儿才能再洗。',
      body,
      { size: 17, color: COLOR.text, align: 'center', width: w - 40 },
    );
    tip.node.setPosition(0, this.modal.bodyH / 2 - 70, 0);

    this.cleanLabel = makeLabel('', body, { size: 20, color: COLOR.title, align: 'center', bold: true });
    this.cleanLabel.node.setPosition(0, 40, 0);

    // 进度条挂在独立子节点上，重画时整体清掉，不影响其它元素
    this.barHost = new Node('BarHost');
    this.barHost.parent = body;

    this.hintLabel = makeLabel('', body, { size: 15, color: COLOR.dim, align: 'center', width: w - 40 });
    this.hintLabel.node.setPosition(0, -30, 0);

    this.btn = tapButton(body, '洗澡', 0, -100, { width: 200, height: 52 }, () => this.onBath());

    this.sync();
  }

  update() {
    this.sync();
  }

  /**
   * 每帧同步，但只在「看得见的变化」发生时改 UI。
   * 清洁度是每小时掉几点的速度，真正每秒都在变的只有冷却秒数。
   */
  private sync() {
    const pet = store.petView;
    if (!pet) return;

    const clean = Math.round(pet.cleanliness);
    if (clean !== this.lastClean) {
      this.lastClean = clean;
      if (this.cleanLabel) this.cleanLabel.string = `清洁度 ${clean} / 100`;
      this.redrawBar(clean);
    }

    const remain = cooldown.remainMs(store.activePetId, 'bath');
    const sec = Math.ceil(remain / 1000);
    if (sec !== this.lastSec) {
      this.lastSec = sec;
      this.applyButton(sec, clean);
    }
  }

  private redrawBar(clean: number) {
    const host = this.barHost;
    const modal = this.modal;
    if (!host || !host.isValid || !modal) return;
    host.removeAllChildren();
    const ratio = clean / 100;
    miniBar(host, modal.bodyW - 60, 12, ratio, ratio <= 0.2 ? COLOR.danger : STAT_COLOR.cleanliness);
  }

  /**
   * 按钮态。三种情况都要**说清楚原因**，不许出现「点了没反应」：
   * 忙 → 「…」；冷却中 → 剩余秒数；已经很干净 → 也允许洗，只是提示收益有限。
   */
  private applyButton(sec: number, clean: number) {
    const btn = this.btn;
    if (!btn) return;

    if (this.busy) {
      btn.update('洗澡中…', true, '正在洗，稍等一下');
      return;
    }
    if (sec > 0) {
      btn.update(`休息中 ${sec}s`, true, `刚洗过澡，还需 ${sec} 秒`);
      return;
    }
    btn.update(clean >= 100 ? '再洗一次' : '洗澡', false, '');
  }

  private async onBath() {
    if (this.busy) return;
    // 本地冷却先拦一道，避免明知会 429 还发请求（服务端仍是最终裁决者）
    if (!cooldown.isReady(store.activePetId, 'bath')) {
      toast(`刚洗过澡，还需 ${cooldown.remainText(store.activePetId, 'bath')}`);
      return;
    }

    this.busy = true;
    this.lastSec = -1;

    const res = await interact('bath');

    this.busy = false;
    this.lastSec = -1;
    this.lastClean = -1;

    if (!this.node.isValid) return;
    if (!res.ok) {
      // 撞到 429 时 actions 已经用错误里的秒数校正过本地冷却，这里只提示
      toast((res.error && res.error.message) || '洗澡失败，请稍后再试');
      return;
    }

    const data = res.data!;
    const body = this.modal && this.modal.body;
    const gained = gainedText(data.gained);
    if (body && gained) floatText(body, gained, COLOR.ok, -60);
    // 撞每日上限时实发少于标称值，要说清楚，否则玩家以为掉了奖励
    if (data.capped) toast('今日收益已达上限，明天再来');
    if (data.levelUp) toast('升级啦！');
  }
}
