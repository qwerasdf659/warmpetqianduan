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
import { onApiError } from './net/request';
import { bootstrap, refreshOnShow } from './core/bootstrap';
import { showError, toast } from './ui/toast';
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

  onLoad() {
    initDevConsole();
    this.watchGlobalErrors();
    this.watchAppState();
    this.showLoading();
    this.boot();
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
   * 开机加载完成后的落地界面。
   *
   * 原型阶段：直接落到「双向滚动地图原型」，地图内点「返回」进正式主界面；
   * 主界面右上角长按可再回到地图。海报/加载/登录一切照常，不受影响。
   * 验收完地图后，把 showMapPrototype() 改成 showMainView() 即恢复默认落主界面。
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
   * 双向滚动地图原型：临时替换当前界面，地图内点「返回」回主界面。
   * 走完正常 bootstrap 之后才展示，所以海报/加载/登录一切照常。
   */
  private showMapPrototype() {
    if (this.node.getComponent(MapView)) return;
    if (this.mainView) {
      this.mainView.destroy();
      this.mainView = null;
    }
    this.node.removeAllChildren();
    const map = this.node.addComponent(MapView);
    // 「返回」与「点击大厅」都会销毁当前地图节点，必须延后一帧执行，
    // 否则是在地图输入层的触摸回调里销毁它自己，事件派发中途拆节点会报错。
    map.onBack = () => this.scheduleOnce(() => this.showMainView(), 0);
    map.onOpenZone = (key) => this.openZone(key);
  }

  /**
   * 分区点击路由。大厅 = 出战宠互动，直接进正式主界面（MainView 就是互动界面）；
   * 其余玩法的界面还没做，先 toast 占位，别静默无反应（规则：静默失败=设计缺陷）。
   */
  private openZone(key: string) {
    if (key === 'lobby') {
      this.scheduleOnce(() => this.showMainView(), 0);
      return;
    }
    const NAMES: Record<string, string> = {
      garden: '花园阳台',
      nursery: '育婴室',
      shop: '商店',
      bath: '洗浴间',
      care: '护理室',
    };
    toast(`『${NAMES[key] || key}』玩法开发中，敬请期待`);
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
