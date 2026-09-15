/**
 * 运行时搭 UI 的小工具。
 *
 * 美术资源还没到位，所有界面先用 Graphics + Label 画出来。
 * 这不只是权宜之计：等图进来了，替换的是绘制细节，
 * 布局、交互、数据绑定都不用动。
 *
 * 合批要点（规则要求整屏 DrawCall ≤ 50）：
 * Cocos 按渲染顺序合批，中间插入不同类型的组件会断批。
 * 所以各界面统一「先挂完所有 Graphics、再挂所有 Label」，
 * 而不是按视觉分组一块一块地建节点。
 */

import {
  Node,
  Label,
  LabelOutline,
  TTFFont,
  resources,
  UITransform,
  Graphics,
  Color,
  Vec3,
  UIOpacity,
  Layers,
  tween,
  view,
  screen,
} from 'cc';
import { getMenuButtonRect } from '../platform/minigame';

/**
 * 奶茶米色系（2026-08-27 定稿，见 docs/06 §2.2）。
 *
 * 这是**浅底**方案：底色是暖米白，文字是深棕。
 * 改配色时注意成对改——浅底配浅字会直接看不见。
 */
export const COLOR = {
  /** 底色，由 PetStage 的 2D 背景/相机清屏给出 */
  bg: new Color(242, 228, 208, 255),
  /** 面板，比底色更白一点 */
  panel: new Color(255, 252, 247, 255),
  /** 略透一点，让底下的宠物/背景透出来，避免 UI 像一块贴上去的板子 */
  panelGlass: new Color(255, 252, 247, 235),
  panelLight: new Color(247, 238, 226, 255),
  /** 进度条底槽 */
  track: new Color(236, 226, 212, 255),
  /** 主色：焦糖橘 */
  accent: new Color(217, 160, 91, 255),
  accentPressed: new Color(192, 138, 71, 255),
  /** 主色按钮上的文字用近白色，深棕在焦糖上对比不够 */
  accentText: new Color(255, 249, 240, 255),
  disabled: new Color(214, 203, 188, 255),
  /** 深棕，浅底上的主标题 */
  title: new Color(74, 55, 40, 255),
  text: new Color(106, 82, 61, 255),
  dim: new Color(154, 133, 112, 255),
  ok: new Color(107, 191, 123, 255),
  warn: new Color(224, 154, 51, 255),
  danger: new Color(216, 94, 80, 255),
  coin: new Color(230, 176, 60, 255),
  /** 营销积分用冷紫，和金币的暖金拉开——两个池必须一眼可分 */
  point: new Color(139, 125, 191, 255),
  /**
   * 厚亮边。竞品里那种「有分量」的观感一半来自这条边——
   * 一圈近白的描边把控件从背景上摘出来，比加深阴影管用。
   */
  rim: new Color(255, 255, 255, 235),
  /** 投影。透明度很低，靠叠三层出柔和过渡（见 softShadow） */
  shadow: new Color(120, 92, 66, 26),
};

/** 四条状态条各自的配色，低于阈值时转警示色 */
export const STAT_COLOR = {
  hunger: new Color(232, 163, 61, 255),
  cleanliness: new Color(91, 163, 217, 255),
  mood: new Color(238, 143, 160, 255),
  stamina: new Color(124, 196, 127, 255),
};

/**
 * 顶部安全区高度（设计分辨率单位）。**把 UI 推到胶囊下方**。
 *
 * 微信胶囊按钮的坐标是屏幕物理像素，要按「设计分辨率 / 实际窗口」换算，
 * 否则不同机型上会算偏。
 *
 * ⚠️ 只有**横跨整个屏幕宽度**的顶部元素才需要这个值。
 * 靠左的元素（头像、货币条）应该用 `topInsetLeft()` —— 胶囊只在右侧，
 * 左边和它并排完全没问题，白白让出整条胶囊高度是纯浪费。
 */
export function topInset(): number {
  try {
    const visible = view.getVisibleSize();
    const win = screen.windowSize;
    const scale = win.height > 0 ? visible.height / win.height : 1;
    return getMenuButtonRect().bottom * scale + 8;
  } catch (e) {
    return 60;
  }
}

/**
 * 左侧顶部安全区。**只避让状态栏，不避让胶囊**。
 *
 * 胶囊固定在右上角，所以左上角的头像/货币条可以和它同一行。
 * 我们曾对整个 HUD 用 `topInset()`，等于让出了 60px（屏高 7%），
 * 比竞品**整个** HUD 还厚 —— 而竞品的头像就是和胶囊并排的。
 *
 * 取胶囊顶部（而不是底部）作为基准：状态栏在胶囊之上，避到那里就够了。
 */
