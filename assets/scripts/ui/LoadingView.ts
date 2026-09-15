/**
 * 冷启动加载页。
 *
 * 用定稿首页海报（`docs/首页设计稿-8-定稿-进度条版.png`，缩图为 `assets/boot/loading.jpg`）
 * 作整屏背景，并在海报里那条写死「62%」的进度条**原位**盖一条真进度条，
 * 进度、百分比、文案全部实时算——海报只提供画面。
 *
 * 为什么图放单独的 `boot` bundle 而不是 `resources`：
 * `resources` 上线要配成**远程包**（见 `docs/小游戏包体与远程资源配置.md`），
 * 冷启动那一刻它还没下下来。加载图必须随主包走、开机即显，所以单独一个本地 bundle。
 *
 * 海报 900×1350（0.667）比设计分辨率 720×1280（0.5625）「胖」，
 * cover 铺满会裁掉两侧四个角标卡片，所以按**宽度适配**，上下留边用海报边缘的暖棕，
 * 看起来像给海报加了个暖色边框。
 *
 * 规则 `first-screen-and-loading` 的三条硬要求在这里实现：
 * 1. 进度按 `core/bootstrap.ts` 的真实开销加权，且**渐近爬升、永不回退、永不停住**；
 * 2. 文案两行——主文案用世界观词，细节行给真实阶段 + 计数；
 * 3. 清缓存**必须白名单**，绝不能清 `warmpet_pending_ops`（未确认操作的补偿日志）。
 */

import {
  _decorator,
  Component,
  Node,
  Sprite,
  SpriteFrame,
  UITransform,
  Graphics,
  Label,
  Color,
  UIOpacity,
  tween,
  Tween,
  view,
  sys,
  assetManager,
} from 'cc';
import { makeNode, makeLabel, outlineLabel, fillRoundRect, softShadow } from './widgets';
import { TOKEN_KEY, USER_ID_KEY, COOLDOWN_KEY } from '../net/config';

const { ccclass } = _decorator;

/** 海报自然尺寸（与 boot/loading.jpg 一致），只用于求宽高比 */
const POSTER_W = 900;
const POSTER_H = 1350;
const POSTER_RATIO = POSTER_W / POSTER_H;

/**
 * 海报里进度条胶囊的位置（占整图比例，量图得到）。
 * 我们的条要盖住它，所以画得比它大一圈——原条的描边和「62%」不能外露。
 */
const BAR_CENTER_X = 0.5;
const BAR_CENTER_Y = 0.89;
const BAR_W_FRAC = 0.515;
const BAR_H_FRAC = 0.067;
const BAR_W_MASK = 1.07;
const BAR_H_MASK = 1.22;

/** 上下留边的暖棕，取自海报上下边缘实测色（~110,78,41） */
const FRAME_BG = new Color(112, 79, 42, 255);
/** 进度条配色：白外沿 + 金环 + 奶油槽 + 焦糖填充，贴合海报观感 */
const RIM_WHITE = new Color(250, 244, 230, 255);
const RIM_GOLD = new Color(201, 152, 80, 255);
const TRACK = new Color(244, 230, 205, 255);
const FILL = new Color(224, 158, 74, 255);
const FILL_HI = new Color(240, 190, 120, 255);
const TEXT_LIGHT = new Color(255, 250, 242, 255);
const TEXT_STROKE = new Color(92, 63, 34, 225);
const DANGER = new Color(232, 138, 124, 255);

/**
 * 启动阶段 → 进度天花板。
 *
 * 键是 `core/bootstrap.ts` 的 `onProgress` 实参（那些是**给开发看的词**，
 * 不直接显示给玩家），区间按规则表加权：对表 8 / 登录 25 / 补偿 40 /
 * 宠物 70 / 数据 92，余下 92→100 留给将来的远程 Asset Bundle。
 */
interface StageDef {
  /** 该阶段的进度天花板（0~1），阶段内渐近逼近但不到达 */
  ceiling: number;
  /** 细节行：真实阶段的玩家化说法 */
  detail: string;
}
const STAGES: Record<string, StageDef> = {
  对时中: { ceiling: 0.08, detail: '正在对表' },
  登录中: { ceiling: 0.25, detail: '正在开门' },
  同步进度: { ceiling: 0.4, detail: '正在补记账本' },
  加载宠物: { ceiling: 0.7, detail: '正在唤醒小家伙' },
  加载数据: { ceiling: 0.92, detail: '正在摆好家当' },
  完成: { ceiling: 1, detail: '就要好了' },
};
/** 细节行的计数分母，等于上面的阶段数——玩家靠它确认进度真的在推进 */
const STAGE_TOTAL = Object.keys(STAGES).length;
const STAGE_ORDER = Object.keys(STAGES);

