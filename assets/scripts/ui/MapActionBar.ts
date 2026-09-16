/**
 * 地图内联互动条：四种互动 + 三条属性条，直接叠在地图上。
 *
 * 为什么内联而不是跳界面（2026-09-16 定）：
 * 原先地板上有一块铺满整个 `floorH` 的「大厅」分区，点它整屏切到 `MainView`。
 * 后果是**落在四个壁龛之外的任何一次点击都会跳走** —— 玩家想拖地图看房间，
 * 手指一松就换了界面，读成「地图坏了」。
 *
 * 而 `MainView` 里真正的功能只有「四种互动 + 属性条」这一块，
 * 完全放得进地图底部。跳一整屏去做四个按钮的事，本身就不划算。
 *
 * 职责边界和 `MainView` 一致（规则：客户端只做表现 + 输入采集）：
 * 这里不算任何数值。属性来自 store，冷却时长来自服务端响应，本地只倒数给玩家看。
 *
 * 挂在 `MapView` 的**节点之外**（由 MapView 建成兄弟层并置于其上），
 * 所以不随地图横向拖动 —— 它是 HUD 的一部分，不是房间里的东西。
 */

import { _decorator, Component, Node, Label, Color, Sprite, SpriteFrame, resources, view } from 'cc';
import {
  COLOR,
  STAT_COLOR,
  makeNode,
  makeGraphics,
  makeLabel,
  fillRoundRect,
  fillRoundRectRim,
  softShadow,
  floatText,
} from './widgets';
import { interact } from '../core/actions';
import { showError, toast, gainedText } from './toast';
import * as cooldown from '../core/cooldown';
import store from '../core/store';
import { HUD_BOTTOM } from './mapLayout';
import type { PetAction } from '../net/types';

const { ccclass } = _decorator;

/** 和 MainView 的 ACTIONS 一致：顺序即屏幕上的左右顺序 */
const ACTIONS: Array<{ key: PetAction; name: string }> = [
  { key: 'feed', name: '喂食' },
  { key: 'bath', name: '洗澡' },
  { key: 'pet', name: '抚摸' },
  { key: 'play', name: '陪玩' },
];

/**
 * 属性条只放**三条**（饱食/清洁/体力），不放心情。
 *
 * MainView 那边是四条 2×2，因为它有整屏可用。这里挤在地图底部，
 * 而心情已经由**猫头顶的需求气泡**表达了（`MapView.refreshPetOverlay`
 * 取最紧缺的一项显示图标）—— 重复显示不如把高度还给地图。
 */
const BARS: Array<{ key: 'hunger' | 'cleanliness' | 'stamina'; name: string; color: Color }> = [
  { key: 'hunger', name: '饱食', color: STAT_COLOR.hunger },
  { key: 'cleanliness', name: '清洁', color: STAT_COLOR.cleanliness },
  { key: 'stamina', name: '体力', color: STAT_COLOR.stamina },
];

const MARGIN = 12;
/** 按钮尺寸。MainView 用 76 高的大按钮（整屏可用），这里必须收窄 */
const BTN_H = 46;
const BTN_GAP = 8;
const ICON_SIZE = 22;
/** 属性条 */
const BAR_H = 7;
const BAR_GAP = 4;

@ccclass('MapActionBar')
export class MapActionBar extends Component {
  /**
   * 互动成功后的回调，由 MapView 注入 → 让地图上那只猫也演一下。
   * 不注入也能用（软失败不死亡），只是没有动画反馈。
   */
  onReact: ((action: PetAction) => void) | null = null;

  /**
   * 互动条整体的上沿 y，只用于把飘字放在条的上方。
   *
   * **宠物的散步下限不读这个值**，那是 `mapLayout.ACTION_BAR_H` 算的 ——
   * 布局要在建互动条之前就定好（`computeLayout` 先跑），拿不到这里的运行时值。
   * 两处必须对得上，用 `.build/scripts/check-actionbar.mjs` 校验。
   */
  private vw = 0;
  private vh = 0;
  private barTop = 0;

  private busy: Record<string, boolean> = {};
  private pressed = '';
  private btnHost: Node | null = null;
  private barHost: Node | null = null;
  private lastSig = '';
  /** 按钮的宽度与整排宽度，redrawButtons 要按它们重算每个底板的 x */
  private btnW = 0;
  private btnTotal = 0;
  /** 按钮上的文字与图标。冷却时底板变浅，两者都要换成深色才看得见 */
  private btnLabels: Label[] = [];
  private btnIcons: Node[] = [];

  onLoad() {
    const size = view.getVisibleSize();
    this.vw = size.width;
    this.vh = size.height;
    this.build();
    store.on('pet', this.invalidate, this);
    this.invalidate();
  }

  onDestroy() {
    store.off('pet', this.invalidate);
  }

  update() {
    // 冷却每秒都在走，所以签名里带上剩余秒数（取整，不是毫秒）
    const sig = this.buildSig();
    if (sig === this.lastSig) return;
    this.lastSig = sig;
    this.redraw();
  }

  private invalidate() {
    this.lastSig = '';
  }

