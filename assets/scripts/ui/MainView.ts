/**
 * 主界面：宠物状态 + 四种互动 + 冷却倒计时。
 *
 * 职责边界（规则：客户端只做表现 + 输入采集）：
 * 这里不算任何数值。属性来自服务端，两次请求之间用 predict 做视觉平滑；
 * 冷却时长来自服务端响应的 cooldownRemainMs，本地只负责倒数给玩家看。
 * 点击后的所有状态同步都交给 core/actions，UI 只根据返回值播表现。
 */

import {
  _decorator,
  Component,
  Node,
  Label,
  Graphics,
  Color,
  Sprite,
  SpriteFrame,
  resources,
  view,
} from 'cc';
import {
  COLOR,
  STAT_COLOR,
  topInset,
  makeNode,
  makeGraphics,
  makeLabel,
  fillRoundRect,
  floatText,
  pop,
} from './widgets';
import { interact } from '../core/actions';
import { showError, toast, gainedText } from './toast';
import * as cooldown from '../core/cooldown';
import { expProgress, describeMood, isMaxLevel } from '../core/predict';
import store from '../core/store';
import { OfflineDialog } from './OfflineDialog';
import { PetStage } from './PetStage';
import type { PetAction, PetStateView } from '../net/types';

const { ccclass } = _decorator;

const ACTIONS: Array<{ key: PetAction; name: string }> = [
  { key: 'feed', name: '喂食' },
  { key: 'bath', name: '洗澡' },
  { key: 'pet', name: '抚摸' },
  { key: 'play', name: '陪玩' },
];

interface StatBar {
  key: 'hunger' | 'cleanliness' | 'mood' | 'stamina';
  name: string;
  color: Color;
}

const BARS: StatBar[] = [
  { key: 'hunger', name: '饱食', color: STAT_COLOR.hunger },
  { key: 'cleanliness', name: '清洁', color: STAT_COLOR.cleanliness },
  { key: 'mood', name: '心情', color: STAT_COLOR.mood },
  { key: 'stamina', name: '体力', color: STAT_COLOR.stamina },
];

const MARGIN = 32;
const BAR_H = 18;
const BTN_H = 96;
const BTN_GAP = 12;
const BOTTOM_MARGIN = 48;
/** 图标显示尺寸，docs/06 §6.2 */
const ICON_SIZE = 48;

/**
 * 属性条排成 2×2 而不是竖着堆四行。
 *
 * 四行要占 208，几乎吃掉屏幕中段——而文档 2.1 要求「UI 退居边缘，中间大片留给宠物」。
 * 两列之后面板只有 130 上下，中间给宠物腾出近 80 的高度。
 * 四条属性本来就是并列关系，网格排列读起来也不比竖排差。
 */
const BAR_COLS = 2;
const BAR_ROW_H = 44;
const BAR_COL_GAP = 16;
const PANEL_PAD = 18;

/** 一次算好所有位置，绘制和文字共用同一份，避免两处各算一遍算歪 */
interface Layout {
  w: number;
  h: number;
  left: number;
  right: number;
  nameY: number;
  levelY: number;
  expBarY: number;
  petCenterY: number;
  bubbleY: number;
  panelBottom: number;
  panelH: number;
  barsTop: number;
  barCellW: number;
  btnY: number;
  btnW: number;
}

@ccclass('MainView')
export class MainView extends Component {
  private L!: Layout;

  private stage: PetStage | null = null;
  private gfxDynamic: Graphics | null = null;

  private nameLabel: Label | null = null;
  private levelLabel: Label | null = null;
  private coinLabel: Label | null = null;
  private pointLabel: Label | null = null;
  private bubbleLabel: Label | null = null;
  private barValueLabels: Label[] = [];
  private btnLabels: Label[] = [];
  private btnSubLabels: Label[] = [];

  /** 正在请求中的动作，防止连点重复提交 */
  private busy: Record<string, boolean> = {};
  /** 手指正按住的按钮，用来画下沉反馈 */
  private pressed = '';
  /** 上一帧的绘制签名，没变就不重画，省掉每帧重建网格 */
  private lastSignature = '';

