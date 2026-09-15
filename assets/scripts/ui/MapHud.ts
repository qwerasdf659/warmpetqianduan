/**
 * 家庭地图的固定 HUD，照 `docs/地图概念稿-00-仿竞品布局.png` 排布。
 *
 * 挂在 MapView 的**节点之外**（由 MapView 建成兄弟层并置于其上），
 * 所以不随地图滚动。分成四块：
 *
 *   左上：头像 + 等级徽章 + 经验条
 *   顶部：金币条 + 积分条（两个池必须一眼可分 → 靠色相，不靠文案）
 *   右侧：设置 / 音量 / 好友 / 相册，四个竖排圆按钮
 *   底部：图鉴 / 购置 / 领取 三个圆入口 + 礼盒 + 挑战，外加一条任务提示与跑马灯
 *
 * 纪律落点：
 * - **顶部必须避让微信胶囊**：`topInset()` 已按「设计分辨率 / 窗口」换算过，
 *   不能写死偏移，否则不同机型上被胶囊压住。
 * - **不静默**：没接后端的入口（好友/相册/挑战）点了给明确提示，不做成死按钮。
 *   概念稿里那几个角标是纯展示，但**这里是真按钮**，所以必须有反馈。
 * - **fitWidth 下可视高度随机型变**：顶部自上而下排、底部自下而上排，中间吃剩余。
 */

import { _decorator, Component, Node, Label, Graphics, Sprite, SpriteFrame, resources, Color, UITransform, view } from 'cc';
import {
  COLOR,
  topInsetLeft,
  makeNode,
  makeGraphics,
  makeLabel,
  fillRoundRect,
  fillRoundRectRim,
  softShadow,
  pillPlate,
} from './widgets';
import { toast } from './toast';
import store from '../core/store';
import { expProgress, isMaxLevel } from '../core/predict';
import { paintIconByKey, paintCatFace } from './mapIcons';

const { ccclass } = _decorator;

/**
 * 头像块。56 → 44 → **40**。
 *
 * 顶部 HUD 原本（头像 + 徽章 + 经验条竖排）吃掉屏幕高度的 **19%**，
 * 竞品同一块只占 **6%**。厚了三倍的后果是墙必须留得很高才放得下分区壁龛 ——
 * 墙占屏 45% 的真正原因在这里，不在墙本身。
 *
 * 现在整块 HUD 的高度 = 头像自身（徽章压在头像上、经验条挂在金币条下），
 * 40px 对 846 高的屏幕是 4.7%，加胶囊避让后接近竞品。
 */
const AVATAR = 40;
/** 经验条宽度。挂在金币条下方，所以和金币条同宽 */
const EXP_W = 96;
/** 货币药丸 */
const PILL_W = 132;
const PILL_H = 32;
/** 右侧圆按钮 */
const ROUND = 48;
const ROUND_GAP = 10;
/** 底部圆入口 */
const ENTRY = 56;
/** 任务条 */
const TASK_H = 44;
const MARGIN = 12;

/** 右侧竖排按钮。key 用于路由，label 是没图时的兜底字符 */
interface RoundBtn {
  key: string;
  glyph: string;
  name: string;
}

const ROUND_BTNS: RoundBtn[] = [
  { key: 'settings', glyph: '⚙', name: '设置' },
  { key: 'sound', glyph: '♪', name: '音量' },
  { key: 'friends', glyph: '👥', name: '好友' },
  { key: 'album', glyph: '📷', name: '相册' },
];

/** 底部入口。concept 图里是「图鉴 / 购置 / 领取」三个圆 + 右下「礼盒 / 挑战」 */
interface BottomEntry {
  key: string;
  name: string;
}

const BOTTOM_ENTRIES: BottomEntry[] = [
  { key: 'dex', name: '图鉴' },
  { key: 'shop', name: '购置' },
  { key: 'claim', name: '领取' },
];

const CORNER_ENTRIES: BottomEntry[] = [
  { key: 'gift', name: '礼盒' },
  { key: 'challenge', name: '挑战' },
];

@ccclass('MapHud')
export class MapHud extends Component {
  /** 入口点击回调，由 MapView / Main 注入路由。未注入时 HUD 自己给提示 */
  onEntry: ((key: string) => void) | null = null;