export function topInsetLeft(): number {
  try {
    const visible = view.getVisibleSize();
    const win = screen.windowSize;
    const scale = win.height > 0 ? visible.height / win.height : 1;
    return getMenuButtonRect().top * scale + 4;
  } catch (e) {
    return 20;
  }
}

/**
 * 全局界面字体（Resource Han Rounded CN Bold，思源黑体的圆角衍生版）。
 *
 * **为什么要自带字体**：系统黑体笔画细、末端是方的，`isBold` 只是伪加粗。
 * 实测招牌文字区域的「过渡像素占比」只有竞品的三分之一
 * （19.7% vs 57.7%，量法见 skill `ui-visual-parity`），
 * 观感就是「文本框贴上去的」而不是「画进画面里的」。
 * 圆体 Bold 的笔画本身有肉，这是靠参数补不出来的。
 *
 * 体积：完整字库 13.3MB → 子集化后 **237KB**（只保留工程实际用到的 775 个字符）。
 * 子集化流程见 `.build/scripts/subset-font.mjs`，
 * **加了新文案要重跑一次**，否则新字会变成空白/方框（不报错）。
 *
 * 许可：SIL OFL 1.1，允许嵌入与随游戏分发，许可证随字体放在
 * `assets/resources/fonts/LICENSE-ResourceHanRounded.txt`（OFL 要求保留）。
 */
const UI_FONT_PATH = 'fonts/rhr-bold';
let uiFont: TTFFont | null = null;
/** 字体到货前建的 Label，到货后要回填 —— 否则它们会一直是系统字体 */
const pendingLabels: Label[] = [];

/**
 * 预加载界面字体。**在 bootstrap 阶段调一次**，早于任何界面创建。
 *
 * 失败时不抛异常、不阻塞启动：字体是观感增强，不是功能依赖。
 * 加载不到就继续用系统字体，界面照样可用 —— 这是铁律「软失败不死亡」。
 */
export function preloadUIFont(done?: () => void): void {
  resources.load(UI_FONT_PATH, TTFFont, (err, font) => {
    if (err || !font) {
      console.warn('[widgets] 界面字体加载失败，退回系统字体', err);
    } else {
      uiFont = font;
      // 回填已建好的 Label。字体是异步来的，而加载界面的文字在它之前就建好了，
      // 不回填的话首屏那几行永远是系统字体、和后面的界面不一致。
      for (const lb of pendingLabels) {
        if (lb && lb.isValid) lb.font = font;
      }
    }
    pendingLabels.length = 0;
    if (done) done();
  });
}

export function makeNode(name: string, parent: Node, width = 0, height = 0): Node {
  const node = new Node(name);
  // new Node() 默认是 DEFAULT 层（3D 层）。UI 节点必须显式标成 UI_2D，
  // 否则 3D 相机会把它们也算进可见范围，和 3D 场景混在一起渲染。
  node.layer = Layers.Enum.UI_2D;
  const tr = node.addComponent(UITransform);
  if (width || height) tr.setContentSize(width, height);
  node.parent = parent;
  return node;
}

export function makeGraphics(name: string, parent: Node): Graphics {
  const node = makeNode(name, parent);
  return node.addComponent(Graphics);
}

export interface LabelOptions {
  size?: number;
  color?: Color;
  align?: 'left' | 'center' | 'right';
  width?: number;
  bold?: boolean;
}

export function makeLabel(text: string, parent: Node, opts: LabelOptions = {}): Label {
  const node = makeNode('Label', parent);
  const label = node.addComponent(Label);
  label.string = text;
  label.fontSize = opts.size || 14;
  label.lineHeight = (opts.size || 14) + 4;
  label.color = opts.color || COLOR.text;
  // 自带圆体已经是 Bold 字重，再叠伪粗会糊成一团（小字尤其明显）。
  // 所以 `bold` 只在退回系统字体时生效 —— 那时它是唯一的加重手段。
  label.isBold = !!opts.bold && !uiFont;
  if (uiFont) {
    label.font = uiFont;
  } else {
    // 字体还没到货：先记下来，`preloadUIFont` 的回调里统一回填
    pendingLabels.push(label);
  }
  label.horizontalAlign =
    opts.align === 'right'
      ? Label.HorizontalAlign.RIGHT
      : opts.align === 'center'
        ? Label.HorizontalAlign.CENTER
        : Label.HorizontalAlign.LEFT;
  label.verticalAlign = Label.VerticalAlign.CENTER;

  const tr = node.getComponent(UITransform);
  if (opts.width) {
    label.overflow = Label.Overflow.RESIZE_HEIGHT;
    label.enableWrapText = true;
    tr.setContentSize(opts.width, label.lineHeight);
  }

  // 锚点跟着对齐方式走。默认锚点是 (0.5, 0.5)，
  // 「左对齐 + 摆在左边距上」会让文字有一半跑到边距外面去，右对齐同理会被屏幕裁掉。
  // 这样调用方传的坐标就是文字那一侧的边，而不是文字的中心。
  tr.setAnchorPoint(opts.align === 'right' ? 1 : opts.align === 'center' ? 0.5 : 0, 0.5);
  return label;
}