/** 主文案用世界观词，不写「服务器」 */
const MAIN_TEXT = '小屋正在开门，请稍等…';
/** 起始进度：别从 0 开始，0% 会让人觉得没动 */
const START_PROGRESS = 0.04;
/** 渐近速率：每秒补上「与天花板差距」的这个比例 */
const CRAWL_RATE = 1.6;
/** 「清缓存」提示延迟出现的秒数。从第一秒就写「长时间无法进入」会吓到玩家 */
const HINT_DELAY = 8;

@ccclass('LoadingView')
export class LoadingView extends Component {
  private posterSprite: Sprite | null = null;
  private barG: Graphics | null = null;
  private pctLabel: Label | null = null;
  private mainLabel: Label | null = null;
  private detailLabel: Label | null = null;
  private hintLabel: Label | null = null;

  /** 当前进度与当前阶段天花板。爬升在 update() 里做，保证永不回退、永不停住 */
  private progress = START_PROGRESS;
  private ceiling = START_PROGRESS;
  private stageIndex = 0;
  private crawling = true;
  private finishing = false;
  private failed = false;
  private disposed = false;
  private elapsed = 0;
  private hintShown = false;
  /** 失败态下 fail() 传进来的重试回调，清缓存后直接复用它 */
  private retryFn: (() => void) | null = null;
  /** 已显示的整数百分比，用来避免每帧重画 */
  private shownPct = -1;

  /** 进度条在节点坐标系里的中心与尺寸，layout() 按可视区算出 */
  private barX = 0;
  private barY = 0;
  private barW = 0;
  private barH = 0;

  onLoad() {
    this.build();
    this.loadPoster();
  }

  onDestroy() {
    this.disposed = true;
    Tween.stopAllByTarget(this.node);
  }

  update(dt: number) {
    if (this.disposed) return;

    // 清缓存提示延迟淡入
    if (!this.hintShown && !this.failed) {
      this.elapsed += dt;
      if (this.elapsed >= HINT_DELAY) this.showHint();
    }

    if (!this.crawling) return;
    // 渐近：朝天花板爬，永远差一点。阶段完成时 setStage 会把天花板抬上去
    const gap = this.ceiling - this.progress;
    if (gap > 0.0001) {
      this.progress += gap * Math.min(1, CRAWL_RATE * dt);
      this.drawBar();
    }
  }

  private build() {
    const vs = view.getVisibleSize();

    const tr = this.node.getComponent(UITransform) || this.node.addComponent(UITransform);
    tr.setContentSize(vs.width, vs.height);
    tr.setAnchorPoint(0.5, 0.5);

    // 整屏兜底底色：海报是宽度适配的，上下留边、以及海报读出来之前都露这个色。
    // 画得比屏幕大一圈，横竖屏切换或安全区变化时不会露出黑边。
    const bg = this.node.addComponent(Graphics);
    bg.fillColor = FRAME_BG;
    bg.rect(-vs.width, -vs.height, vs.width * 2, vs.height * 2);
    bg.fill();

    const posterNode = makeNode('Poster', this.node);
    this.posterSprite = posterNode.addComponent(Sprite);
    this.posterSprite.sizeMode = Sprite.SizeMode.CUSTOM;
    this.posterSprite.type = Sprite.Type.SIMPLE;

    const barNode = makeNode('Bar', this.node);
    this.barG = barNode.addComponent(Graphics);

    // 百分比印在条内居中——底部合规块很挤，放条外要多占一行
    this.pctLabel = makeLabel('0%', barNode, {
      size: 30,
      color: TEXT_LIGHT,
      align: 'center',
      bold: true,
    });
    this.outline(this.pctLabel, new Color(150, 96, 42, 255), 3);

    this.mainLabel = makeLabel(MAIN_TEXT, this.node, {
      size: 19,
      color: TEXT_LIGHT,
      align: 'center',
      bold: true,
    });
    this.outline(this.mainLabel, TEXT_STROKE, 3);

    this.detailLabel = makeLabel('', this.node, { size: 15, color: TEXT_LIGHT, align: 'center' });
    this.outline(this.detailLabel, TEXT_STROKE, 2);

    this.hintLabel = makeLabel('长时间无法进入？点这里清理缓存重试', this.node, {
      size: 13,
      color: TEXT_LIGHT,
      align: 'center',
    });
    this.outline(this.hintLabel, TEXT_STROKE, 2);
    this.hintLabel.node.addComponent(UIOpacity).opacity = 0;
    this.hintLabel.node.active = false;

    this.layout();
    this.drawBar();
    this.setStage(STAGE_ORDER[0]);
  }

