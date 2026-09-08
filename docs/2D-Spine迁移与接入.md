# 2D Spine 迁移与接入说明

宠物从 3D 模型迁移到 **2D Spine 骨骼**（2026-08-30 定）。本文记录：已在代码里改了什么、
美术资源怎么产出并接进来、哪些是必须由人/外部工具完成的前置。

配套规范见 `docs/06-UI设计规范.md` §3.4（2D 舞台）、§5（2D Spine 骨骼规范）。

## 方向决策（收敛结论）

- 3D → 2D，退役 Tripo3D 与 `tools/` Blender 管线、`*.glb`。
- **只做一套四足骨架**（2026-09-07 定）：猫狗共用，同时承担养成核心与收集/环境/赛跑。
  喂食/洗澡/抚摸/陪玩、成长、心情、换装、技巧全部演在它身上。
- **拟人主宠不做。** 原方案是「拟人主宠当屏幕主角 + 四足小宠当收集品」两套骨架，
  已废弃。理由见下方「为什么砍掉拟人主宠」。
- Runtime = **Spine**（工具活跃、Windows 导出正常、AI 工具都导 Spine；DragonBones 已荒废、
  Windows 端导出被封，弃用）。
- 大小/胖瘦/头身比差异，靠调骨 + 换部件图 + 缩放 + Spine skin 复用，一套骨架通吃。

### 为什么砍掉拟人主宠

1. **接口本来就是照四足设计的。** `net/types.ts` 的 `Slot` 只有
   `body | hat | neck | bg`——`body` 是皮肤、`bg` 是背景，真配饰槽只有帽子和颈部两个；
   配饰清单（`acc_cap` / `acc_bow` / `acc_glasses` / `acc_crown` 挂头，
   `acc_bell` / `acc_bandana` / `acc_scarf` 挂颈）里没有上衣、裙子、鞋子。
   拟人主宠反而是后来写进文档、和接口对不上的那一支。
2. **成本差一个量级。** 外包报价里四足绑骨 ¥5 千–1.5 万、狗 reskin ¥3 千–1 万，
   而拟人主宠含换装是 ¥1.2 万–3 万+（见《宠物Spine骨骼原理与外包说明》第 12 节）。
3. **现有素材全是配四足的。** `assets/resources/spine/` 下 29 套家具/道具/特效来自同一个
   猫咖素材包，比例和视角都是按四足猫做的。

**跟着变的两件事：**

- **换装深度的支点从「穿搭组合」换成「花色数量」。** 四足猫只有头/颈两个挂点，
  撑不起成套穿搭；长线外观消费点要压在花色上（素材包有 59 种，方向是通的）。
  商店与扭蛋的主推物、图鉴的收集维度都应按此调整。
- **P13 训练技巧里的「跳舞」对四足偏勉强**，坐下/握手/打滚/跳圈都自然。
  到时换成组合技（如打滚接跳跃）即可。

> ⚠️ **版权优先级因此上升。** 四足猫从「临时占位」变成正式长期主角，
> 那套扒来的 59 花色素材就必须在上架前换成原创或正版授权（见《宠物Spine骨骼原理与外包说明》§1）。
> 骨架层级可以照做，要重做的是贴图。这件事要排在「铺内容」之前——
> 否则后面画的配饰、家具都是按侵权素材的比例做的。

## 代码侧已完成（本仓库）

| 改动 | 位置 |
| --- | --- |
| 启用引擎 `spine-3.8` 模块 + 加入 `includeModules` | `settings/v2/packages/engine.json` |
| `PetStage` 重写为 2D：`sp.Skeleton` 播 idle，缺资源退回 Graphics 占位，保留 `react()`/`frameTo()`/store 同步 | `assets/scripts/ui/PetStage.ts` |
| `MainView` 集成点与背景注释改 2D（`frameTo`/`react` 签名不变） | `assets/scripts/ui/MainView.ts` |
| 颜色注释去掉 3D 措辞 | `assets/scripts/ui/widgets.ts` |
| §3.4、§5、§5.9 改写为 2D Spine 规范 | `docs/06-UI设计规范.md` |
| 3D 管线标记退役 | `.cursor/rules/3d-asset-pipeline.mdc` |

