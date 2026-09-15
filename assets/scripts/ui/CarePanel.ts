/**
 * 护理室：消耗品的买与用。对应地图分区 `care`，接口 `/items/consumables`。
 *
 * 每行一件道具：名字 + 效果文案 + 持有量，右侧「买」与「用」两个按钮。
 *
 * 三条纪律的落点：
 * - **服务端权威**：属性涨幅、持有量一律取响应里的 `pet` / `left`，
 *   不本地加减。买了之后 `wallet` 也来自响应，不自己算余额。
 * - **幂等**：买/用都走 `core/actions`（内部带 bizId），按钮在请求期间置忙，
 *   所以同一笔不会提交两次；即使重复提交，后端按 bizId 回放也不会多扣。
 * - **软失败不死亡**：列表加载失败给重试；单次操作失败只 toast，界面还能继续用。
 *
 * 接口不支持批量使用（超上限的部分会被 clamp 掉、等于道具凭空消失），
 * 所以「用」是一次一份，连喂就让玩家连点 —— 见 net/api/items.ts 的注释。
 */

import { _decorator, Component, Node, Label } from 'cc';
import { COLOR, makeLabel } from './widgets';
import { ModalPanel } from './ModalPanel';
import {
  walletBar,
  priceText,
  affordable,
  tapButton,
  listRow,
  scrollList,
  asyncBody,
  ROW_GAP,
} from './panelKit';
import type { ScrollList, AsyncBody, TapButton } from './panelKit';
import api from '../net/api';
import { describeEffect } from '../net/api/items';
import { buy, useConsumable } from '../core/actions';
import store from '../core/store';
import { toast, modal } from './toast';
import { toApiError } from '../net/errors';
import type { ConsumableItem } from '../net/types';

const { ccclass } = _decorator;

const ROW_H = 92;
/** 单价超过这个数才二次确认，便宜的道具连点买不该被打断 */
const CONFIRM_ABOVE = 500;

@ccclass('CarePanel')
export class CarePanel extends Component {
  private modal: ModalPanel | null = null;
  private list: ScrollList | null = null;
  private body: AsyncBody | null = null;
  private refreshWallet: (() => void) | null = null;
  /** itemKey → 该行的持有量文案，买/用之后就地刷新，不重建整个列表 */
  private ownedLabels: Record<string, Label> = {};
  private buyButtons: Record<string, TapButton> = {};
  private useButtons: Record<string, TapButton> = {};
  private items: ConsumableItem[] = [];

  public static open(parent: Node): CarePanel {
    const host = new Node('CarePanel');
    host.parent = parent;
    const comp = host.addComponent(CarePanel);
    comp.build();
    return comp;
  }

  private build() {
    this.modal = ModalPanel.open(this.node, '护理室 · 道具');
    const body = this.modal.body;
    if (!body) return;

    const w = this.modal.bodyW;
    const h = this.modal.bodyH;

    this.refreshWallet = walletBar(body, w - 8, h / 2 - 26);
    this.body = asyncBody(body, w);
    this.list = scrollList(body, w, h - 60, -30);

    this.load();
  }

  onDestroy() {
    this.ownedLabels = {};
    this.buyButtons = {};
    this.useButtons = {};
  }

  /** 拉目录。失败一定给重试，不能停在空白（软失败不死亡） */
  private load() {
    if (!this.body || !this.list) return;
    this.list.clear();
    this.body.loading();

    api.items
      .info()
      .then((view) => {
        if (!this.node.isValid || !this.body) return;
        this.body.clear();
        // 响应顺带回传 wallet，就地同步，省一次 /wallet 请求
        if (view.wallet) store.applyWallet(view.wallet);
        if (this.refreshWallet) this.refreshWallet();

        this.items = (view.items || []).slice().sort((a, b) => a.sortOrder - b.sortOrder);
        if (!this.items.length) {
          this.body.empty('道具架空空的，稍后再来看看');
          return;
        }
        this.renderRows();
      })
      .catch((err) => {
        if (!this.node.isValid || !this.body) return;
        this.body.failed(toApiError(err).message, () => this.load());
      });
  }