/**
 * 文字描边。**这是「字画进画面里」和「字贴在画面上」的分界。**
 *
 * 实测竞品招牌文字区域：笔画像素(亮度<110) 4.8%、字与底之间的过渡像素 68.2%；
 * 我们没描边的版本是 0.0% 和 2.6% —— 纯色细笔画直接从字色跳到牌面色，
 * 没有任何过渡，于是读成「文本框贴上去的」。
 * 加描边等于给每个笔画补一圈过渡像素，同时把字从牌面上摘出来。
 *
 * `width` 是**半径**而不是直径，2 就已经很明显；小字给 2、标题给 3。
 * 描边色要用**同色系更深一档**，不要用黑色（会脏，见 skill game-art-from-ai）。
 */
export function outlineLabel(label: Label, color: Color, width = 2): void {
  const o = label.node.addComponent(LabelOutline);
  o.color = color;
  o.width = width;
}

/**
 * 填充圆角矩形。
 *
 * 用引擎自带的 Graphics.roundRect——Cocos 的 Graphics 只是长得像 Canvas 2D，
 * 并没有 arcTo，拿 Canvas 的写法套过来会在运行时直接抛异常、
 * 而且是「画到一半停住」这种很难一眼看出原因的失败。
 *
 * 半径超过半宽/半高时引擎不会自己夹紧，这里先 clamp 一下。
 */
export function fillRoundRect(
  g: Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  color: Color,
): void {
  if (w <= 0 || h <= 0) return;
  g.fillColor = color;
  g.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
  g.fill();
}

/**
 * 柔和投影。
 *
 * Cocos 的 Graphics 没有模糊,所以用**三层递增的半透明圆角矩形**近似:
 * 每层比上一层大一点、往下偏一点,叠出来的边缘就是渐变的。
 * 单层实心投影会像贴了一块灰纸板,这是竞品 UI 和「代码画的方块」之间
 * 差别最大的一处,而成本只有三次 fill。
 *
 * 必须画在被投影的形状**之前**,Graphics 是按调用顺序叠的。
 */
export function softShadow(
  g: Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  spread = 6,
): void {
  if (w <= 0 || h <= 0) return;
  for (let i = 3; i >= 1; i--) {
    const grow = (spread * i) / 3;
    fillRoundRect(g, x - grow, y - grow - spread * 0.5, w + grow * 2, h + grow * 2, r + grow, COLOR.shadow);
  }
}

/**
 * 带厚亮边的圆角矩形:先画大一圈的边色,再把填充盖在中间。
 *
 * 用「大一圈再盖回来」而不是 Graphics 的 stroke,是因为 stroke 的线宽是
 * 沿路径居中的,圆角处会和填充错开半个线宽,放大看能看到毛边。
 */
export function fillRoundRectRim(
  g: Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: Color,
  rimWidth = 3,
  rim: Color = COLOR.rim,
): void {
  if (w <= 0 || h <= 0) return;
  fillRoundRect(g, x - rimWidth, y - rimWidth, w + rimWidth * 2, h + rimWidth * 2, r + rimWidth, rim);
  fillRoundRect(g, x, y, w, h, r, fill);
}

/**
 * 药丸计数器的底:全圆角 + 厚亮边 + 投影。
 *
 * 高度的一半就是圆角半径,所以两端是半圆。竞品的货币栏全是这个形状,
 * 因为它和方角面板放在一起时层级最分明。
 */
export function pillPlate(
  g: Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: Color,
): void {
  softShadow(g, x, y, w, h, h / 2, 5);
  fillRoundRectRim(g, x, y, w, h, h / 2, fill, 3);
}

/**
 * 收益飘字。
 * 用完自己销毁，调用方不需要持有引用——互动是高频操作，
 * 忘记回收的话节点会一直堆积。
 */
export function floatText(parent: Node, text: string, color: Color, startY: number): void {
  const label = makeLabel(text, parent, { size: 20, color, align: 'center', bold: true });
  label.node.setPosition(0, startY);
  const opacity = label.node.addComponent(UIOpacity);

  tween(label.node).to(0.9, { position: new Vec3(0, startY + 90, 0) }).start();
  tween(opacity)
    .delay(0.35)
    .to(0.55, { opacity: 0 })
    .call(() => label.node.destroy())
    .start();
}

/** 数值变化时的强调抖动，用于升级、领奖 */
export function pop(node: Node, scale = 1.25): void {
  tween(node)
    .to(0.12, { scale: new Vec3(scale, scale, 1) })
    .to(0.18, { scale: new Vec3(1, 1, 1) })
    .start();
}