**关键**：`PetStage` 已经能在无资源时正常出画面（占位简笔猫 + 呼吸动效），
所以在 Spine 资源到位前也不会白屏。

## 代码期望的资源约定（美术照此产出即可无缝接入）

- 落位：`assets/resources/spine/<name>/`，导出 `skeleton.json`（或 `.skel`）+ `.atlas` + `.png`。
- **导出版本必须是 Spine 3.8.x**，不是 Spine 默认的 4.2。引擎实际启用的是
  `spine-3.8`（`settings/v2/packages/engine.json` 里 `spine-4.2` 是 `false`），
  现有 59 猫素材也是 3.8.x 导出的。**4.2 运行时读不了 3.8 骨骼，反之也不行——
  版本对不上的表现是整只不出画面，且不报错。**
- `<name>` 由 `species` 解析（见 `PetStage.ts` 的 `SPECIES_SKELETON`）：
  - `pet_cat` / `pet_dog`：四足猫/狗，共用一套骨架。
  - 后端返回 `default` 或未知值时兜底到 `pet_cat`，不留空舞台。
- 动画命名：至少要有 `idle`（循环）、`happy`（互动反馈会叠播一次再回 idle），
  以及 `feed`/`bath`/`pet`/`play`/技巧/心情（§5.6 列表）。
  **`idle` 必须是清醒姿势**——它是玩家打开游戏第一眼看到的动画，
  睡姿读起来是「它不需要我」（`PetStage.IDLE_CANDIDATES` 把睡姿排在最后兜底）。
- 换装挂点：Spine **slot** 用 `socket_` 前缀（对应旧 3D 的 socket 骨骼），如 `socket_hat`/`socket_neck`。
- 多皮肤/花色：用 Spine **skins**（Pro 功能），一套骨架换部件贴图即出新花色。

## 必须由人/外部完成的前置（我这边做不了）

1. **购买 Spine Pro license**（$379，合法发布 runtime 的前提；换装/网格/skins 需 Pro）。
   公司年营收超 $50 万美金则需 Enterprise。
2. **启用模块后重新导入引擎**：`engine.json` 已改，但 Cocos 编辑器需重新编译引擎
   （改 `includeModules` 后必做，否则引擎 barrel 解析失败 → 白屏，见 `cocos-toolchain` 规则）。
3. **产出四足 Spine 资源**：以 `assets-src/concept/pet_quad_rigbase.png`（标准侧视、
   四腿+尾摊开、脊柱水平）为底图，参照 Spine 官方 Raptor 示例**手工**绑
   （脊柱分段 + 每条腿两骨 IK + 尾/耳），猫狗共用。**AI 拆层工具只认人形，四足帮不上。**
   底图特意选了适合拆件的姿势；风格/配色沿用奶茶米色系（主色 `#D9BE96`）。

   > `assets-src/concept/pet_humanoid_rigbase.png` 是原拟人主宠方案的绑骨底图，
   > 该方案已废弃，此文件不再是交付输入。

## 落地顺序（先打通再铺量）

1. 买 Spine Pro → 编辑器重导引擎（前置 1、2）。
2. **先只做一个清醒的 `idle`**，导出丢进 `assets/resources/spine/pet_cat/`，
   预览确认 `sp.Skeleton` 能播（最大风险点，先排掉）。
3. 补其余动画（§5.6 第一批 8 个）+ 换装 skins。
4. 猫的花色铺到 5~10 种；狗走 reskin（同骨架换网格剪影与贴图，动画和配饰不用重做）。
5. 全项目确认不再用 3D 后，可在 `engine.json` 关掉 `3d` / `skeletal-animation` 减包。

## 验证

- 脚本类型检查：`node _research/typecheck.mjs`（已通过；不依赖真实资源）。
- 预览：编辑器重导引擎后打开主场景，`Ctrl+Shift+R` 强刷；无资源时应看到占位简笔猫，
  放入 Spine 资源后应看到骨骼动画。
- 微信小游戏端走 JS 运行时，Spine 支持稳定。