  private vw = 0;
  private vh = 0;

  private levelLabel: Label | null = null;
  private expBarHost: Node | null = null;
  private coinLabel: Label | null = null;
  private pointLabel: Label | null = null;
  private taskLabel: Label | null = null;
  private badgeHosts: Record<string, Node> = {};

  /** 上一帧的绘制签名，没变就不重画（规则：每帧变化先算签名） */
  private lastSig = '';

  onLoad() {
    const size = view.getVisibleSize();
    this.vw = size.width;
    this.vh = size.height;

    // 先所有 Graphics，再所有 Label —— 反过来会让底板盖住文字（规则：兄弟次序 = 层级）
    this.buildTopLeft();
    this.buildCurrency();
    this.buildRightRail();
    this.buildBottom();

    store.on('pet', this.refresh, this);
    store.on('wallet', this.refresh, this);
    store.on('daily', this.refresh, this);
    this.refresh();
  }

  onDestroy() {
    store.off('pet', this.refresh);
    store.off('wallet', this.refresh);
    store.off('daily', this.refresh);
  }

  update() {
    // 经验条和红点会随互动变化，用签名挡住无意义的重画
    const sig = this.buildSig();
    if (sig === this.lastSig) return;
    this.lastSig = sig;
    this.redraw();
  }

  private buildSig(): string {
    const pet = store.petView;
    return [
      pet ? pet.level : 0,
      pet ? Math.round(expProgress(pet) * 200) : 0,
      store.wallet.gameCoin,
      store.wallet.marketingPoint,
      store.dailyBadge,
      store.dexBadge,
    ].join('|');
  }

  // ---- 布局基准 ----

  /**
   * 顶部第一行的中心 y。
   *
   * 用 **`topInsetLeft()`**（只避状态栏）而不是 `topInset()`（避到胶囊下方）：
   * 头像和货币条都在左侧，而胶囊固定在右上角，两者可以并排。
   * 用 topInset 等于白让出 60px（屏高 7%），比竞品整个 HUD 还厚。
   */
  private topY(): number {
    return this.vh / 2 - topInsetLeft() - AVATAR / 2;
  }

  // ---- 左上：头像 + 等级 + 经验条 ----

  /**
   * 头像块。概念稿里是圆角方框内一只猫狗合影 + 下方等级徽章 + 经验条。
   * 没有头像图时留奶油底 + 爪印占位，不留空洞。
   */
  private buildTopLeft() {
    const x = -this.vw / 2 + MARGIN + AVATAR / 2;
    const y = this.topY();

    const host = makeNode('Avatar', this.node, AVATAR, AVATAR);
    host.setPosition(x, y);

    const g = host.addComponent(Graphics);
    softShadow(g, -AVATAR / 2, -AVATAR / 2, AVATAR, AVATAR, 14, 5);
    fillRoundRectRim(g, -AVATAR / 2, -AVATAR / 2, AVATAR, AVATAR, 14, COLOR.panel, 3);
    // 矢量猫脸兜底。空白框看起来像「加载失败」，而这是玩家第一眼看的位置；
    // 真头像图到货后 pic 会盖在上面（见下），所以两条路径都有画面。
    paintCatFace(g, AVATAR * 0.3, COLOR.accent);

    // 头像图是锦上添花，缺了不影响等级/经验的可读性（软失败不死亡）
    const pic = makeNode('Pic', host, AVATAR - 10, AVATAR - 10);
    const sprite = pic.addComponent(Sprite);
    sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    pic.active = false;
    resources.load('map/hud/avatar/spriteFrame', SpriteFrame, (err, frame) => {
      if (!pic.isValid || err || !frame) return;
      sprite.spriteFrame = frame as SpriteFrame;
      pic.active = true;
    });

    // 等级徽章**压在头像下沿上**（overlap，不额外占高度）—— 竞品就是这样。
    //
    // 演进过程：竖排（头像+徽章+经验条上下排 ≈ 104px）→ 横排在右侧（≈ 52px）
    // → 现在压在头像上（= 头像自身高度 40px）。
    // 每一步都是把「HUD 占屏」还给墙面，因为分区壁龛塞不进去正是墙压不下来的原因。
    const badgeW = 40;
    const badgeH = 16;
    const badge = makeNode('LvBadge', this.node, badgeW, badgeH);
    // y 取头像下沿往上收 2px → 徽章一半压在头像里，整块不超出头像范围
    badge.setPosition(x, y - AVATAR / 2 + badgeH / 2 - 2);
    const bg = badge.addComponent(Graphics);
    fillRoundRectRim(bg, -badgeW / 2, -badgeH / 2, badgeW, badgeH, badgeH / 2, COLOR.accent, 2);
    this.levelLabel = makeLabel('Lv1', badge, {
      size: 12, color: COLOR.accentText, align: 'center', bold: true,
    });
    this.levelLabel.node.setPosition(0, 0);

    // 经验条：**做成细条挂在金币条下方**，和金币条同一列。
    // 它不再自己占一行 —— 竞品的经验条也是贴着名字条的一根细线。
    this.expBarHost = new Node('ExpBar');
    this.expBarHost.parent = this.node;
    this.expBarHost.setPosition(this.currencyX() + EXP_W / 2, y - PILL_H / 2 - 5);
  }

