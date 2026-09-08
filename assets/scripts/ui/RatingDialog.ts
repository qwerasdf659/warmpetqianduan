/**
 * 评分弹窗：三张插画对应「不满意 / 一般 / 很喜欢」，点一下给反馈。
 *
 * 插画来自素材包 `resources/ui/rating/RatingArt1~3.png`。
 * 小游戏没有应用商店评分入口，所以这里只做「收集态度」：
 * 选了正面评价引导分享，选了负面引导反馈——真实产品里接后端埋点即可。
 */

import { _decorator, Component, Node, Sprite, SpriteFrame, resources, UITransform } from 'cc';
import { makeNode, makeLabel, COLOR } from './widgets';
import { ModalPanel } from './ModalPanel';
import { toast } from './toast';

const { ccclass } = _decorator;

const RATING_DIR = 'ui/rating';

/** 三档评价：贴图名 + 文案 + 选后提示 */
const CHOICES = [
  { res: 'RatingArt1', label: '还需改进', tip: '感谢反馈，我们会继续改进' },
  { res: 'RatingArt2', label: '还不错', tip: '谢谢支持' },
  { res: 'RatingArt3', label: '很喜欢', tip: '谢谢喜欢，欢迎分享给朋友' },
];

const ART_SIZE = 96;

@ccclass('RatingDialog')
export class RatingDialog extends Component {
  private modal: ModalPanel | null = null;

  public static open(parent: Node) {
    const host = new Node('RatingDialog');
    host.parent = parent;
    const comp = host.addComponent(RatingDialog);
    comp.build();
    return comp;
  }

  private build() {
    this.modal = ModalPanel.open(this.node, '喜欢这只猫吗？');
    const body = this.modal.body;
    if (!body) return;

    const gap = 24;
    const totalW = CHOICES.length * ART_SIZE + (CHOICES.length - 1) * gap;
    let x = -totalW / 2 + ART_SIZE / 2;

    for (const c of CHOICES) {
      this.makeChoice(body, c, x);
      x += ART_SIZE + gap;
    }
  }

  private makeChoice(parent: Node, c: { res: string; label: string; tip: string }, x: number) {
    const node = makeNode('Choice', parent, ART_SIZE, ART_SIZE + 28);
    node.setPosition(x, 0, 0);

    const art = makeNode('Art', node, ART_SIZE, ART_SIZE);
    art.setPosition(0, 14, 0);
    const sprite = art.addComponent(Sprite);
    sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    resources.load(`${RATING_DIR}/${c.res}/spriteFrame`, SpriteFrame, (err, frame) => {
      if (!art.isValid) return;
      if (err || !frame) {
        console.warn(`[Rating] 插画 ${c.res} 加载失败`, err);
        return;
      }
      sprite.spriteFrame = frame;
      const s = ART_SIZE / Math.max(frame.rect.width, frame.rect.height);
      const tr = art.getComponent(UITransform);
      if (tr) tr.setContentSize(frame.rect.width * s, frame.rect.height * s);
    });

    const label = makeLabel(c.label, node, { size: 16, color: COLOR.text, align: 'center' });
    label.node.setPosition(0, -ART_SIZE / 2 - 6, 0);

    node.on(Node.EventType.TOUCH_END, () => {
      toast(c.tip);
      if (this.modal) this.modal.close();
      if (this.node.isValid) this.node.destroy();
    }, this);
  }
}