  /**
   * 文字描边，保证压在花哨的海报上任何位置都读得清。
   * 实现收敛到 `widgets.outlineLabel`（地图招牌也用同一套），
   * 这里保留薄封装是因为本文件有五处调用、参数顺序固定。
   */
  private outline(label: Label, color: Color, width: number) {
    outlineLabel(label, color, width);
  }

  /**
   * 布局。
   *
   * 纵向一律「顶部自上而下、底部自下而上」：文案与提示都从进度条往下推，
   * 不写死屏幕偏移——`fitWidth` 下可视高度随机型变，写死会让元素互相撞。
   */
  private layout() {
    const vs = view.getVisibleSize();
    let dw: number;
    let dh: number;
    if (vs.width / vs.height > POSTER_RATIO) {
      dh = vs.height;
      dw = dh * POSTER_RATIO;
    } else {
      dw = vs.width;
      dh = dw / POSTER_RATIO;
    }

    if (this.posterSprite) {
      this.posterSprite.getComponent(UITransform)!.setContentSize(dw, dh);
      this.posterSprite.node.setPosition(0, 0);
    }

    // 海报中心在 (0,0)：把「从上比例」换成节点坐标（y 向上为正）
    this.barW = BAR_W_FRAC * dw * BAR_W_MASK;
    this.barH = BAR_H_FRAC * dh * BAR_H_MASK;
    this.barX = (BAR_CENTER_X - 0.5) * dw;
    this.barY = (0.5 - BAR_CENTER_Y) * dh;

    if (this.barG) this.barG.node.setPosition(this.barX, this.barY);
    if (this.pctLabel) {
      this.pctLabel.fontSize = Math.max(16, Math.round(this.barH * 0.46));
      this.pctLabel.lineHeight = this.pctLabel.fontSize + 2;
    }

    // 两行文案在进度条上方（条下方是海报自带的合规块，不能压）
    const top = this.barY + this.barH / 2;
    if (this.mainLabel) this.mainLabel.node.setPosition(0, top + 46);
    if (this.detailLabel) this.detailLabel.node.setPosition(0, top + 24);
    if (this.hintLabel) this.hintLabel.node.setPosition(0, this.barY - this.barH / 2 - 18);
  }

  private drawBar(danger = false) {
    if (this.disposed) return;
    const g = this.barG;
    if (!g || !g.isValid) return;
    const w = this.barW;
    const h = this.barH;
    if (w <= 0 || h <= 0) return;
    const r = h / 2;
    const x = -w / 2;
    const y = -h / 2;

    g.clear();
    softShadow(g, x, y, w, h, r, 6);
    fillRoundRect(g, x - 5, y - 5, w + 10, h + 10, r + 5, RIM_WHITE);
    fillRoundRect(g, x - 2, y - 2, w + 4, h + 4, r + 2, RIM_GOLD);
    fillRoundRect(g, x, y, w, h, r, TRACK);

    const pad = Math.max(4, h * 0.12);
    const iw = w - pad * 2;
    const ih = h - pad * 2;
    const v = Math.max(0, Math.min(1, this.progress));
    // 至少留一个圆头，0% 时不会是一条缝
    const fw = Math.max(ih, iw * v);
    fillRoundRect(g, x + pad, y + pad, fw, ih, ih / 2, danger ? DANGER : FILL);
    if (!danger) {
      // 顶部高光，做出一点圆润的立体感
      fillRoundRect(g, x + pad, y + h * 0.5, fw, ih * 0.3, ih * 0.15, FILL_HI);
    }

    const pct = Math.floor(v * 100);
    if (this.pctLabel && pct !== this.shownPct && !this.failed) {
      this.shownPct = pct;
      this.pctLabel.string = `${pct}%`;
    }
  }

  private loadPoster() {
    assetManager.loadBundle('boot', (err, bundle) => {
      if (err || this.disposed || !bundle) return;
      bundle.load('loading/spriteFrame', SpriteFrame, (e, sf: SpriteFrame) => {
        if (e || this.disposed || !this.posterSprite) return;
        this.posterSprite.spriteFrame = sf;
      });
    });
  }

  /**
   * 阶段推进：把天花板抬到该阶段的上限，并更新细节行。
   * 进度只由 update() 渐近爬升，这里不直接写 progress——避免数字跳一下又停住。
   */
  setStage(stage: string) {
    if (this.failed || this.finishing) return;
    const def = STAGES[stage];
    if (!def) return;

    const idx = STAGE_ORDER.indexOf(stage);
    if (idx >= 0) this.stageIndex = idx;
    // 永不回退：天花板只升不降
    this.ceiling = Math.max(this.ceiling, def.ceiling);
    if (this.detailLabel) {
      this.detailLabel.string = `${def.detail} (${this.stageIndex + 1}/${STAGE_TOTAL})`;
    }
  }