  private buildSig(): string {
    const p = store.petView;
    const petId = store.activePetId;
    const cds = ACTIONS.map((a) => Math.ceil(cooldown.remainMs(petId, a.key) / 1000)).join(',');
    return [
      p ? Math.round(p.hunger) : -1,
      p ? Math.round(p.cleanliness) : -1,
      p ? Math.round(p.stamina) : -1,
      p ? p.staminaMax : -1,
      cds,
      this.pressed,
    ].join('|');
  }

  // ---- 搭建 ----

  private build() {
    // 从屏幕底往上排：底部 HUD（任务条 + 圆入口）已经占掉 HUD_BOTTOM，
    // 互动条压在它**上方**。纵向一律现算，不写死偏移（fitWidth 下高度随机型变）。
    // HUD_BOTTOM 从 mapLayout 导入而不是抄一份数字 —— 抄的那份改不到，
    // 症状是互动条和底部圆入口叠在一起（规则：数值只有一个来源）。
    const hudBottom = -this.vh / 2 + HUD_BOTTOM;
    const barsH = BARS.length * BAR_H + (BARS.length - 1) * BAR_GAP;

    const btnCy = hudBottom + 6 + BTN_H / 2;
    const barsBottom = btnCy + BTN_H / 2 + 6;
    // 底板比条本身上下各多 5，所以整条的真实上沿要把它算进去 ——
    // MapView 拿这个值当宠物散步的下限，少算的话猫会被压在互动条下面
    this.barTop = barsBottom + barsH + 5;

    this.buildBars(barsBottom, barsH);
    // 按钮在属性条**之后**挂：兄弟次序即渲染层级，按钮要能盖住属性条的底板
    this.buildButtons(btnCy);
  }

  /**
   * 三条属性条，横排在互动按钮上方。
   *
   * 竖排三行要占 33 + 两条间隙，横排只占一行 —— 地图底部每一像素都要还给房间。
   * 名字印在条的左端外侧（条本身太细，印在条内读不到）。
   */
  private buildBars(y: number, barsH: number) {
    const w = this.vw - MARGIN * 2;
    const host = makeNode('MapBars', this.node, w, barsH);
    host.setPosition(0, y + barsH / 2);

    // 底板：三条细线直接压在地板贴图上对比不足，垫一层半透明奶白
    const g = makeGraphics('plate', host);
    fillRoundRect(g, -w / 2, -barsH / 2 - 5, w, barsH + 10, 8, COLOR.panel);

    this.barHost = makeNode('bars', host, w, barsH);
  }

  private buildButtons(cy: number) {
    const total = this.vw - MARGIN * 2;
    const btnW = (total - BTN_GAP * (ACTIONS.length - 1)) / ACTIONS.length;
    const host = makeNode('MapBtns', this.node, total, BTN_H);
    host.setPosition(0, cy);
    this.btnHost = makeNode('draw', host, total, BTN_H);

    ACTIONS.forEach((action, i) => {
      const cx = -total / 2 + btnW / 2 + i * (btnW + BTN_GAP);

      // 图标在左、文字在右，整组**居中**：46 高的按钮放不下「图上字下」，
      // 只能横排。图标是单色剪影，颜色在这里上（同 MainView）；
      // 加载失败就只剩文字 —— 缺图标不能让按钮不可用（软失败不死亡）。
      this.btnIcons.push(this.loadIcon(action.key, cx - 20, cy));

      const lbl = makeLabel(action.name, this.node, {
        size: 15, color: COLOR.accentText, align: 'center', bold: true,
      });
      lbl.node.setPosition(cx + 12, cy);
      // 存引用：冷却时底板变浅，近白的字会看不见 —— 要跟着换成深色（见 redrawButtons）
      this.btnLabels.push(lbl);

      // 触摸区单独用空节点，和绘制解耦：调按钮位置时不用同步改两处
      const hitNode = makeNode(`MapBtn_${action.key}`, this.node, btnW, BTN_H);
      hitNode.setPosition(cx, cy);
      hitNode.on(Node.EventType.TOUCH_START, () => this.setPressed(action.key), this);
      hitNode.on(Node.EventType.TOUCH_CANCEL, () => this.setPressed(''), this);
      hitNode.on(Node.EventType.TOUCH_END, () => {
        this.setPressed('');
        this.onInteract(action.key);
      }, this);
    });

    this.btnW = btnW;
    this.btnTotal = total;
  }

  /** 返回图标节点，供冷却时改染色（Sprite 挂在它上面） */
  private loadIcon(key: string, cx: number, cy: number): Node {
    const node = makeNode(`MapIcon_${key}`, this.node, ICON_SIZE, ICON_SIZE);
    node.setPosition(cx, cy);
    const sprite = node.addComponent(Sprite);
    sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    sprite.trim = false;
    sprite.color = COLOR.accentText;
    node.active = false;
    resources.load(`icons/icon_${key}/spriteFrame`, SpriteFrame, (err, frame) => {
      if (!node.isValid || err || !frame) return;
      sprite.spriteFrame = frame as SpriteFrame;
      node.active = true;
    });
    return node;
  }