  /** 金币条的左边缘 x。头像右侧起排，多处要用，抽出来避免两处写死 */
  private currencyX(): number {
    return -this.vw / 2 + MARGIN + AVATAR + 8;
  }

  /**
   * 经验条重画。
   *
   * 改成**一根 7px 高的细线**（原来 12px + 条内数字）。竞品的经验条也是
   * 贴着名字条的一根细线，不带数字 —— 数字占掉的高度换不来多少信息，
   * 而这里每一像素都要还给墙面。
   *
   * 满级时铺满并把颜色换成金色，不要停在一条空槽上让人以为坏了。
   * 具体数值不再印在条上，长按/进面板再看。
   */
  private redrawExp() {
    const host = this.expBarHost;
    if (!host || !host.isValid) return;
    host.removeAllChildren();

    const pet = store.petView;
    const w = EXP_W;
    const h = 7;
    const g = makeGraphics('g', host);
    fillRoundRect(g, -w / 2, -h / 2, w, h, h / 2, COLOR.track);
    const full = !!pet && isMaxLevel(pet);
    const ratio = full ? 1 : pet ? expProgress(pet) : 0;
    if (ratio > 0) {
      fillRoundRect(g, -w / 2, -h / 2, w * ratio, h, h / 2, full ? COLOR.coin : COLOR.ok);
    }
  }

  // ---- 顶部：双货币条 ----

  /**
   * 顶部只放**金币**一条。
   *
   * 积分挪到了底部（`buildPointBar`）—— 竞品顶部也只有两条窄药丸，
   * 我们原来把金币和积分并排塞在顶部，右边那条一直伸到屏幕中线以外，
   * 顶部显得很挤，而下方大片空间没人用。
   *
   * 两个池物理隔离是铁律，界面上仍必须一眼可分 —— 靠**色相**
   * （金币暖金 / 积分冷紫）而不是文案，文案会被玩家跳过。
   * 拆到上下两处之后色相区分更要保住。
   */
  private buildCurrency() {
    const y = this.topY();
    // 徽章已压回头像上、不再占右侧那一列，所以金币条紧贴头像即可
    const x = this.currencyX();

    const g = makeGraphics('CurrencyBg', this.node);
    pillPlate(g, x, y - PILL_H / 2, PILL_W, PILL_H, COLOR.panel);

    this.loadIcon('icon_coin', 20, COLOR.coin, x + 16, y);
    this.coinLabel = makeLabel('0', this.node, {
      size: 17, color: COLOR.title, align: 'right', bold: true,
    });
    this.coinLabel.node.setPosition(x + PILL_W - 10, y);
  }

  /**
   * 底部的积分条，放在**任务条与右下角入口之间那道空档**里。
   *
   * 这块空档原本是纯空白（任务条只占 56% 宽，右下角入口占 56px），
   * 正好放得下一条 108 宽的药丸，不用挤任何现有元素。
   * `x1`/`x2` 由调用方按实际布局算出并传进来 —— 不写死，
   * 任务条宽度或入口尺寸改了这里会自动跟着走。
   */
  private buildPointBar(y: number, x1: number, x2: number) {
    const w = Math.min(108, x2 - x1 - 16);
    if (w < 60) return; // 空档不够就不放，挤在一起比少一条更糟
    const x = x1 + (x2 - x1 - w) / 2;

    const g = makeGraphics('PointBg', this.node);
    pillPlate(g, x, y - PILL_H / 2, w, PILL_H, COLOR.panel);

    this.loadIcon('icon_point', 20, COLOR.point, x + 16, y);
    this.pointLabel = makeLabel('0', this.node, {
      size: 17, color: COLOR.title, align: 'right', bold: true,
    });
    this.pointLabel.node.setPosition(x + w - 10, y);
  }

