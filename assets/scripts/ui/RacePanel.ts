/**
 * 花园阳台：赛跑。对应地图分区 `garden`，接口 `/race`。
 *
 * 状态机（照 net/api/race.ts 的说明）：
 *   tracks → start(pending) → [看广告 revive 重跑，每场 1 次] → settle(settled)
 *                                                            → [看广告 double 翻倍]
 *
 * **名次和奖励在 start 时就算定了**，settle 只负责发奖。所以可以 start 返回后
 * 先播一段动画、播完再 settle —— 动画时长按 finishTime 映射，不是随便定的。
 *
 * 三条纪律的落点：
 * - **服务端权威**：名次、完成时间、奖励全部来自 start/settle 响应。
 *   本地那条跑道进度条纯粹是表现，不参与任何判定。
 * - **幂等 + 不丢奖**：`raceId` 一旦拿到就存住，settle 失败也**不清掉**，
 *   下次进面板还能继续领 —— 奖励算定了却领不到是最伤玩家的一类 bug。
 *   `duplicated` 为 true 表示回放，不重复播领奖动画。
 * - **软失败不死亡**：赛道加载失败给重试；广告不可用/被跳过都只提示，
 *   基础奖励照发（见 core/adflow 的 AdStatus 分支）。
 */

import { _decorator, Component, Node, Label } from 'cc';
import { COLOR, STAT_COLOR, makeLabel, floatText } from './widgets';
import { ModalPanel } from './ModalPanel';
import {
  tapButton,
  listRow,
  scrollList,
  asyncBody,
  miniBar,
  ROW_GAP,
} from './panelKit';
import type { ScrollList, AsyncBody } from './panelKit';
import api from '../net/api';
import { estimateReward } from '../net/api/race';
import { watchForRaceDouble, watchForRaceRevive } from '../core/adflow';
import store from '../core/store';
import { toast, modal } from './toast';
import { toApiError } from '../net/errors';
import type { RaceBattle, RaceStartResult, RaceTrack } from '../net/types';

const { ccclass } = _decorator;

const ROW_H = 116;

/** 名次的说法。RANK_FACTOR 只有 4 档，超出就是「未上榜」 */
const RANK_TEXT = ['第 1 名', '第 2 名', '第 3 名', '第 4 名'];

@ccclass('RacePanel')
export class RacePanel extends Component {
  private modal: ModalPanel | null = null;
  private list: ScrollList | null = null;
  private body: AsyncBody | null = null;
  private battleLabel: Label | null = null;
  private battleBarHost: Node | null = null;
  private tracks: RaceTrack[] = [];
  private battle: RaceBattle | null = null;
  /** 一场比赛只允许同时进行一局，避免连点开出两局各扣一次体力和门票 */
  private racing = false;

  public static open(parent: Node): RacePanel {
    const host = new Node('RacePanel');
    host.parent = parent;
    const comp = host.addComponent(RacePanel);
    comp.build();
    return comp;
  }

  private build() {
    this.modal = ModalPanel.open(this.node, '花园阳台 · 赛跑');
    const body = this.modal.body;
    if (!body) return;

    this.battleLabel = makeLabel('', body, { size: 17, color: COLOR.text, align: 'center', width: this.modal.bodyW - 40 });
    this.battleLabel.node.setPosition(0, this.modal.bodyH / 2 - 26, 0);

    this.battleBarHost = new Node('BattleBar');
    this.battleBarHost.parent = body;

    this.body = asyncBody(body, this.modal.bodyW);
    this.list = scrollList(body, this.modal.bodyW, this.modal.bodyH - 92, -46);

    this.load();
  }

  private load() {
    if (!this.body || !this.list) return;
    this.list.clear();
    this.body.loading();

    api.race
      .tracks()
      .then((view) => {
        if (!this.node.isValid || !this.body) return;
        this.body.clear();
        this.tracks = view.tracks || [];
        // battle 为 null 是正常状态（还没有宠物），不是错误
        this.battle = view.battle;
        this.renderBattle();

        if (!this.tracks.length) {
          this.body.empty('赛道正在整修，稍后再来');
          return;
        }
        this.renderTracks();
      })
      .catch((err) => {
        if (!this.node.isValid || !this.body) return;
        this.body.failed(toApiError(err).message, () => this.load());
      });
  }