  onLoad() {
    this.L = this.computeLayout();

    // 3D 舞台要先建：它会把 UI 相机改成「只清深度」，
    // 之后 UI 才能正确地叠在 3D 画面上。
    this.stage = this.node.addComponent(PetStage);
    // 相机取景对齐 UI 留出的那块空当，否则可视高度一变宠物就被面板压住
    this.stage.frameTo(this.L.petCenterY, this.L.h);

    // 顺序即渲染层级，也决定能不能合批：先所有 Graphics，再所有 Sprite，最后所有 Label。
    // 三类渲染组件各自用不同的材质与图集，交叉挂载会把批次切碎（docs/06 §4.4）。
    this.buildStatic();
    this.gfxDynamic = makeGraphics('GfxDynamic', this.node);
    this.buildIcons();
    this.buildLabels();
    this.buildHitAreas();

    store.on('pet', this.onStoreChanged, this);
    store.on('wallet', this.onStoreChanged, this);
    this.onStoreChanged();

    if (store.hasOfflineReward) OfflineDialog.show(this.node);
  }

  onDestroy() {
    store.off('pet', this.onStoreChanged);
    store.off('wallet', this.onStoreChanged);
  }

  update() {
    this.redraw();
  }

  /**
   * 竖屏设计分辨率是 720×1280，但 fitWidth 模式下实际可视高度由设备宽高比决定，
   * 编辑器预览窗口矮的时候可视高度可能只有六百多。
   * 所以纵向不能用固定偏移：底部三块（按钮、状态条面板、气泡）自下而上排，
   * 顶部栏自上而下排，宠物占剩下的空间，空间不够就把它缩小。
   */
  private computeLayout(): Layout {
    const size = view.getVisibleSize();
    const w = size.width;
    const h = size.height;
    const inset = topInset();

    const top = h / 2;
    const nameY = top - inset - 18;
    const levelY = top - inset - 48;
    const expBarY = top - inset - 74;

    const btnY = -h / 2 + BOTTOM_MARGIN;
    const barRows = Math.ceil(BARS.length / BAR_COLS);
    const panelH = BAR_ROW_H * barRows + PANEL_PAD * 2;
    const panelBottom = btnY + BTN_H + 24;
    const panelTop = panelBottom + panelH;
    const barsTop = panelTop - PANEL_PAD - 16;

    const panelW = w - MARGIN * 2;
    const barCellW = (panelW - PANEL_PAD * 2 - BAR_COL_GAP * (BAR_COLS - 1)) / BAR_COLS;

    const bubbleY = panelTop + 26;
    const petAreaTop = expBarY - 20;
    const petAreaBottom = bubbleY + 24;
    const petCenterY = (petAreaTop + petAreaBottom) / 2;

    return {
      w,
      h,
      left: -w / 2 + MARGIN,
      right: w / 2 - MARGIN,
      nameY,
      levelY,
      expBarY,
      petCenterY,
      bubbleY,
      panelBottom,
      panelH,
      barsTop,
      barCellW,
      btnY,
      btnW: (w - MARGIN * 2 - BTN_GAP * 3) / 4,
    };
  }

  /** 属性条按 2×2 排布，索引 0..3 映射到左上、右上、左下、右下 */
  private barCell(index: number): { x: number; y: number } {
    const L = this.L;
    const col = index % BAR_COLS;
    const row = Math.floor(index / BAR_COLS);
    return {
      x: L.left + PANEL_PAD + col * (L.barCellW + BAR_COL_GAP),
      y: L.barsTop - row * BAR_ROW_H,
    };
  }

  /**
   * 不会变的形状只画一次。
   *
   * 注意这里**没有**整屏背景：背景由 3D 相机清屏时给出，
   * UI 层再铺一张不透明底图的话会把 3D 宠物整个盖住。
   */
  private buildStatic() {
    const L = this.L;
    const g = makeGraphics('GfxStatic', this.node);

    fillRoundRect(g, L.left, L.panelBottom, L.w - MARGIN * 2, L.panelH, 20, COLOR.panelGlass);
  }

  /**
   * 互动按钮上的图标。
   *
   * 异步加载，到货前按钮只有文字——这也是加载失败时的最终形态。
   * 图标是锦上添花，缺了不该让按钮不可用（铁律「软失败不死亡」）。
   */
  private buildIcons() {
    const L = this.L;

    ACTIONS.forEach((action, i) => {
      const node = makeNode(`Icon_${action.key}`, this.node, ICON_SIZE, ICON_SIZE);
      node.setPosition(this.buttonCenterX(i), L.btnY + BTN_H - ICON_SIZE / 2 - 10);

      const sprite = node.addComponent(Sprite);
      sprite.sizeMode = Sprite.SizeMode.CUSTOM;
      sprite.trim = false;
      node.active = false;

      resources.load(`icons/icon_${action.key}/spriteFrame`, SpriteFrame, (err, frame) => {
        if (!node.isValid) return;
        if (err || !frame) {
          console.warn(`[MainView] 图标 icon_${action.key} 加载失败，按钮保持纯文字`, err);
          return;
        }
        sprite.spriteFrame = frame;
        node.active = true;
      });
    });
  }

