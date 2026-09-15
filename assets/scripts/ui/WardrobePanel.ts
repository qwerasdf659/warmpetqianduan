/**
 * 商店：换装的买与穿。对应地图分区 `shop`，接口 `/wardrobe`。
 *
 * 按槽位分页签（body / hat / neck / bg）。四足骨架只有 hat / neck 两个挂点，
 * 所以换装深度靠**花色数量**而不是穿搭组合 —— 见规则 `spine-2d-pet`。
 *
 * 三条纪律的落点：
 * - **服务端权威**：穿戴态一律取 `equip/unequip` 返回的完整 WardrobeView，
 *   不本地翻转 equipped 标记。换装不影响任何属性（速度耐力只由等级决定）。
 * - **幂等**：买走 `core/actions.buy`（带 bizId）；穿戴不涉及资源变动、
 *   接口本身无 bizId，重复提交无副作用。
 * - **软失败不死亡**：加载失败给重试；`price === 0` 的物品视为默认拥有，
 *   点买会 400「无需购买」，所以直接把它按已拥有渲染，不给玩家送一个必错的按钮。
 */

import { _decorator, Component, Node } from 'cc';
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
import type { ScrollList, AsyncBody } from './panelKit';
import api from '../net/api';
import { SLOTS, groupBySlot } from '../net/api/wardrobe';
import { buy, equip, unequip } from '../core/actions';
import store from '../core/store';
import { toast, modal } from './toast';
import { toApiError } from '../net/errors';
import type { Slot, WardrobeItem, WardrobeView } from '../net/types';

const { ccclass } = _decorator;

const ROW_H = 76;
const TAB_H = 34;
const TAB_GAP = 6;

/** 槽位的中文名。接口只给英文 key，界面必须说人话 */
const SLOT_NAME: Record<Slot, string> = {
  body: '花色',
  hat: '帽子',
  neck: '颈饰',
  bg: '背景',
};

@ccclass('WardrobePanel')
export class WardrobePanel extends Component {
  private modal: ModalPanel | null = null;
  private list: ScrollList | null = null;
  private body: AsyncBody | null = null;
  private refreshWallet: (() => void) | null = null;
  private tabHost: Node | null = null;
  private view: WardrobeView | null = null;
  private activeSlot: Slot = 'body';

  public static open(parent: Node): WardrobePanel {
    const host = new Node('WardrobePanel');
    host.parent = parent;
    const comp = host.addComponent(WardrobePanel);
    comp.build();
    return comp;
  }

  private build() {
    this.modal = ModalPanel.open(this.node, '商店 · 换装');
    const body = this.modal.body;
    if (!body) return;

    this.refreshWallet = walletBar(body, this.modal.bodyW - 8, this.modal.bodyH / 2 - 26);

    this.tabHost = new Node('Tabs');
    this.tabHost.parent = body;

    this.body = asyncBody(body, this.modal.bodyW);
    this.list = scrollList(body, this.modal.bodyW, this.modal.bodyH - 106, -52);

    this.load();
  }

  private load() {
    if (!this.body || !this.list) return;
    this.list.clear();
    this.body.loading();

    api.wardrobe
      .info(store.activePetId || undefined)
      .then((view) => {
        if (!this.node.isValid || !this.body) return;
        this.body.clear();
        store.applyWardrobe(view);
        this.view = view;
        if (this.refreshWallet) this.refreshWallet();

        if (!(view.items || []).length) {
          this.body.empty('货架还在补货，稍后再来');
          return;
        }
        this.buildTabs();
        this.renderItems();
      })
      .catch((err) => {
        if (!this.node.isValid || !this.body) return;
        this.body.failed(toApiError(err).message, () => this.load());
      });
  }

  /** 槽位页签。只列真的有商品的槽位，空页签点进去是空列表，等于给玩家一个死胡同 */
  private buildTabs() {
    const host = this.tabHost;
    const modal = this.modal;
    if (!host || !host.isValid || !modal || !this.view) return;
    host.removeAllChildren();

    const groups = groupBySlot(this.view.items);
    const slots = SLOTS.filter((s) => (groups[s] || []).length > 0);
    if (!slots.length) return;
    if (slots.indexOf(this.activeSlot) < 0) this.activeSlot = slots[0];

    const totalW = modal.bodyW - 8;
    const tabW = (totalW - TAB_GAP * (slots.length - 1)) / slots.length;
    const y = modal.bodyH / 2 - 62;

    slots.forEach((slot, i) => {
      const x = -totalW / 2 + tabW / 2 + i * (tabW + TAB_GAP);
      const active = slot === this.activeSlot;
      tapButton(
        host,
        SLOT_NAME[slot],
        x,
        y,
        { width: tabW, height: TAB_H, primary: active },
        () => {
          if (this.activeSlot === slot) return;
          this.activeSlot = slot;
          this.buildTabs();
          this.renderItems();
        },
      );
    });
  }

