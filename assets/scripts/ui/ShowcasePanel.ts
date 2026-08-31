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

import { _decorator, Component, Node, Graphics, view } from 'cc';
import { PetStage } from './PetStage';
import { makeNode, makeLabel, fillRoundRectRim, COLOR } from './widgets';

const { ccclass } = _decorator;

interface BtnDef {
  label: string;
  onTap: () => void;
}

const BTN_W = 96;
const BTN_H = 42;
const GAP = 12;

@ccclass('ShowcasePanel')
export class ShowcasePanel extends Component {
  /** 由 MainView 注入的舞台引用 */
  public stage: PetStage | null = null;

  start() {
    this.build();
  }

  private build() {
    const stage = this.stage;
    if (!stage) return;

    const defs: BtnDef[] = [
      { label: '换一只', onTap: () => stage.cycleSkin(1) },
      { label: '换场景', onTap: () => stage.cycleBackground(1) },
      { label: '换道具', onTap: () => stage.cycleProp() },
      { label: '帽子开关', onTap: () => stage.toggleHat() },
      { label: '换墙纸', onTap: () => stage.cycleWallpaper(1) },
      { label: '换地板', onTap: () => stage.cycleFloor(1) },
      { label: '顾客上门', onTap: () => stage.toggleCustomer() },
      { label: '散步开关', onTap: () => stage.toggleWander() },
    ];

    const size = view.getVisibleSize();
    const x = size.width / 2 - BTN_W / 2 - 14;
    let y = size.height / 2 - 130;
    for (const def of defs) {
      this.makeButton(def, x, y);
      y -= BTN_H + GAP;
    }
  }

  private makeButton(def: BtnDef, x: number, y: number) {
    const node = makeNode('ShowBtn', this.node, BTN_W, BTN_H);
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

    node.on(Node.EventType.TOUCH_END, () => def.onTap(), this);
  }
}