  private buildLabels() {
    const L = this.L;

    this.nameLabel = makeLabel('', this.node, { size: 26, color: COLOR.title, bold: true });
    this.nameLabel.node.setPosition(L.left, L.nameY);

    this.levelLabel = makeLabel('', this.node, { size: 16, color: COLOR.dim });
    this.levelLabel.node.setPosition(L.left, L.levelY);

    this.coinLabel = makeLabel('', this.node, { size: 20, color: COLOR.coin, align: 'right' });
    this.coinLabel.node.setPosition(L.right, L.nameY);

    this.pointLabel = makeLabel('', this.node, { size: 16, color: COLOR.point, align: 'right' });
    this.pointLabel.node.setPosition(L.right, L.levelY);

    this.bubbleLabel = makeLabel('', this.node, {
      size: 19,
      color: COLOR.text,
      align: 'center',
      width: L.w - 120,
    });
    this.bubbleLabel.node.setPosition(0, L.bubbleY);

    // 状态条的名称固定不动，数值每次重画时更新
    this.barValueLabels = BARS.map((bar, i) => {
      const cell = this.barCell(i);
      makeLabel(bar.name, this.node, { size: 15, color: COLOR.dim }).node.setPosition(
        cell.x,
        cell.y + 13,
      );
      const value = makeLabel('', this.node, { size: 15, color: COLOR.text, align: 'right' });
      value.node.setPosition(cell.x + L.barCellW, cell.y + 13);
      return value;
    });

    this.btnLabels = [];
    this.btnSubLabels = [];
    ACTIONS.forEach((action, i) => {
      const cx = this.buttonCenterX(i);
      const main = makeLabel(action.name, this.node, {
        size: 22,
        color: COLOR.accentText,
        align: 'center',
        bold: true,
      });
      // 图标占了按钮上半部，文字整体下移让位
      main.node.setPosition(cx, L.btnY + 30);
      this.btnLabels.push(main);

      const sub = makeLabel('', this.node, { size: 14, color: COLOR.accentText, align: 'center' });
      sub.node.setPosition(cx, L.btnY + 12);
      this.btnSubLabels.push(sub);
    });
  }

  /** 触摸区单独用空节点，和绘制解耦，按钮位置调整时不用同步改两处 */
  private buildHitAreas() {
    ACTIONS.forEach((action, i) => {
      const hit = makeNode(`Btn_${action.key}`, this.node, this.L.btnW, BTN_H);
      hit.setPosition(this.buttonCenterX(i), this.L.btnY + BTN_H / 2);

      // 按压反馈走和进度条同一条重绘链路，不额外起 tween，
      // 手指按下去按钮就下沉变深，松手才真正发请求
      hit.on(Node.EventType.TOUCH_START, () => this.setPressed(action.key), this);
      hit.on(Node.EventType.TOUCH_CANCEL, () => this.setPressed(''), this);
      hit.on(
        Node.EventType.TOUCH_END,
        () => {
          this.setPressed('');
          this.onInteract(action.key);
        },
        this,
      );
    });
  }

  private setPressed(key: string) {
    if (this.pressed === key) return;
    this.pressed = key;
    this.lastSignature = '';
  }

  private buttonCenterX(index: number): number {
    return this.L.left + index * (this.L.btnW + BTN_GAP) + this.L.btnW / 2;
  }

  // ---- 刷新 ----

  private onStoreChanged() {
    const pet = store.petView;
    if (!pet) return;

    if (this.nameLabel) this.nameLabel.string = pet.nickname || '还没起名字';
    if (this.levelLabel) {
      this.levelLabel.string = isMaxLevel(pet)
        ? `Lv${pet.level} 满级 · 亲密度 ${pet.intimacy}`
        : `Lv${pet.level} · 还需 ${pet.expToNext} 经验 · 亲密度 ${pet.intimacy}`;
    }
    if (this.coinLabel) this.coinLabel.string = `游戏币 ${store.wallet.gameCoin}`;
    if (this.pointLabel) this.pointLabel.string = `营销积分 ${store.wallet.marketingPoint}`;
    if (this.bubbleLabel) this.bubbleLabel.string = describeMood(pet);
  }

  /**
   * 重画进度条与按钮。
   * 每帧调用，但先比对签名——数值没有肉眼可见的变化时直接跳过，
   * 属性衰减是每小时几点的速度，真正需要重画的只有冷却秒数。
   */
  private redraw() {
    const pet = store.petView;
    const g = this.gfxDynamic;
    if (!pet || !g) return;

    const signature = this.buildSignature(pet);
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;

    g.clear();
    this.drawExpBar(g, pet);
    this.drawStatBars(g, pet);
    this.drawButtons(g);
  }