  private renderItems() {
    const list = this.list;
    const modal = this.modal;
    if (!list || !modal || !this.view) return;

    list.clear();
    const groups = groupBySlot(this.view.items);
    const items = groups[this.activeSlot] || [];
    // 已拥有的排前面，同组内按价格升序 —— 玩家最常做的事是换已有的那几件
    const sorted = items.slice().sort((a, b) => {
      if (a.owned !== b.owned) return a.owned ? -1 : 1;
      return a.price - b.price;
    });

    const areaH = modal.bodyH - 106;
    let y = areaH / 2 - ROW_H / 2;
    sorted.forEach((item) => {
      this.renderItem(list.content, item, modal.bodyW, y);
      y -= ROW_H + ROW_GAP;
    });
    list.setContentHeight(sorted.length * (ROW_H + ROW_GAP));
  }

  private renderItem(parent: Node, item: WardrobeItem, w: number, y: number) {
    const rowW = w - 8;
    const equipped = this.isEquipped(item);
    // price === 0 视为默认拥有（后端如此约定），不要给它一个必然 400 的「买」按钮
    const owned = item.owned || item.price === 0;

    const sub = owned ? (equipped ? '正在穿戴' : '已拥有') : priceText(item.price, item.pool);
    const row = listRow(parent, rowW, y, ROW_H, item.name, sub);

    if (equipped) {
      const tag = makeLabel('穿戴中', row, { size: 14, color: COLOR.ok, align: 'right' });
      tag.node.setPosition(rowW / 2 - 14, ROW_H / 2 - 22, 0);
    }

    const btnW = 96;
    const btnX = rowW / 2 - btnW / 2 - 12;

    if (!owned) {
      tapButton(
        row,
        `买 · ${priceText(item.price, item.pool)}`,
        btnX,
        -8,
        {
          width: btnW,
          height: 36,
          disabled: !affordable(item.price, item.pool),
          disabledReason: item.pool === 'marketing' ? '积分不够' : '金币不够',
        },
        () => this.onBuy(item),
      );
      return;
    }

    if (equipped) {
      // hat / neck 允许空着（不戴配饰是正常形象）；body / bg 必须有一件，所以不给脱
      const canRemove = item.slot === 'hat' || item.slot === 'neck';
      tapButton(
        row,
        canRemove ? '脱下' : '穿戴中',
        btnX,
        -8,
        {
          width: btnW,
          height: 36,
          primary: false,
          disabled: !canRemove,
          disabledReason: '这个部位必须有一件，换成别的花色就行',
        },
        () => this.onUnequip(item.slot),
      );
      return;
    }

    tapButton(row, '穿上', btnX, -8, { width: btnW, height: 36 }, () => this.onEquip(item));
  }

  /**
   * 是否正在穿戴。
   *
   * 用 `store.appearance` 而不是 `item.equipped`：新号的 `equipped` 是空对象，
   * 但 price === 0 的原色皮肤和默认背景是实际生效的形象。
   * `resolveAppearance` 补的就是这层兜底，两处判断必须用同一个来源，
   * 否则界面会说「没穿任何花色」而画面上明明有形象。
   */
  private isEquipped(item: WardrobeItem): boolean {
    return store.appearance[item.slot] === item.key;
  }

  private async onBuy(item: WardrobeItem) {
    const ok = await modal('确认购买', `${item.name}\n花费 ${priceText(item.price, item.pool)}`, true);
    if (!ok || !this.node.isValid) return;

    const res = await buy('wardrobe', item.key);
    if (!this.node.isValid) return;

    if (!res.ok) {
      toast((res.error && res.error.message) || '购买失败，请稍后再试');
      return;
    }

    if (this.refreshWallet) this.refreshWallet();
    toast(res.data!.duplicated ? `${item.name} 已经买过了` : `买到了 ${item.name}`);
    // 买完顺手穿上：玩家买一件外观，接下来必然是想看它穿上的样子
    await this.onEquip(item, true);
  }

  private async onEquip(item: WardrobeItem, silent = false) {
    const res = await equip(item.key);
    if (!this.node.isValid) return;

    if (!res.ok) {
      toast((res.error && res.error.message) || '穿戴失败，请稍后再试');
      // 买成功但穿失败时仍要刷新列表，否则那件衣服看起来像没买到
      this.reloadFromStore();
      return;
    }

    this.view = res.data!;
    this.reloadFromStore();
    if (!silent) toast(`换上了 ${item.name}`);
  }

  private async onUnequip(slot: Slot) {
    const res = await unequip(slot);
    if (!this.node.isValid) return;

    if (!res.ok) {
      toast((res.error && res.error.message) || '取下失败，请稍后再试');
      return;
    }
    this.view = res.data!;
    this.reloadFromStore();
    toast(`取下了${SLOT_NAME[slot]}`);
  }

  /** 穿戴态变了要重排当前页签（「穿上/脱下」按钮跟着换），但不重新请求 */
  private reloadFromStore() {
    if (!this.view) return;
    this.buildTabs();
    this.renderItems();
  }
}