  /** 单色剪影图标 + 运行时染色：一份图供两处用不同色，省一半资源 */
  private loadIcon(key: string, size: number, tint: Color, x: number, y: number) {
    const node = makeNode(`Icon_${key}`, this.node, size, size);
    node.setPosition(x, y);
    const sprite = node.addComponent(Sprite);
    sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    sprite.trim = false;
    sprite.color = tint;
    node.active = false;
    resources.load(`icons/${key}/spriteFrame`, SpriteFrame, (err, frame) => {
      if (!node.isValid || err || !frame) return;
      sprite.spriteFrame = frame as SpriteFrame;
      node.active = true;
    });
  }

  /**
   * 加载**多色**按钮图标（`resources/map/icons/icon_<key>.png`）。
   *
   * 和 `loadIcon` 的区别：**绝不染色**。那些图本身就是多色的
   * （礼盒紫+粉+金），`sprite.color` 是乘法混合，染一遍会把配色全毁掉。
   *
   * 成功后隐掉矢量兜底（`vector`），失败则保持矢量 —— 两条路径都有画面。
   * 矢量版是单色剪影，实测「色相种类 1/12」远不如竞品的 8/12，
   * 所以真图到货后要盖上去（见 skill `ui-visual-parity`）。
   */
  private loadColorIcon(key: string, size: number, x: number, y: number, vector: Node | null) {
    const node = makeNode(`ColorIcon_${key}`, this.node, size, size);
    node.setPosition(x, y);
    const sprite = node.addComponent(Sprite);
    sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    sprite.trim = false;
    node.active = false;
    resources.load(`map/icons/icon_${key}/spriteFrame`, SpriteFrame, (err, frame) => {
      if (!node.isValid || err || !frame) return;
      const f = frame as SpriteFrame;
      sprite.spriteFrame = f;

      // **按图的实际长宽比等比塞进 size×size**，不能直接用正方形尺寸 ——
      // 图标长宽比各不相同（icon_dex 是 128x75、icon_claim 是 95x128），
      // 硬塞正方形会把书压扁、把徽章拉长。
      // 尺寸直接读 `f.rect`，不要赋值后读 UITransform（那一帧还没更新）。
      const rw = f.rect.width || size;
      const rh = f.rect.height || size;
      const s = Math.min(size / rw, size / rh);
      const tr = node.getComponent(UITransform);
      if (tr) tr.setContentSize(rw * s, rh * s);

      node.active = true;
      if (vector && vector.isValid) vector.active = false;
    });
  }

  // ---- 右侧竖排圆按钮 ----

  private buildRightRail() {
    const x = this.vw / 2 - MARGIN - ROUND / 2;
    let y = this.topY() - AVATAR / 2 - 4;

    ROUND_BTNS.forEach((btn) => {
      this.makeRoundButton(btn, x, y);
      y -= ROUND + ROUND_GAP;
    });
  }

  private makeRoundButton(btn: RoundBtn, x: number, y: number) {
    const node = makeNode(`Round_${btn.key}`, this.node, ROUND, ROUND);
    node.setPosition(x, y);

    const g = node.addComponent(Graphics);
    softShadow(g, -ROUND / 2, -ROUND / 2, ROUND, ROUND, ROUND / 2, 5);
    fillRoundRectRim(g, -ROUND / 2, -ROUND / 2, ROUND, ROUND, ROUND / 2, COLOR.panel, 3);

    // 矢量图标画在**独立子节点**上，真图到货后能整块隐掉。
    // 画在按钮自己的 Graphics 上就没法单独隐 —— 会连圆底一起消失。
    //
    // emoji 字形由系统字体决定，安卓低端机可能整个缺字，那样这一排就成了
    // 空白圆圈 —— 所以矢量图形是主路径，字符只是最后兜底。
    const vec = makeNode(`Vec_${btn.key}`, node, ROUND, ROUND);
    const vg = vec.addComponent(Graphics);
    if (!paintIconByKey(vg, btn.key, ROUND * 0.28, COLOR.accent)) {
      const lbl = makeLabel(btn.glyph, node, { size: 22, color: COLOR.title, align: 'center' });
      lbl.node.setPosition(0, 0);
    }
    // 同底部入口：尺寸给足才留得住多色细节（见 makeEntry 的注释）
    this.loadColorIcon(btn.key, ROUND * 0.78, x, y, vec);

    node.on(Node.EventType.TOUCH_END, () => this.dispatch(btn.key, btn.name), this);
  }