  /**
   * 首屏数据就绪：进度条快速走满 → 在加载页**下方**建好主界面 → 淡出销毁。
   * 先建界面再淡出，中间就不会闪一下黑屏。
   */
  finish(done: () => void) {
    if (this.finishing) return;
    this.finishing = true;
    this.crawling = false;
    this.hideHint();

    const fill = { v: this.progress };
    tween(fill)
      .to(
        0.3,
        { v: 1 },
        {
          easing: 'quadOut',
          onUpdate: () => {
            this.progress = fill.v;
            this.drawBar();
          },
        },
      )
      .call(() => {
        if (this.disposed) return;
        if (this.detailLabel) this.detailLabel.string = '';
        if (this.mainLabel) this.mainLabel.string = '欢迎回来！';
        done();
        // 主界面刚挂上来是同级节点，把加载页提到最上层，淡出才看得见
        const parent = this.node.parent;
        if (parent) this.node.setSiblingIndex(parent.children.length - 1);
        const op = this.node.getComponent(UIOpacity) || this.node.addComponent(UIOpacity);
        tween(op)
          .delay(0.12)
          .to(0.35, { opacity: 0 })
          .call(() => {
            if (this.node.isValid) this.node.destroy();
          })
          .start();
      })
      .start();
  }

  /**
   * 致命失败（基本只有登录失败）。
   * 不弹窗、不黑屏：原地把条换成警示色 + 一行人话 + 点击重试，界面还活着玩家就不焦虑。
   */
  fail(message: string, retry: () => void) {
    this.failed = true;
    this.crawling = false;
    this.retryFn = retry;
    this.drawBar(true);
    if (this.pctLabel) this.pctLabel.string = '重试';
    if (this.mainLabel) this.mainLabel.string = message;
    if (this.detailLabel) this.detailLabel.string = '点击屏幕重新连接';
    this.showHint();

    this.node.once(
      Node.EventType.TOUCH_END,
      () => {
        if (this.disposed) return;
        this.failed = false;
        this.crawling = true;
        this.shownPct = -1;
        this.progress = START_PROGRESS;
        this.ceiling = START_PROGRESS;
        this.stageIndex = 0;
        if (this.mainLabel) this.mainLabel.string = MAIN_TEXT;
        this.drawBar();
        this.setStage(STAGE_ORDER[0]);
        retry();
      },
      this,
    );
  }

  private showHint() {
    if (this.hintShown || !this.hintLabel) return;
    this.hintShown = true;
    const node = this.hintLabel.node;
    node.active = true;
    const op = node.getComponent(UIOpacity)!;
    tween(op).to(0.4, { opacity: 255 }).start();
    node.on(Node.EventType.TOUCH_END, this.clearCache, this);
  }

  private hideHint() {
    if (!this.hintLabel) return;
    this.hintLabel.node.active = false;
  }

  /**
   * 清缓存。
   *
   * ⚠️ **白名单，绝不整体 clear()。** `warmpet_pending_ops` 是未确认幂等操作的日志，
   * `bootstrap.reconcilePendingOps()` 靠它做补偿重放——玩家买东西时断网、
   * 然后点了清缓存，那笔钱就再也找不回来了。
   * 只清这三个：重登、重新对冷却都无害。
   */
  private clearCache() {
    try {
      const ls = sys.localStorage;
      ls.removeItem(TOKEN_KEY);
      ls.removeItem(USER_ID_KEY);
      ls.removeItem(COOLDOWN_KEY);
    } catch (e) {
      // 清不掉也不影响重试，继续走
    }
    if (this.detailLabel) this.detailLabel.string = '已清理，正在重试…';
    if (this.hintLabel) this.hintLabel.node.active = false;

    // 清完必须真的再试一次，否则点了没反应就是「静默失败 = 设计缺陷」。
    // 失败态下复用 fail() 的回调；仍在加载中时不打断，等它自己走完。
    const retry = this.retryFn;
    if (this.failed && retry) {
      this.failed = false;
      this.crawling = true;
      this.shownPct = -1;
      this.progress = START_PROGRESS;
      this.ceiling = START_PROGRESS;
      this.stageIndex = 0;
      if (this.mainLabel) this.mainLabel.string = MAIN_TEXT;
      this.drawBar();
      this.setStage(STAGE_ORDER[0]);
      retry();
    }
  }
}