  /** 出战宠战力预览。power 仅供展示，不参与名次计算（接口注释明确说了） */
  private renderBattle() {
    const label = this.battleLabel;
    const host = this.battleBarHost;
    const modal = this.modal;
    if (!label || !label.node.isValid || !host || !host.isValid || !modal) return;

    host.removeAllChildren();
    const b = this.battle;
    if (!b) {
      label.string = '还没有可以出战的宠物';
      return;
    }
    label.string = `${b.nickname || '无名宠'} Lv${b.level} · 战力 ${b.power.toFixed(1)} · 体力 ${Math.floor(b.stamina)}/${b.staminaMax}`;
    const ratio = b.staminaMax > 0 ? b.stamina / b.staminaMax : 0;
    miniBar(host, modal.bodyW - 60, modal.bodyH / 2 - 48, ratio, ratio <= 0.2 ? COLOR.danger : STAT_COLOR.stamina);
  }

  private renderTracks() {
    const list = this.list;
    const modal = this.modal;
    if (!list || !modal) return;

    const areaH = modal.bodyH - 92;
    let y = areaH / 2 - ROW_H / 2;
    this.tracks.forEach((track) => {
      this.renderTrack(list.content, track, modal.bodyW, y);
      y -= ROW_H + ROW_GAP;
    });
    list.setContentHeight(this.tracks.length * (ROW_H + ROW_GAP));
  }

  private renderTrack(parent: Node, track: RaceTrack, w: number, y: number) {
    const rowW = w - 8;
    const sub = `${track.distance}m · 门票 ${track.entryCoin} 金币 · 体力 ${track.staminaCost} · 建议 Lv${track.recommendLevel}`;
    const row = listRow(parent, rowW, y, ROW_H, track.name, sub);

    // 奖励预告：让玩家看到「跑进前几名值多少」，否则门票花得没有依据
    const reward = makeLabel(
      `第 1 名 ${estimateReward(track.baseReward, 1)} · 第 2 名 ${estimateReward(track.baseReward, 2)} · 第 3 名 ${estimateReward(track.baseReward, 3)} 金币`,
      row,
      { size: 14, color: COLOR.dim, width: rowW - 28 },
    );
    reward.node.setPosition(-rowW / 2 + 14, -ROW_H / 2 + 44, 0);

    const check = this.canEnter(track);
    tapButton(
      row,
      '报名参赛',
      rowW / 2 - 62,
      -ROW_H / 2 + 22,
      {
        width: 108,
        height: 36,
        disabled: !check.ok,
        disabledReason: check.reason,
      },
      () => this.onStart(track),
    );
  }

  /**
   * 能不能报名。
   *
   * 这些判定**只用于置灰按钮**，服务端仍会各自校验一遍。之所以还在客户端算：
   * 让玩家在点之前就知道差什么（体力不够 / 金币不够），而不是点下去吃一个 400。
   * 体力用的是 `store.petView` 的预测值，两次请求之间会自然回涨。
   */
  private canEnter(track: RaceTrack): { ok: boolean; reason: string } {
    if (this.racing) return { ok: false, reason: '还有一局没跑完' };
    const pet = store.petView;
    if (!pet) return { ok: false, reason: '还没有可以出战的宠物' };
    if (pet.stamina < track.staminaCost) {
      return { ok: false, reason: `体力不够，需要 ${track.staminaCost} 点` };
    }
    if (store.wallet.gameCoin < track.entryCoin) {
      return { ok: false, reason: `门票不够，需要 ${track.entryCoin} 金币` };
    }
    return { ok: true, reason: '' };
  }

  /**
   * 报名 → 播动画 → 结算。
   *
   * **换新 bizId 调用 start 就是开新的一局，会再次扣体力和门票**（接口注释），
   * 所以 racing 标志一定要在发请求之前就置上，且失败路径要复位。
   */
  private async onStart(track: RaceTrack) {
    if (this.racing) return;
    this.racing = true;

    let started: RaceStartResult;
    try {
      started = await api.race.start({ trackKey: track.key, petId: store.activePetId || undefined });
    } catch (err) {
      this.racing = false;
      if (!this.node.isValid) return;
      toast(toApiError(err).message || '报名失败，请稍后再试');
      return;
    }

    if (!this.node.isValid) return;

    // 名次已经定了，这段动画纯粹是表现。时长按服务端给的 finishTime 映射，
    // 但压缩到 1.2~2.6 秒——真实的 24~36 秒等待没人愿意看完。
    await this.playRace(track, started);
    if (!this.node.isValid) return;

    await this.settle(started);
    this.racing = false;
    if (!this.node.isValid) return;
    // 体力和余额都变了，重拉一次赛道页（顺带刷新战力条与按钮可点态）
    this.load();
  }