  private renderRows() {
    const list = this.list;
    const modal = this.modal;
    if (!list || !modal) return;

    const w = modal.bodyW;
    const areaH = modal.bodyH - 60;
    // 内容从可视区顶部往下排（scrollList 的 content 与可视区同尺寸、锚点居中）
    let y = areaH / 2 - ROW_H / 2;

    this.items.forEach((item) => {
      this.renderRow(list.content, item, w, y);
      y -= ROW_H + ROW_GAP;
    });

    list.setContentHeight(this.items.length * (ROW_H + ROW_GAP));
  }

  private renderRow(parent: Node, item: ConsumableItem, w: number, y: number) {
    const rowW = w - 8;
    const row = listRow(parent, rowW, y, ROW_H, item.name, describeEffect(item.effect));

    // 持有量单独留引用：买/用之后只改这一行，不重建列表（重建会把滚动位置弹回顶部）
    const owned = makeLabel('', row, { size: 15, color: COLOR.text });
    owned.node.setPosition(-rowW / 2 + 14, -ROW_H / 2 + 18, 0);
    this.ownedLabels[item.key] = owned;

    const btnW = 92;
    const btnX = rowW / 2 - btnW / 2 - 12;

    this.buyButtons[item.key] = tapButton(
      row,
      `买 · ${priceText(item.price, item.pool)}`,
      btnX,
      ROW_H / 2 - 26,
      { width: btnW, height: 34 },
      () => this.onBuy(item),
    );

    this.useButtons[item.key] = tapButton(
      row,
      '用一份',
      btnX,
      -ROW_H / 2 + 24,
      { width: btnW, height: 34, primary: false },
      () => this.onUse(item),
    );

    this.syncRow(item.key);
  }

  /**
   * 刷新一行的可点状态。
   *
   * 余额判定只用来置灰按钮，真正的裁决在服务端 —— 客户端算错了顶多多一次 400，
   * 但绝不能因为本地判断「够」就把玩家的钱当成真扣了。
   */
  private syncRow(key: string) {
    const item = this.items.filter((it) => it.key === key)[0];
    if (!item) return;

    const ownedLabel = this.ownedLabels[key];
    if (ownedLabel && ownedLabel.node.isValid) {
      ownedLabel.string = item.owned > 0 ? `持有 ${item.owned}` : '还没有';
    }

    const buyBtn = this.buyButtons[key];
    if (buyBtn) {
      const ok = affordable(item.price, item.pool);
      buyBtn.update(
        `买 · ${priceText(item.price, item.pool)}`,
        !ok,
        item.pool === 'marketing' ? '积分不够' : '金币不够',
      );
    }

    const useBtn = this.useButtons[key];
    if (useBtn) {
      useBtn.update('用一份', item.owned <= 0, '还没有这件道具，先买一个吧');
    }
  }

  /** 贵的道具先二次确认，便宜的直接买 —— 每次都弹会把连点买变成折磨 */
  private async onBuy(item: ConsumableItem) {
    if (item.price >= CONFIRM_ABOVE) {
      const ok = await modal('确认购买', `${item.name}\n花费 ${priceText(item.price, item.pool)}`, true);
      if (!ok) return;
    }

    const res = await buy('consumable', item.key, 1);
    if (!this.node.isValid) return;

    if (!res.ok) {
      toast((res.error && res.error.message) || '购买失败，请稍后再试');
      return;
    }

    // qty 是**购买后的持有量**，不是本次买了几件（见 types.ts BuyResult）
    const data = res.data!;
    item.owned = data.qty;
    if (this.refreshWallet) this.refreshWallet();
    this.syncRow(item.key);
    // duplicated 表示这是幂等回放，不该再报一次「购买成功」骗玩家以为买了两次
    toast(data.duplicated ? `${item.name} 已在背包里` : `买到了 ${item.name}`);
  }

  private async onUse(item: ConsumableItem) {
    const res = await useConsumable(item.key);
    if (!this.node.isValid) return;

    if (!res.ok) {
      toast((res.error && res.error.message) || '使用失败，请稍后再试');
      return;
    }

    const data = res.data!;
    item.owned = data.left;
    this.syncRow(item.key);
    toast(`${item.name}：${describeEffect(data.effect)}`);
    if (data.levelUp) toast('升级啦！');
  }
}