  // ---- 底部：入口 + 任务条 ----

  private buildBottom() {
    const bottom = -this.vh / 2;

    // 任务条（最下面一行）：概念稿里是「购置任一道具 ✓」这种当前目标提示
    const taskY = bottom + MARGIN + TASK_H / 2;
    const taskW = this.vw * 0.56;
    const taskX = -this.vw / 2 + MARGIN + taskW / 2;
    const taskHost = makeNode('TaskBar', this.node, taskW, TASK_H);
    taskHost.setPosition(taskX, taskY);
    const tg = taskHost.addComponent(Graphics);
    softShadow(tg, -taskW / 2, -TASK_H / 2, taskW, TASK_H, 12, 5);
    fillRoundRectRim(tg, -taskW / 2, -TASK_H / 2, taskW, TASK_H, 12, COLOR.panel, 3);
    this.taskLabel = makeLabel('', taskHost, { size: 15, color: COLOR.text, width: taskW - 20 });
    this.taskLabel.node.setPosition(-taskW / 2 + 10, 0);
    // 任务条本身可点 → 进签到/任务面板
    taskHost.on(Node.EventType.TOUCH_END, () => this.dispatch('daily', '每日任务'), this);

    // 三个圆入口，排在任务条上方
    const entryY = taskY + TASK_H / 2 + 8 + ENTRY / 2;
    const totalW = BOTTOM_ENTRIES.length * ENTRY + (BOTTOM_ENTRIES.length - 1) * 16;
    let ex = -totalW / 2 + ENTRY / 2;
    BOTTOM_ENTRIES.forEach((e) => {
      this.makeEntry(e, ex, entryY);
      ex += ENTRY + 16;
    });

    // 右下角两个入口，竖排（概念稿里礼盒在上、挑战在下）
    const cx = this.vw / 2 - MARGIN - ENTRY / 2;
    CORNER_ENTRIES.forEach((e, i) => {
      this.makeEntry(e, cx, taskY + (CORNER_ENTRIES.length - 1 - i) * (ENTRY + 10));
    });

    // 积分条塞进「任务条右端」到「右下角入口左端」之间的空档
    this.buildPointBar(taskY, taskX + taskW / 2, cx - ENTRY / 2);
  }

  /** 底部圆入口：圆底 + 文字 + 红点容器。红点在 redraw 里按 store 的红点数刷 */
  private makeEntry(entry: BottomEntry, x: number, y: number) {
    const node = makeNode(`Entry_${entry.key}`, this.node, ENTRY, ENTRY);
    node.setPosition(x, y);

    const g = node.addComponent(Graphics);
    softShadow(g, -ENTRY / 2, -ENTRY / 2, ENTRY, ENTRY, 14, 5);
    fillRoundRectRim(g, -ENTRY / 2, -ENTRY / 2, ENTRY, ENTRY, 14, COLOR.panel, 3);

    // 图标 + 名字（图标在上、文字压在下沿）。概念稿里这几个入口都是「图 + 字」，
    // 只有文字的话五个圆圈长得一模一样，得逐个读字才分得清。
    // 矢量图标画在独立子节点上，真图到货后整块隐掉（同 makeRoundButton）
    const vec = makeNode(`Vec_${entry.key}`, node, ENTRY, ENTRY);
    vec.setPosition(0, 6);
    const vg = vec.addComponent(Graphics);
    const drew = paintIconByKey(vg, entry.key, ENTRY * 0.24, COLOR.accent);
    if (!drew) vec.active = false;

    const lbl = makeLabel(entry.name, node, {
      size: drew ? 12 : 15, color: COLOR.title, align: 'center', bold: true,
    });
    lbl.node.setPosition(0, drew ? -ENTRY / 2 + 10 : 0);

    // 真图盖在矢量之上。**尺寸要给足**：0.52 时图标在屏幕上只有约 29px，
    // 多色细节被降采样吃掉，实测「色相种类」只有 2/12（竞品 6/12）。
    // 0.74 之后细节才留得住，仍给文字留出下沿那一条。
    if (drew) this.loadColorIcon(entry.key, ENTRY * 0.74, x, y + 7, vec);

    // 红点容器：独立子节点，重画时整体清掉
    const badge = new Node('Badge');
    badge.parent = node;
    badge.setPosition(ENTRY / 2 - 6, ENTRY / 2 - 6);
    this.badgeHosts[entry.key] = badge;

    node.on(Node.EventType.TOUCH_END, () => this.dispatch(entry.key, entry.name), this);
  }