  /** 跑道动画：一条按 finishTime 推进的进度条 + 名次揭晓 */
  private playRace(track: RaceTrack, res: RaceStartResult): Promise<void> {
    const body = this.modal && this.modal.body;
    if (!body || !body.isValid) return Promise.resolve();

    const dur = Math.max(1.2, Math.min(2.6, res.finishTime / 14));
    const label = makeLabel(`${track.name} · 比赛中…`, body, {
      size: 20, color: COLOR.title, align: 'center', bold: true, width: 320,
    });
    label.node.setPosition(0, 20, 0);

    const barHost = new Node('RaceBar');
    barHost.parent = body;

    return new Promise<void>((resolve) => {
      const started = Date.now();
      const tick = () => {
        if (!this.node.isValid || !barHost.isValid) {
          resolve();
          return;
        }
        const t = Math.min(1, (Date.now() - started) / (dur * 1000));
        barHost.removeAllChildren();
        miniBar(barHost, 300, -14, t, COLOR.accent);
        if (t >= 1) {
          this.unschedule(tick);
          label.string = `${RANK_TEXT[res.rank - 1] || `第 ${res.rank} 名`} · ${res.finishTime.toFixed(2)}s · ${res.grade} 级`;
          // 停留一下让玩家看清名次，再交给结算
          this.scheduleOnce(() => {
            if (label.node.isValid) label.node.destroy();
            if (barHost.isValid) barHost.destroy();
            resolve();
          }, 0.9);
          return;
        }
      };
      this.schedule(tick, 0);
    });
  }

  /**
   * 结算领奖。
   *
   * **失败不清 raceId**：奖励在 start 时就算定了，settle 只是发奖。
   * 这里失败就提示玩家稍后可再领，并把 raceId 留在待办里（bizId 已进
   * 未确认操作日志，下次冷启动 `reconcilePendingOps` 会替玩家重放确认）。
   */
  private async settle(started: RaceStartResult): Promise<void> {
    let res;
    try {
      res = await api.race.settle(started.raceId);
    } catch (err) {
      if (!this.node.isValid) return;
      toast(`${toApiError(err).message || '领奖失败'}，奖励不会丢，稍后会自动补发`);
      return;
    }

    if (!this.node.isValid) return;
    store.applyGameCoin(res.gameCoin);

    if (res.duplicated) {
      // 幂等回放：这局早就结算过了，不再播一次领奖动画
      toast('这局已经领过奖了');
      return;
    }

    const body = this.modal && this.modal.body;
    if (body && res.rewardCoin > 0) floatText(body, `+${res.rewardCoin} 金币`, COLOR.ok, 0);

    // 有奖励才有翻倍的意义（接口要求 rewardCoin > 0）
    if (res.rewardCoin <= 0) {
      toast(`${RANK_TEXT[res.rank - 1] || `第 ${res.rank} 名`}，这次没有奖励，再试一次吧`);
      return;
    }

    const wantDouble = await modal(
      '奖励翻倍',
      `本局获得 ${res.rewardCoin} 金币\n看一段视频可以再拿一份`,
      true,
    );
    if (!wantDouble || !this.node.isValid) return;
    await this.doubleReward(started.raceId);
  }

  /**
   * 看广告翻倍。
   *
   * 四种失败态各自给不同的话（软失败不死亡）：不可用/被跳过/次数用尽/核销失败，
   * 基础奖励**已经到账**，所以任何一种都不影响玩家已得的部分，要说清楚这一点。
   */
  private async doubleReward(raceId: string) {
    const res = await watchForRaceDouble(raceId);
    if (!this.node.isValid) return;

    if (res.status === 'ok' && res.data) {
      store.applyGameCoin(res.data.gameCoin);
      const body = this.modal && this.modal.body;
      if (body) floatText(body, `再 +${res.data.bonusCoin} 金币`, COLOR.warn, 20);
      toast(res.data.duplicated ? '翻倍奖励已经领过了' : `翻倍成功，共 ${res.data.totalRewardCoin} 金币`);
      return;
    }

    const TEXT: Record<string, string> = {
      skipped: '需要完整看完视频才能翻倍，基础奖励已经到账了',
      unavailable: '广告暂时不可用，基础奖励已经到账了',
      limited: '今天的翻倍次数用完了，明天再来',
      failed: '翻倍没成功，基础奖励已经到账，稍后可在钱包核对',
    };
    toast(res.message || TEXT[res.status] || '翻倍没成功，基础奖励已经到账了');
  }

  /**
   * 看广告复活重跑。目前没有入口调用它 —— revive 要求该场仍为 pending，
   * 而本面板是「跑完立即 settle」的流程，没有 pending 停留期。
   * 保留这个方法是为了将来做「名次不满意可重跑」时不用重写广告链路。
   */
  private async revive(raceId: string) {
    const res = await watchForRaceRevive(raceId);
    if (!this.node.isValid) return;
    if (res.status === 'ok' && res.data) {
      toast(`重跑结果：第 ${res.data.rank} 名`);
      return;
    }
    toast(res.message || '重跑没成功');
  }
}
