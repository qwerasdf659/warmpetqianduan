/**
 * 育婴室：扭蛋。对应地图分区 `nursery`，接口 `/gacha`。
 *
 * **概率公示是合规硬要求**，不是可选装饰：odds 必须能在界面上看到。
 * 服务端给的 odds 就是它实际用的那份权重表，直接渲染，不做任何折算。
 *
 * 三条纪律的落点：
 * - **服务端权威**：抽奖结果、保底进度、余额全部取响应值。
 *   本地不猜「这次该出稀有了」，也不本地扣币。
 * - **幂等**：`drawGacha` 内部带 bizId；十连期间按钮置忙。响应里 `duplicated`
 *   为 true 表示这是回放，**不再播一次开奖动画**，否则玩家会以为抽了两次。
 * - **软失败不死亡**：目录加载失败给重试；抽奖失败只提示，池子还能继续抽。
 */

import { _decorator, Component, Node, Label } from 'cc';
import { COLOR, makeLabel, floatText } from './widgets';
import { ModalPanel } from './ModalPanel';
import {
  walletBar,
  priceText,
  affordable,
  tapButton,
  listRow,
  scrollList,
  asyncBody,
  miniBar,
  ROW_GAP,
} from './panelKit';
import type { ScrollList, AsyncBody, TapButton } from './panelKit';
import api from '../net/api';
import { formatOdds, pityText } from '../net/api/gacha';
import { drawGacha } from '../core/actions';
import store from '../core/store';
import { toast, modal } from './toast';
import { toApiError } from '../net/errors';
import type { GachaPool, GachaPrize } from '../net/types';

const { ccclass } = _decorator;

const ROW_H = 150;

@ccclass('GachaPanel')
export class GachaPanel extends Component {
  private modal: ModalPanel | null = null;
  private list: ScrollList | null = null;
  private body: AsyncBody | null = null;
  private refreshWallet: (() => void) | null = null;
  private pools: GachaPool[] = [];
  private pityLabels: Record<string, Label> = {};
  private oneButtons: Record<string, TapButton> = {};
  private tenButtons: Record<string, TapButton> = {};

  public static open(parent: Node): GachaPanel {
    const host = new Node('GachaPanel');
    host.parent = parent;
    const comp = host.addComponent(GachaPanel);
    comp.build();
    return comp;
  }

  private build() {
    this.modal = ModalPanel.open(this.node, '育婴室 · 扭蛋');
    const body = this.modal.body;
    if (!body) return;

    this.refreshWallet = walletBar(body, this.modal.bodyW - 8, this.modal.bodyH / 2 - 26);
    this.body = asyncBody(body, this.modal.bodyW);
    this.list = scrollList(body, this.modal.bodyW, this.modal.bodyH - 60, -30);

    this.load();
  }

  onDestroy() {
    this.pityLabels = {};
    this.oneButtons = {};
    this.tenButtons = {};
  }

  private load() {
    if (!this.body || !this.list) return;
    this.list.clear();
    this.body.loading();

    api.gacha
      .info()
      .then((view) => {
        if (!this.node.isValid || !this.body) return;
        this.body.clear();
        if (view.wallet) store.applyWallet(view.wallet);
        if (this.refreshWallet) this.refreshWallet();

        this.pools = view.pools || [];
        if (!this.pools.length) {
          this.body.empty('暂时没有开放的扭蛋池');
          return;
        }
        this.renderPools();
      })
      .catch((err) => {
        if (!this.node.isValid || !this.body) return;
        this.body.failed(toApiError(err).message, () => this.load());
      });
  }

  private renderPools() {
    const list = this.list;
    const modal = this.modal;
    if (!list || !modal) return;

    const areaH = modal.bodyH - 60;
    let y = areaH / 2 - ROW_H / 2;
    this.pools.forEach((pool) => {
      this.renderPool(list.content, pool, modal.bodyW, y);
      y -= ROW_H + ROW_GAP;
    });
    list.setContentHeight(this.pools.length * (ROW_H + ROW_GAP));
  }

