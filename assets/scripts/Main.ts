/**
 * 游戏入口，挂在 main 场景 Canvas 下的 Main 节点上。
 *
 * 冷启动顺序遵循对接文档 19.1：对表 → 登录 → 补偿未确认操作 → 拉首屏数据。
 * 首屏只等 /pet/state，其余接口并发补齐，所以不会因为某个次要接口慢而卡住玩家。
 *
 * 注意：net/auth 的 401 重登钩子是在它自己的模块作用域里注册的，
 * 这里**不能**写 `import './net/auth'` 这种只有副作用的 import——
 * Cocos 的打包器解析不了不导入任何符号的 import，会在运行时抛
 * 「Unable to resolve bare specifier '__unresolved_N'」。
 * 依赖 bootstrap 对它的正常 import 来触发初始化即可：
 * ESM 保证被依赖模块先于依赖方求值，钩子在任何请求发出前就已注册。
 */

import { _decorator, Component, Node, view } from 'cc';
import { MainView } from './ui/MainView';
import { MapView } from './ui/MapView';
import { LoadingView } from './ui/LoadingView';
import { NetCheckView } from './ui/NetCheckView';
import { CarePanel } from './ui/CarePanel';
import { BathPanel } from './ui/BathPanel';
import { GachaPanel } from './ui/GachaPanel';
import { WardrobePanel } from './ui/WardrobePanel';
import { RacePanel } from './ui/RacePanel';
import { SettingsPanel } from './ui/SettingsPanel';
import { onApiError } from './net/request';
import { bootstrap, refreshOnShow } from './core/bootstrap';
import { showError, toast, setToastHost } from './ui/toast';
import { onShow } from './platform/minigame';
import { initDevConsole } from './platform/devConsole';
import { makeNode, makeGraphics, makeLabel, fillRoundRectRim, topInset, COLOR } from './ui/widgets';
import { toApiError } from './net/errors';

const { ccclass } = _decorator;

@ccclass('Main')
export class Main extends Component {
  private loading: LoadingView | null = null;
  private mainView: MainView | null = null;
  private entered = false;
  /** 当前打开的分区玩法面板（弹窗层）。同时只允许一个，关掉后置空 */
  private panel: Node | null = null;

  onLoad() {
    initDevConsole();
    // 自绘 toast/确认框的挂载点。没有 wx 的环境（编辑器预览）靠它才能看见提示，
    // 否则 showToast 只 console.log，界面上「点了没反应」= 以为按钮坏了。
    setToastHost(this.node);
    this.watchGlobalErrors();
    this.watchAppState();
    this.showLoading();
    this.boot();
  }

  onDestroy() {
    setToastHost(null);
  }

  /**
   * 加载界面。
   *
   * 定稿首页海报作整屏背景，海报里那条写死的 62% 进度条被一条实时进度条原位盖住。
   * 具体绘制、进度映射、点击重试都在 LoadingView 里，这里只负责创建与阶段回调。
   */
  private showLoading() {
    const node = makeNode('Loading', this.node);
    node.setPosition(0, 0);
    this.loading = node.addComponent(LoadingView);
  }

  private async boot() {
    try {
      await bootstrap({
        onProgress: (stage) => this.loading?.setStage(stage),
        onReady: () => this.loading?.finish(() => this.enterMain()),
      });
    } catch (err) {
      // 登录失败是唯一进不去游戏的情况，给玩家一个能重试的出口，不要白屏
      const e = toApiError(err);
      this.loading?.fail(e.message, () => this.boot());
    }
  }

  /**
   * 开机加载完成后的落地界面 = **家庭地图**（规则 `first-screen-and-loading`）。
   *
   * 地图自带互动条与全部分区入口，所以它不再是「原型」而是正式落地界面，
   * 也没有「返回上一层」。`MainView` 退居调试用，靠右上角长按进入。
   */
  private enterMain() {
    if (this.entered) return;
    this.entered = true;
    // LoadingView 会在淡出后自行销毁，这里不再持有它
    this.loading = null;
    this.showMapPrototype();
  }

  /** 正式主界面：宠物 + 状态 + 四种互动 */
  private showMainView() {
    if (this.mainView) return;
    const map = this.node.getComponent(MapView);
    if (map) map.destroy();
    this.node.removeAllChildren();
    this.mainView = this.node.addComponent(MainView);
    this.addDebugEntry();
    this.addMapButton();
  }

  /**
   * 主界面上「回小屋（大地图）」的明确入口。
   *
   * 原先只有右上角长按这一个隐藏手势——玩家从地图点进玩法之后就出不去了，
   * 这正是规则里那条「静默失败 = 设计缺陷」：没有可见出口等于功能坏了。
   * 最后挂 → 层级最高，不会被 MainView 的面板盖住。
   */
  private addMapButton() {
    const size = view.getVisibleSize();
    const w = 104;
    const h = 48;
    const btn = makeNode('BackToMap', this.node, w, h);
    // 左上角：那一带只有长按热区，没有可见控件，不会挡状态文字和货币药丸
    btn.setPosition(-size.width / 2 + 16 + w / 2, size.height / 2 - topInset() - h / 2 - 4);

    const g = makeGraphics('bg', btn);
    fillRoundRectRim(g, -w / 2, -h / 2, w, h, h / 2, COLOR.accent, 3);

    const lbl = makeLabel('← 小屋', btn, {
      size: 20,
      color: COLOR.accentText,
      align: 'center',
      bold: true,
    });
    lbl.node.setPosition(0, 0);

    btn.on(Node.EventType.TOUCH_END, () => {
      this.scheduleOnce(() => this.showMapPrototype(), 0);
    });
  }

