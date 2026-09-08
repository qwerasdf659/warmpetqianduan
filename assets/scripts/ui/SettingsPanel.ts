/**
 * 设置页：音量滑杆 + 若干开关 + 评分入口。
 *
 * 控件贴图来自素材包（`resources/ui/common/`）：Slider_Back/Bar/Button、TickBox。
 * 设置值只存本地（`sys.localStorage`），不上报后端——音量/震动这类纯客户端偏好，
 * 没必要占用接口，也不该因为断网就设置不了。
 */

import { _decorator, Component, Node, Sprite, SpriteFrame, resources, UITransform, EventTouch, sys, Vec3 } from 'cc';
import { makeNode, makeLabel, COLOR } from './widgets';
import { ModalPanel } from './ModalPanel';
import { RatingDialog } from './RatingDialog';

const { ccclass } = _decorator;

const UI_DIR = 'ui/common';
const STORE_KEY = 'warmpet_settings';

/** 一行的高度，滑杆与开关共用 */
const ROW_H = 64;
const SLIDER_W = 220;
const SLIDER_H = 16;
const KNOB = 28;
const TICK = 32;

interface SettingsData {
  bgm: number;
  sfx: number;
  vibrate: boolean;
  notify: boolean;
}

const DEFAULTS: SettingsData = { bgm: 0.7, sfx: 0.8, vibrate: true, notify: true };

function load(): SettingsData {
  try {
    const raw = sys.localStorage.getItem(STORE_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch (e) {
    console.warn('[Settings] 读取本地设置失败，用默认值', e);
  }
  return { ...DEFAULTS };
}

function save(data: SettingsData) {
  try {
    sys.localStorage.setItem(STORE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('[Settings] 保存设置失败', e);
  }
}

@ccclass('SettingsPanel')
export class SettingsPanel extends Component {
  private modal: ModalPanel | null = null;
  private data: SettingsData = load();

  public static open(parent: Node) {
    const host = new Node('SettingsPanel');
    host.parent = parent;
    const comp = host.addComponent(SettingsPanel);
    comp.build();
    return comp;
  }

  private build() {
    this.modal = ModalPanel.open(this.node, '设置');
    const body = this.modal.body;
    if (!body) return;

    let y = this.modal.bodyH / 2 - ROW_H;
    this.makeSlider(body, '背景音乐', y, this.data.bgm, (v) => { this.data.bgm = v; save(this.data); });
    y -= ROW_H;
    this.makeSlider(body, '音效', y, this.data.sfx, (v) => { this.data.sfx = v; save(this.data); });
    y -= ROW_H;
    this.makeToggle(body, '震动反馈', y, this.data.vibrate, (v) => { this.data.vibrate = v; save(this.data); });
    y -= ROW_H;
    this.makeToggle(body, '推送提醒', y, this.data.notify, (v) => { this.data.notify = v; save(this.data); });
    y -= ROW_H + 8;
    this.makeTextButton(body, '给我们评分', y, () => RatingDialog.open(this.node));
  }

  /** 一行标签 */
  private rowLabel(parent: Node, text: string, y: number) {
    const label = makeLabel(text, parent, { size: 20, color: COLOR.text, align: 'left' });
    label.node.setPosition(-this.modal!.bodyW / 2 + 16, y, 0);
  }

  private makeSlider(parent: Node, name: string, y: number, value: number, onChange: (v: number) => void) {
    this.rowLabel(parent, name, y);

    const right = this.modal!.bodyW / 2 - 16;
    const track = makeNode('Track', parent, SLIDER_W, SLIDER_H);
    track.setPosition(right - SLIDER_W / 2, y, 0);
    this.loadInto(track, 'Slider_Back', SLIDER_W, SLIDER_H);

    const bar = makeNode('Bar', track, SLIDER_W, SLIDER_H);
    const barSprite = this.loadInto(bar, 'Slider_Bar', SLIDER_W * value, SLIDER_H);
    // 左对齐拉伸：条从左端生长，所以把它挪到左半边再按比例设宽
    bar.setPosition(-SLIDER_W / 2 + (SLIDER_W * value) / 2, 0, 0);

    const knob = makeNode('Knob', track, KNOB, KNOB);
    this.loadInto(knob, 'Slider_Button', KNOB, KNOB);
    knob.setPosition(-SLIDER_W / 2 + SLIDER_W * value, 0, 0);

    const apply = (ratio: number) => {
      const v = Math.min(1, Math.max(0, ratio));
      knob.setPosition(new Vec3(-SLIDER_W / 2 + SLIDER_W * v, 0, 0));
      const tr = bar.getComponent(UITransform);
      if (tr) tr.setContentSize(SLIDER_W * v, SLIDER_H);
      bar.setPosition(new Vec3(-SLIDER_W / 2 + (SLIDER_W * v) / 2, 0, 0));
      if (barSprite) barSprite.sizeMode = Sprite.SizeMode.CUSTOM;
      onChange(v);
    };

    const pick = (e: EventTouch) => {
      const tr = track.getComponent(UITransform);
      if (!tr) return;
      const local = tr.convertToNodeSpaceAR(new Vec3(e.getUILocation().x, e.getUILocation().y, 0));
      apply((local.x + SLIDER_W / 2) / SLIDER_W);
    };
    track.on(Node.EventType.TOUCH_START, pick, this);
    track.on(Node.EventType.TOUCH_MOVE, pick, this);
  }

  private makeToggle(parent: Node, name: string, y: number, on: boolean, onChange: (v: boolean) => void) {
    this.rowLabel(parent, name, y);

    const box = makeNode('Tick', parent, TICK, TICK);
    box.setPosition(this.modal!.bodyW / 2 - 16 - TICK / 2, y, 0);
    this.loadInto(box, 'TickBox', TICK, TICK);

    const mark = makeLabel('✓', box, { size: 22, color: COLOR.ok, align: 'center', bold: true });
    mark.node.setPosition(0, 0, 0);
    mark.node.active = on;

    let cur = on;
    box.on(Node.EventType.TOUCH_END, () => {
      cur = !cur;
      mark.node.active = cur;
      onChange(cur);
    }, this);
  }

  private makeTextButton(parent: Node, text: string, y: number, onTap: () => void) {
    const node = makeNode('Btn', parent, 200, 44);
    node.setPosition(0, y, 0);
    this.loadInto(node, 'Medium_Button', 200, 44);
    const label = makeLabel(text, node, { size: 18, color: COLOR.accentText, align: 'center', bold: true });
    label.node.setPosition(0, 0, 0);
    node.on(Node.EventType.TOUCH_END, onTap, this);
  }

  /** 给节点挂一张 ui/common 下的贴图；失败不影响交互（软失败不死亡） */
  private loadInto(node: Node, res: string, w: number, h: number): Sprite | null {
    const sprite = node.addComponent(Sprite);
    sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    sprite.type = Sprite.Type.SLICED;
    resources.load(`${UI_DIR}/${res}/spriteFrame`, SpriteFrame, (err, frame) => {
      if (!node.isValid) return;
      if (err || !frame) {
        console.warn(`[Settings] 贴图 ${res} 加载失败`, err);
        return;
      }
      sprite.spriteFrame = frame;
      const tr = node.getComponent(UITransform);
      if (tr) tr.setContentSize(w, h);
    });
    return sprite;
  }
}