  private renderPool(parent: Node, pool: GachaPool, w: number, y: number) {
    const rowW = w - 8;
    const row = listRow(parent, rowW, y, ROW_H, pool.name, `单抽 ${priceText(pool.cost, pool.pool)} · 十连 ${priceText(pool.costTen, pool.pool)}`);

    // 保底进度：pity === 0 表示该池不启用保底，此时 pityLeft 是 null，别显示进度条
    const pity = makeLabel(pityText(pool), row, { size: 14, color: COLOR.warn });
    pity.node.setPosition(-rowW / 2 + 14, ROW_H / 2 - 70, 0);
    this.pityLabels[pool.key] = pity;

    if (pool.pity > 0 && pool.pityLeft !== null) {
      const done = pool.pity - pool.pityLeft;
      miniBar(row, rowW - 28, ROW_H / 2 - 86, done / pool.pity, COLOR.warn);
    }

    // 概率公示入口。合规要求「能看到」，放在行内做成可点的一行说明
    tapButton(
      row,
      '概率公示',
      -rowW / 2 + 60,
      -ROW_H / 2 + 24,
      { width: 104, height: 32, primary: false },
      () => this.showOdds(pool),
    );

    const btnW = 84;
    this.oneButtons[pool.key] = tapButton(
      row,
      '单抽',
      rowW / 2 - btnW - 20,
      -ROW_H / 2 + 24,
      { width: btnW, height: 36 },
      () => this.onDraw(pool, 1),
    );
    this.tenButtons[pool.key] = tapButton(
      row,
      '十连',
      rowW / 2 - btnW / 2 - 8,
      -ROW_H / 2 + 24,
      { width: btnW, height: 36 },
      () => this.onDraw(pool, 10),
    );

    this.syncPool(pool.key);
  }

  /** 余额不足只置灰 + 说明原因，最终裁决仍在服务端 */
  private syncPool(key: string) {
    const pool = this.pools.filter((p) => p.key === key)[0];
    if (!pool) return;

    const shortage = pool.pool === 'marketing' ? '积分不够' : '金币不够';
    const one = this.oneButtons[key];
    if (one) one.update('单抽', !affordable(pool.cost, pool.pool), shortage);
    const ten = this.tenButtons[key];
    if (ten) ten.update('十连', !affordable(pool.costTen, pool.pool), shortage);

    const pity = this.pityLabels[key];
    if (pity && pity.node.isValid) pity.string = pityText(pool);
  }

  /** 概率公示。合规内容，照抄服务端返回，不做四舍五入以外的加工 */
  private showOdds(pool: GachaPool) {
    const lines = formatOdds(pool.odds).map((o) => `${o.rare ? '★ ' : ''}${o.name}  ${o.percentText}`);
    const extra = pool.pity > 0 ? `\n保底：每 ${pool.pity} 抽必出稀有` : '';
    const dupe = pool.dupeCoin > 0 ? `\n重复收藏品折算 ${pool.dupeCoin} 金币` : '';
    modal(`${pool.name} · 概率公示`, `${lines.join('\n')}${extra}${dupe}`);
  }

  private async onDraw(pool: GachaPool, times: 1 | 10) {
    const cost = times === 1 ? pool.cost : pool.costTen;
    const ok = await modal('确认抽奖', `${pool.name} ${times === 1 ? '单抽' : '十连'}\n花费 ${priceText(cost, pool.pool)}`, true);
    if (!ok || !this.node.isValid) return;

    const res = await drawGacha(pool.key, times);
    if (!this.node.isValid) return;

    if (!res.ok) {
      toast((res.error && res.error.message) || '抽奖失败，请稍后再试');
      return;
    }

    const data = res.data!;
    // 保底进度来自响应，不本地推算
    pool.pityLeft = pool.pity > 0 ? Math.max(0, pool.pity - data.pity) : null;
    if (this.refreshWallet) this.refreshWallet();
    this.syncPool(pool.key);

    if (data.duplicated) {
      // 幂等回放：这笔早就结算过了，再播一次开奖会让玩家以为抽了两次
      toast('这次抽奖已经结算过了，奖励已在账上');
      return;
    }
    this.showPrizes(pool, data.prizes || []);
  }

  /**
   * 开奖结果。稀有档单独标星并飘字强调 —— 十连里那一两个稀有
   * 如果和普通奖混在一列文字里，玩家根本注意不到。
   */
  private showPrizes(pool: GachaPool, prizes: GachaPrize[]) {
    if (!prizes.length) {
      toast('没有抽到东西，奖励已按保底发放');
      return;
    }

    const lines = prizes.map((p) => {
      const qty = p.qty > 1 ? ` ×${p.qty}` : '';
      const conv = p.converted ? `（重复，折算 ${p.amount} 金币）` : '';
      return `${p.rare ? '★ ' : ''}${p.name}${qty}${conv}`;
    });
    modal('开奖结果', lines.join('\n'));

    const body = this.modal && this.modal.body;
    const rare = prizes.filter((p) => p.rare).length;
    if (body && rare > 0) floatText(body, `稀有 ×${rare}！`, COLOR.warn, 0);
  }
}
