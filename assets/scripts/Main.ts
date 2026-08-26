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

import { _decorator, Component, Node, Label, view } from 'cc';
import { MainView } from './ui/MainView';
import { NetCheckView } from './ui/NetCheckView';
import { onApiError } from './net/request';
import { bootstrap, refreshOnShow } from './core/bootstrap';
import { showError } from './ui/toast';
import { onShow } from './platform/minigame';
import { COLOR, makeNode, makeLabel } from './ui/widgets';
import { toApiError } from './net/errors';

const { ccclass } = _decorator;

@ccclass('Main')
export class Main extends Component {
  private loadingLabel: Label | null = null;
  private mainView: MainView | null = null;

  onLoad() {
    this.watchGlobalErrors();
    this.watchAppState();
    this.showLoading();
    this.boot();
  }

  private showLoading() {
    this.loadingLabel = makeLabel('启动中…', this.node, {
      size: 20,
      color: COLOR.dim,
      align: 'center',
    });
    this.loadingLabel.node.setPosition(0, 0);
  }

  private async boot() {
    try {
      await bootstrap({
        onProgress: (stage) => {
          if (this.loadingLabel) this.loadingLabel.string = `${stage}…`;
        },
        onReady: () => this.enterMain(),
      });
    } catch (err) {
      // 登录失败是唯一进不去游戏的情况，给玩家一个能重试的出口，不要白屏
      const e = toApiError(err);
      if (this.loadingLabel) this.loadingLabel.string = `${e.message}\n点击屏幕重试`;
      this.node.once(Node.EventType.TOUCH_END, () => this.boot(), this);
    }
  }

  private enterMain() {
    if (this.mainView) return;
    if (this.loadingLabel) {
      this.loadingLabel.node.destroy();
      this.loadingLabel = null;
    }
    this.mainView = this.node.addComponent(MainView);
    this.addDebugEntry();
  }

  /**
   * 自检页的入口。
   * 玩法界面接管首屏后它就退居调试入口，长按左上角进入。
   * 用长按而不是按钮，是为了不在正式界面上占位置、也不会被玩家误触。
   */
  private addDebugEntry() {
    const size = view.getVisibleSize();
    const hit = makeNode('DebugEntry', this.node, 120, 120);
    hit.setPosition(-size.width / 2 + 60, size.height / 2 - 60);

    let timer: ReturnType<typeof setTimeout> | null = null;
    hit.on(Node.EventType.TOUCH_START, () => {
      timer = setTimeout(() => this.openSelfCheck(), 1200);
    });
    const cancel = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    hit.on(Node.EventType.TOUCH_END, cancel);
    hit.on(Node.EventType.TOUCH_CANCEL, cancel);
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
