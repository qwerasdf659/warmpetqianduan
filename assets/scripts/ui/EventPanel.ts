/**
 * 活动面板：分档位（tier）展示活动奖励进度。
 *
 * 素材来自 `resources/ui/event/`：
 *   EventPanel_Frame_Tier1~4_9Slice  各档边框（9 宫格拉伸）
 *   EventPanel_Header_Tier1~4        各档标题底
 *   EventPanel_Header_Banner/Decor   横幅与装饰
 *   EventPanel_Slot_Reward           普通奖励槽
 *   EventPanel_Premium_Slot_Reward   高级奖励槽
 *   BonusChest                       额外奖励箱
 *
 * 档位的视觉分级（Tier1 朴素 → Tier4 华丽）正好对应「活动进度越高、包装越隆重」。
 * 这里先用本地假数据铺界面，接后端时只换数据源。
 */

import { _decorator, Component, Node, Sprite, SpriteFrame, resources, UITransform } from 'cc';
import { makeNode, makeLabel, COLOR } from './widgets';
import { ModalPanel } from './ModalPanel';

const { ccclass } = _decorator;

const EVENT_DIR = 'ui/event';

/** 一档活动：标题 + 奖励数 + 是否已解锁 + 是否高级档 */
interface Tier {
  tier: number;
  title: string;
  rewards: number;
  unlocked: boolean;
  premium: boolean;
}

/** 本地假数据：接后端时替换成活动接口返回 */
const TIERS: Tier[] = [
  { tier: 1, title: '初来报到', rewards: 3, unlocked: true, premium: false },
  { tier: 2, title: '熟客之路', rewards: 4, unlocked: true, premium: false },
  { tier: 3, title: '资深猫友', rewards: 4, unlocked: false, premium: false },
  { tier: 4, title: '尊享奖励', rewards: 5, unlocked: false, premium: true },
];

const ROW_H = 92;
const SLOT = 44;
const SLOT_GAP = 8;

@ccclass('EventPanel')
export class EventPanel extends Component {
  private modal: ModalPanel | null = null;

  public static open(parent: Node) {
    const host = new Node('EventPanel');
    host.parent = parent;
    const comp = host.addComponent(EventPanel);
    comp.build();
    return comp;
  }

  private build() {
    this.modal = ModalPanel.open(this.node, '限时活动');
    const body = this.modal.body;
    if (!body) return;

    // 顶部横幅
    const banner = makeNode('Banner', body, this.modal.bodyW - 24, 56);
    banner.setPosition(0, this.modal.bodyH / 2 - 36, 0);
    this.loadInto(banner, 'EventPanel_Header_Banner', this.modal.bodyW - 24, 56);
    const bt = makeLabel('猫咖开业庆典', banner, { size: 20, color: COLOR.accentText, align: 'center', bold: true });
    bt.node.setPosition(0, 0, 0);

    let y = this.modal.bodyH / 2 - 36 - 56;
    for (const t of TIERS) {
      this.makeTierRow(body, t, y);
      y -= ROW_H;
    }
  }

  private makeTierRow(parent: Node, t: Tier, y: number) {
    const w = this.modal!.bodyW - 24;
    const row = makeNode(`Tier${t.tier}`, parent, w, ROW_H - 10);
    row.setPosition(0, y, 0);
    // 各档用各自的边框，视觉分级
    this.loadInto(row, `EventPanel_Frame_Tier${t.tier}_9Slice`, w, ROW_H - 10);

    // 档位标题底 + 文案
    const header = makeNode('Header', row, 96, 30);
    header.setPosition(-w / 2 + 56, (ROW_H - 10) / 2 - 20, 0);
    this.loadInto(header, `EventPanel_Header_Tier${t.tier}`, 96, 30);
    const title = makeLabel(t.title, header, { size: 15, color: COLOR.accentText, align: 'center', bold: true });
    title.node.setPosition(0, 0, 0);

    // 奖励槽：高级档用 Premium 槽
    const slotRes = t.premium ? 'EventPanel_Premium_Slot_Reward' : 'EventPanel_Slot_Reward';
    const totalW = t.rewards * SLOT + (t.rewards - 1) * SLOT_GAP;
    let x = -totalW / 2 + SLOT / 2;
    for (let i = 0; i < t.rewards; i++) {
      const slot = makeNode('Slot', row, SLOT, SLOT);
      slot.setPosition(x, -12, 0);
      this.loadInto(slot, slotRes, SLOT, SLOT);
      // 未解锁的档整体压暗，一眼看出进度
      if (!t.unlocked) {
        const lock = makeLabel('锁', slot, { size: 14, color: COLOR.dim, align: 'center' });
        lock.node.setPosition(0, 0, 0);
      }
      x += SLOT + SLOT_GAP;
    }

    // 最高档右侧放个奖励箱做视觉锚点
    if (t.premium) {
      const chest = makeNode('Chest', row, 52, 52);
      chest.setPosition(w / 2 - 40, -8, 0);
      this.loadInto(chest, 'BonusChest', 52, 52);
    }
  }

  /** 挂 ui/event 下的贴图，9Slice 类用 SLICED 拉伸 */
  private loadInto(node: Node, res: string, w: number, h: number) {
    const sprite = node.addComponent(Sprite);
    sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    sprite.type = res.includes('9Slice') ? Sprite.Type.SLICED : Sprite.Type.SIMPLE;
    resources.load(`${EVENT_DIR}/${res}/spriteFrame`, SpriteFrame, (err, frame) => {
      if (!node.isValid) return;
      if (err || !frame) {
        console.warn(`[EventPanel] 贴图 ${res} 加载失败`, err);
        return;
      }
      sprite.spriteFrame = frame;
      const tr = node.getComponent(UITransform);
      if (tr) tr.setContentSize(w, h);
    });
  }
}