  /** 只把「看得出来的变化」编进签名：数值取整、冷却取秒 */
  private buildSignature(pet: PetStateView): string {
    const petId = store.activePetId;
    const cds = ACTIONS.map((a) => Math.ceil(cooldown.remainMs(petId, a.key) / 1000)).join(',');
    return [
      Math.round(pet.hunger),
      Math.round(pet.cleanliness),
      Math.round(pet.mood),
      Math.round(pet.stamina),
      pet.staminaMax,
      Math.round(expProgress(pet) * 200),
      cds,
      this.pressed,
    ].join('|');
  }

  private drawExpBar(g: Graphics, pet: PetStateView) {
    const L = this.L;
    const barW = L.w - MARGIN * 2;
    fillRoundRect(g, L.left, L.expBarY, barW, 8, 4, COLOR.track);
    const ratio = expProgress(pet);
    if (ratio > 0) fillRoundRect(g, L.left, L.expBarY, barW * ratio, 8, 4, COLOR.accent);
  }

  private drawStatBars(g: Graphics, pet: PetStateView) {
    const L = this.L;
    const barW = L.barCellW;

    BARS.forEach((bar, i) => {
      const cell = this.barCell(i);
      const x = cell.x;
      const y = cell.y - 10;
      const value = pet[bar.key];
      const max = bar.key === 'stamina' ? pet.staminaMax : 100;
      const ratio = max > 0 ? Math.min(1, value / max) : 0;

      fillRoundRect(g, x, y, barW, BAR_H, BAR_H / 2, COLOR.track);
      // 低于两成转红，让玩家一眼看出该照顾哪一项
      const color = ratio <= 0.2 ? COLOR.danger : bar.color;
      if (ratio > 0) fillRoundRect(g, x, y, barW * ratio, BAR_H, BAR_H / 2, color);

      const label = this.barValueLabels[i];
      if (label) {
        label.string =
          bar.key === 'stamina' ? `${Math.floor(value)} / ${pet.staminaMax}` : `${Math.round(value)}`;
        label.color = ratio <= 0.2 ? COLOR.danger : COLOR.text;
      }
    });
  }

  private drawButtons(g: Graphics) {
    const L = this.L;
    const petId = store.activePetId;

    ACTIONS.forEach((action, i) => {
      const x = L.left + i * (L.btnW + BTN_GAP);
      const remain = cooldown.remainMs(petId, action.key);
      const ready = remain <= 0 && !this.busy[action.key];
      const down = ready && this.pressed === action.key;

      // 按下时缩进 3px 并换成加深的主色，手感上「陷下去」
      const inset = down ? 3 : 0;
      const fill = !ready ? COLOR.disabled : down ? COLOR.accentPressed : COLOR.accent;
      fillRoundRect(g, x + inset, L.btnY + inset, L.btnW - inset * 2, BTN_H - inset * 2, 20, fill);

      const main = this.btnLabels[i];
      const sub = this.btnSubLabels[i];
      if (main) main.color = ready ? COLOR.accentText : COLOR.dim;
      if (sub) {
        sub.color = ready ? COLOR.accentText : COLOR.dim;
        sub.string = this.busy[action.key] ? '…' : remain > 0 ? `${Math.ceil(remain / 1000)}s` : '';
      }
    });
  }

  // ---- 交互 ----

  private async onInteract(action: PetAction) {
    if (this.busy[action]) return;

    // 本地冷却先拦一道，避免明知会失败还发请求（服务端 429 只作兜底）
    if (!cooldown.isReady(store.activePetId, action)) return;

    this.busy[action] = true;
    this.lastSignature = '';

    const res = await interact(action);
    this.busy[action] = false;
    this.lastSignature = '';

    if (!res.ok) {
      showError(res.error);
      return;
    }

    const data = res.data;
    if (this.stage) this.stage.react();

    const gained = gainedText(data.gained);
    if (gained) floatText(this.node, gained, COLOR.ok, this.L.btnY + BTN_H + 40);

    // 撞到每日上限时实发会少于标称值，得说清楚，否则玩家以为掉奖励
    if (data.capped) toast('今日收益已达上限，明天再来');

    if (data.levelUp && this.nameLabel) {
      pop(this.nameLabel.node, 1.3);
      floatText(this.node, '升级啦！', COLOR.warn, this.L.petCenterY);
    }
  }
}