  // ---- 路由与刷新 ----

  /**
   * 入口点击分派。
   *
   * 没有注入 onEntry、或路由没认领这个 key 时，**必须给提示**——
   * 概念稿里那几个角标是纯展示所以不给可点暗示，但这里是真按钮，
   * 点了没反应玩家分不清「没做」和「坏了」（规则：静默失败 = 设计缺陷）。
   */
  private dispatch(key: string, name: string) {
    if (this.onEntry) {
      this.onEntry(key);
      return;
    }
    toast(`『${name}』还在开发中`);
  }

  /** store 变化时刷新文字。数值类只改 Label，不重建节点 */
  private refresh() {
    const pet = store.petView;

    if (this.levelLabel && this.levelLabel.node.isValid) {
      this.levelLabel.string = pet ? `Lv${pet.level}` : 'Lv-';
    }
    if (this.coinLabel && this.coinLabel.node.isValid) {
      this.coinLabel.string = `${store.wallet.gameCoin}`;
    }
    if (this.pointLabel && this.pointLabel.node.isValid) {
      this.pointLabel.string = `${store.wallet.marketingPoint}`;
    }
    if (this.taskLabel && this.taskLabel.node.isValid) {
      this.taskLabel.string = this.describeTask();
    }
    // 签名清空 → 下一帧重画经验条与红点
    this.lastSig = '';
  }

  /**
   * 当前任务提示。
   *
   * 取第一个「没领完」的任务，优先未签到 —— 概念稿那条「购置任一道具」
   * 就是这个位置。没有可做的事时说清楚已完成，别显示空白条。
   */
  private describeTask(): string {
    const daily = store.daily;
    if (!daily) return '正在同步今日任务…';

    if (daily.checkin && !daily.checkin.done) {
      return `今日签到可得 ${daily.checkin.todayReward} 金币`;
    }
    const claimable = (daily.tasks || []).filter((t) => t.done && !t.claimed)[0];
    if (claimable) return `『${claimable.name}』已完成，可领 ${claimable.coin} 金币`;

    const doing = (daily.tasks || []).filter((t) => !t.done)[0];
    if (doing) return `${doing.name}（${doing.progress}/${doing.target}）`;

    return '今日任务都完成啦';
  }

  private redraw() {
    this.redrawExp();
    this.redrawBadges();
  }

  /** 红点。数字红点比纯圆点有用——玩家能预判要点几下 */
  private redrawBadges() {
    const counts: Record<string, number> = {
      dex: store.dexBadge,
      claim: store.dailyBadge,
      daily: store.dailyBadge,
    };

    Object.keys(this.badgeHosts).forEach((key) => {
      const host = this.badgeHosts[key];
      if (!host || !host.isValid) return;
      host.removeAllChildren();
      const n = counts[key] || 0;
      if (n <= 0) return;

      const r = 9;
      const g = makeGraphics('dot', host);
      g.fillColor = COLOR.danger;
      g.circle(0, 0, r);
      g.fill();
      const lbl = makeLabel(n > 9 ? '9+' : `${n}`, host, {
        size: 11, color: COLOR.accentText, align: 'center', bold: true,
      });
      lbl.node.setPosition(0, 0);
    });
  }
}