  private setPressed(key: string) {
    if (this.pressed === key) return;
    this.pressed = key;
    this.lastSig = '';
  }

  // ---- 重绘 ----

  private redraw() {
    this.redrawButtons();
    this.redrawBars();
  }

  /**
   * 按钮底板。三种状态各有明确外观，**冷却中必须看得出来**——
   * 长得一样却点不动就是「静默失败」，玩家分不清是坏了还是在冷却。
   */
  private redrawButtons() {
    const host = this.btnHost;
    if (!host || !host.isValid) return;
    host.removeAllChildren();

    const petId = store.activePetId;
    const g = makeGraphics('g', host);
    const total = this.btnTotal;
    const w = this.btnW;

    ACTIONS.forEach((action, i) => {
      const x = -total / 2 + i * (w + BTN_GAP);
      const remain = cooldown.remainMs(petId, action.key);
      const ready = remain <= 0;
      const down = this.pressed === action.key;

      const face = ready ? (down ? COLOR.accentPressed : COLOR.accent) : COLOR.disabled;
      softShadow(g, x, -BTN_H / 2, w, BTN_H, 12, 4);
      fillRoundRectRim(g, x, -BTN_H / 2, w, BTN_H, 12, face, 2);

      // **文字和图标要跟着底板换色。** 冷却时底板从焦糖橘变浅灰，
      // 而字是近白的 `accentText` —— 不换色就会在浅底上直接消失，
      // 玩家看到的是一个空按钮（比「灰掉」更像坏了）。
      const ink = ready ? COLOR.accentText : COLOR.dim;
      const lbl = this.btnLabels[i];
      if (lbl && lbl.node.isValid) lbl.color = ink;
      const icon = this.btnIcons[i];
      if (icon && icon.isValid) {
        const sprite = icon.getComponent(Sprite);
        if (sprite) sprite.color = ink;
      }

      // 冷却剩余秒数印在按钮下沿：只把按钮变灰的话看不出「还要多久」
      if (!ready) {
        const secs = Math.ceil(remain / 1000);
        const cd = makeLabel(`${secs}s`, host, {
          size: 11, color: COLOR.text, align: 'center', bold: true,
        });
        cd.node.setPosition(x + w / 2, -BTN_H / 2 + 8);
      }
    });
  }

  private redrawBars() {
    const host = this.barHost;
    if (!host || !host.isValid) return;
    host.removeAllChildren();

    const p = store.petView;
    const w = this.vw - MARGIN * 2;
    const barsH = BARS.length * BAR_H + (BARS.length - 1) * BAR_GAP;
    // 名字占左侧一小条，条本身吃剩下的
    const nameW = 40;
    const trackW = w - nameW - 12;
    const g = makeGraphics('g', host);

    BARS.forEach((bar, i) => {
      const y = barsH / 2 - BAR_H / 2 - i * (BAR_H + BAR_GAP);
      const x = -w / 2 + nameW;

      fillRoundRect(g, x, y - BAR_H / 2, trackW, BAR_H, BAR_H / 2, COLOR.track);
      // **体力的上限是 staminaMax（随等级增长），不是 100** —— 写死 100 会让
      // 满体力的高等级宠物显示成半条（MainView.redrawBars 同样这么算）
      const max = p ? (bar.key === 'stamina' ? p.staminaMax : 100) : 100;
      const v = p ? Math.max(0, p[bar.key]) : 0;
      const ratio = max > 0 ? Math.min(1, v / max) : 0;
      if (ratio > 0) {
        // 低于两成转警示色：属性见底是玩家最需要注意的时刻
        fillRoundRect(g, x, y - BAR_H / 2, trackW * ratio, BAR_H, BAR_H / 2,
          ratio <= 0.2 ? COLOR.danger : bar.color);
      }

      const lbl = makeLabel(bar.name, host, { size: 12, color: COLOR.text });
      lbl.node.setPosition(-w / 2 + 4, y);
    });
  }

  // ---- 交互 ----

  /**
   * 和 `MainView.onInteract` 同一条链路：本地冷却先拦一道 → 发请求 →
   * 按返回值播表现。服务端才是权威，本地只负责不发明知会失败的请求。
   */
  private async onInteract(action: PetAction) {
    if (this.busy[action]) return;
    if (!cooldown.isReady(store.activePetId, action)) {
      // 冷却中点了要说一句：底板虽然变灰了，但玩家可能没注意到
      toast(`还要等 ${cooldown.remainText(store.activePetId, action)}`);
      return;
    }

    this.busy[action] = true;
    this.lastSig = '';
    const res = await interact(action);
    this.busy[action] = false;
    this.lastSig = '';

    if (!res.ok) {
      showError(res.error);
      return;
    }

    if (this.onReact) this.onReact(action);

    const gained = gainedText(res.data.gained);
    if (gained) floatText(this.node, gained, COLOR.ok, this.barTop + 20);
    // 撞到每日上限时实发会少于标称值，得说清楚，否则玩家以为掉奖励
    if (res.data.capped) toast('今日收益已达上限，明天再来');
    if (res.data.levelUp) floatText(this.node, '升级啦！', COLOR.warn, this.barTop + 50);
  }
}
