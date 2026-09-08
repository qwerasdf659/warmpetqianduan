/**
 * 玩法验证用的展示面板：右上角一列小按钮，把 PetStage 的几个展示能力挂到界面上。
 *
 *   换一只   —— 循环切换 59 只猫（Spine 皮肤）
 *   换场景   —— 循环切换厨房/温室/工坊/房间背景
 *   家具     —— 显示/隐藏鱼缸家具（自播鱼游动画）
 *   帽子     —— 戴上/摘下饰品（2D 挂点，跟随头骨）
 *
 * 这是验证/演示层，不属于正式界面。真实产品里换宠、换场景、换装各有独立入口与后端数据，
 * 到时候把这些按钮删掉即可，PetStage 的能力本身可复用。
 */

import { _decorator, Component, Node, Graphics, Label, view } from 'cc';
import { PetStage } from './PetStage';
import { makeNode, makeLabel, fillRoundRectRim, COLOR } from './widgets';
import { ShopPanel } from './ShopPanel';
import { EventPanel } from './EventPanel';
import { SettingsPanel } from './SettingsPanel';

const { ccclass } = _decorator;

interface BtnDef {
  label: string;
  onTap: () => void;
  /** 点按后回传当前按钮的 Label，用于把最新状态（如皮肤序号）写回按钮文字 */
  refresh?: (label: Label) => void;
}

const BTN_W = 96;
const BTN_H = 42;
/** 按钮变多（9 个）后间距收紧，避免竖排超出屏幕 */
const GAP = 8;
/** 收起时只显示一个小圆钮，避免 8 个按钮糊住半屏宠物与货币 */
const TOGGLE_SIZE = 44;

@ccclass('ShowcasePanel')
export class ShowcasePanel extends Component {
  /** 由 MainView 注入的舞台引用 */
  public stage: PetStage | null = null;

  /** 装所有展示按钮的容器，整体显隐 */
  private listNode: Node | null = null;
  private expanded = false;

  start() {
    this.build();
  }

  private build() {
    const stage = this.stage;
    if (!stage) return;

    // 「换一只」按钮把当前皮肤序号写进文字（第几只/共几只），一眼看出 59 花色在循环
    const skinLabel = () => (stage.skinCount ? `换一只 ${stage.currentSkinNo}/${stage.skinCount}` : '换一只');
    const defs: BtnDef[] = [
      {
        label: skinLabel(),
        onTap: () => stage.cycleSkin(1),
        refresh: (label) => { label.string = skinLabel(); },
      },
      { label: '换场景', onTap: () => stage.cycleBackground(1) },
      { label: '换道具', onTap: () => stage.cycleProp() },
      {
        label: '换饰品',
        onTap: () => stage.toggleHat(),
        // 饰品是异步 loadDir 拿到的，点完才知道总数，所以在 refresh 里写文字
        refresh: (label) => {
          label.string = stage.accessoryCount
            ? `换饰品 ${stage.accessoryNo}/${stage.accessoryCount}`
            : '换饰品';
        },
      },
      {
        label: '换陈设',
        onTap: () => stage.cycleDecor(1),
        refresh: (label) => {
          label.string = stage.decorCount
            ? `换陈设 ${stage.decorNo}/${stage.decorCount}`
            : '换陈设 (无)';
        },
      },
      { label: '换墙纸', onTap: () => stage.cycleWallpaper(1) },
      { label: '换地板', onTap: () => stage.cycleFloor(1) },
      { label: '顾客上门', onTap: () => stage.toggleCustomer() },
      { label: '散步开关', onTap: () => stage.toggleWander() },
      // 弹窗类界面挂到场景根节点上，别挂在本面板里——本面板会被折叠隐藏
      { label: '装修商店', onTap: () => ShopPanel.open(this.node.parent || this.node) },
      { label: '限时活动', onTap: () => EventPanel.open(this.node.parent || this.node) },
      { label: '设置', onTap: () => SettingsPanel.open(this.node.parent || this.node) },
    ];

    const size = view.getVisibleSize();
    const x = size.width / 2 - BTN_W / 2 - 14;

    // 按钮放进容器，默认收起：这是验证面板，不该常驻挡住宠物和货币
    const list = new Node('ShowcaseList');
    list.parent = this.node;
    this.listNode = list;

    // 12 个按钮单列会超出屏幕，排两列：右列在原位，左列往左挪一个按钮宽
    const rows = Math.ceil(defs.length / 2);
    const top = size.height / 2 - 190;
    defs.forEach((def, i) => {
      const col = Math.floor(i / rows);
      const row = i % rows;
      this.makeButton(def, x - col * (BTN_W + GAP), top - row * (BTN_H + GAP), list);
    });

    this.makeToggle(x, size.height / 2 - 140);
    this.setExpanded(false);
  }

  /** 右上角小圆钮：展开/收起展示按钮列 */
  private makeToggle(x: number, y: number) {
    const node = makeNode('ShowcaseToggle', this.node, TOGGLE_SIZE, TOGGLE_SIZE);
    node.setPosition(x + BTN_W / 2 - TOGGLE_SIZE / 2, y, 0);

    const g = node.addComponent(Graphics);
    fillRoundRectRim(g, -TOGGLE_SIZE / 2, -TOGGLE_SIZE / 2, TOGGLE_SIZE, TOGGLE_SIZE, TOGGLE_SIZE / 2, COLOR.accent, 3);

    const label = makeLabel('⋯', node, {
      size: 22,
      color: COLOR.accentText,
      align: 'center',
      bold: true,
    });
    label.node.setPosition(0, 0, 0);

    node.on(Node.EventType.TOUCH_END, () => {
      this.setExpanded(!this.expanded);
      label.string = this.expanded ? '×' : '⋯';
    }, this);
  }

  private setExpanded(on: boolean) {
    this.expanded = on;
    if (this.listNode) this.listNode.active = on;
  }

  private makeButton(def: BtnDef, x: number, y: number, parent: Node) {
    const node = makeNode('ShowBtn', parent, BTN_W, BTN_H);
    node.setPosition(x, y, 0);

    const g = node.addComponent(Graphics);
    fillRoundRectRim(g, -BTN_W / 2, -BTN_H / 2, BTN_W, BTN_H, BTN_H / 2, COLOR.accent, 3);

    const label = makeLabel(def.label, node, {
      size: 15,
      color: COLOR.accentText,
      align: 'center',
      bold: true,
    });
    label.node.setPosition(0, 0, 0);

    node.on(Node.EventType.TOUCH_END, () => {
      def.onTap();
      if (def.refresh) {
        def.refresh(label);
        // 有的能力是异步的（饰品要先 loadDir），同步读到的还是旧值，
        // 隔一帧再刷一次，保证按钮上的序号跟得上。
        this.scheduleOnce(() => { if (label.isValid) def.refresh!(label); }, 0.1);
      }
    }, this);
  }
}