  /**
   * 自检页的入口。
   * 玩法界面接管首屏后它就退居调试入口，长按左上角进入。
   * 用长按而不是按钮，是为了不在正式界面上占位置、也不会被玩家误触。
   */
  private addDebugEntry() {
    const size = view.getVisibleSize();
    // 左上角长按 1.2s → 自检页。往下挪开一截，避免和「← 小屋」按钮抢同一片触摸区。
    this.addLongPress(-size.width / 2 + 60, size.height / 2 - 200, () => this.openSelfCheck());
    // 右上角长按 1.2s → 地图原型。正常开机与海报照常，两者不冲突。
    this.addLongPress(size.width / 2 - 60, size.height / 2 - 180, () => this.showMapPrototype());
  }

  /** 角落长按热区：不占正式界面位置、也不易误触，用作调试入口 */
  private addLongPress(x: number, y: number, action: () => void) {
    const hit = makeNode('DebugEntry', this.node, 120, 120);
    hit.setPosition(x, y);

    let timer: ReturnType<typeof setTimeout> | null = null;
    hit.on(Node.EventType.TOUCH_START, () => {
      timer = setTimeout(action, 1200);
    });
    const cancel = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    hit.on(Node.EventType.TOUCH_END, cancel);
    hit.on(Node.EventType.TOUCH_CANCEL, cancel);
  }

  /**
   * 家庭地图：正式落地界面。走完正常 bootstrap 之后才展示，
   * 所以海报/加载/登录一切照常。
   */
  private showMapPrototype() {
    if (this.node.getComponent(MapView)) return;
    if (this.mainView) {
      this.mainView.destroy();
      this.mainView = null;
    }
    this.node.removeAllChildren();
    const map = this.node.addComponent(MapView);
    map.onOpenZone = (key) => this.openZone(key);
  }

  /**
   * 分区点击路由。
   *
   * 全部是**盖在地图上的弹窗**——玩法本身很轻（一屏列表就够），
   * 盖着弹窗关掉就回到地图，不用重建整个界面。
   *
   * 每个分区都必须有出口：ModalPanel 自带关闭按钮 + 点遮罩关闭，
   * 所以不会出现「进去了出不来」（规则 `map-scroll-view`：每个分区都要有出口）。
   */
  private openZone(key: string) {
    // 注意这里**没有 lobby 这一支**。互动已经内联在地图底部（`MapActionBar`），
    // 大厅不再是「要跳进去的地方」，铺满地板的那条 lobby 分区也一并去掉了 ——
    // 它让任何一次落在壁龛之外的点击都整屏切走。

    // 已经开着一个面板时不再叠第二层：叠起来的遮罩会越来越黑，关也要关两次
    if (this.panel && this.panel.isValid) return;

    // 在地图输入层的触摸回调里建节点是安全的（不像销毁自己那样会拆掉派发中的节点），
    // 但为了和 showMainView 的延后一帧保持一致的时序，这里也延后一帧。
    this.scheduleOnce(() => this.mountZonePanel(key), 0);
  }

  /**
   * 建分区面板。
   *
   * 各面板关闭时会销毁自己的节点，所以这里只记住节点、用 isValid 判断是否还开着，
   * 不需要额外的关闭回调链。未知 key 也要有反馈，不许静默 return。
   */
  private mountZonePanel(key: string) {
    if (this.panel && this.panel.isValid) return;

    let comp: Component | null = null;
    switch (key) {
      // HUD 的「购置」和地图的「商店」分区是同一个界面，两个 key 都要认
      case 'shop':
      case 'buy':
        comp = WardrobePanel.open(this.node);
        break;
      case 'care':
        comp = CarePanel.open(this.node);
        break;
      case 'bath':
        comp = BathPanel.open(this.node);
        break;
      case 'nursery':
        comp = GachaPanel.open(this.node);
        break;
      case 'garden':
        comp = RacePanel.open(this.node);
        break;
      case 'settings':
        comp = SettingsPanel.open(this.node);
        break;
      default: {
        // HUD 上那些还没有界面的入口（图鉴/领取/好友/相册/礼盒/挑战/音量）。
        // 逐个列出中文名而不是甩一个 key 出去 —— 玩家看不懂 'dex' 是什么。
        // 这里是**明确提示**而不是静默 return，两者的区别就是「没做」和「坏了」。
        const PENDING: Record<string, string> = {
          dex: '图鉴',
          claim: '领取奖励',
          daily: '每日任务',
          gift: '礼盒',
          challenge: '挑战',
          friends: '好友',
          album: '萌宠相册',
          sound: '音量',
        };
        const name = PENDING[key];
        toast(name ? `『${name}』还在开发中，敬请期待` : `『${key}』还没有对应的界面`);
        return;
      }
    }
    this.panel = comp ? comp.node : null;
  }

  private openSelfCheck() {
    if (this.node.getComponent(NetCheckView)) return;
    if (this.mainView) {
      this.mainView.destroy();
      this.mainView = null;
    }
    this.node.removeAllChildren();
    this.node.addComponent(NetCheckView);
  }

  /**
   * 封禁必须有明确提示 UI，不能静默失败。
   * 被封玩家的读接口仍可访问，所以只有写操作会走到这里。
   */
  private watchGlobalErrors() {
    let showing = false;
    onApiError((err) => {
      if (!err.isBanned || showing) return;
      showing = true;
      showError(err).then(() => {
        showing = false;
      });
    });
  }

  /** 切回前台时宠物状态已经变了，重新对表并拉一次 */
  private watchAppState() {
    onShow(() => {
      refreshOnShow();
    });
  }
}
