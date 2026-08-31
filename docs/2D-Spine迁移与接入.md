# 2D Spine 迁移与接入说明

宠物从 3D 模型迁移到 **2D Spine 骨骼**（2026-08-30 定）。本文记录：已在代码里改了什么、
美术资源怎么产出并接进来、哪些是必须由人/外部工具完成的前置。

配套规范见 `docs/06-UI设计规范.md` §3.4（2D 舞台）、§5（2D Spine 骨骼规范）。

## 方向决策（收敛结论）

- 3D → 2D，退役 Tripo3D 与 `tools/` Blender 管线、`*.glb`。
- 两套骨架：
  - **拟人主宠**（养成核心）：喂食/洗澡/抚摸/陪玩、成长、心情、换装、技巧。
  - **四足小宠**（收集/环境/赛跑）：一群、多花色，猫狗共用一套骨架。
- Runtime = **Spine**（工具活跃、Windows 导出正常、AI 工具都导 Spine；DragonBones 已荒废、
  Windows 端导出被封，弃用）。
- 同一体型模板内的大小/胖瘦/头身比差异，靠调骨 + 换部件图 + 缩放 + Spine skin 复用，
  一套骨架通吃；只有身体结构变了（四足 ↔ 拟人）才需要另一套。

## 代码侧已完成（本仓库）

| 改动 | 位置 |
| --- | --- |
| 启用引擎 `spine-4.2` 模块 + 加入 `includeModules` | `settings/v2/packages/engine.json` |
| `PetStage` 重写为 2D：`sp.Skeleton` 播 idle，缺资源退回 Graphics 占位，保留 `react()`/`frameTo()`/store 同步 | `assets/scripts/ui/PetStage.ts` |
| `MainView` 集成点与背景注释改 2D（`frameTo`/`react` 签名不变） | `assets/scripts/ui/MainView.ts` |
| 颜色注释去掉 3D 措辞 | `assets/scripts/ui/widgets.ts` |
| §3.4、§5、§5.9 改写为 2D Spine 规范 | `docs/06-UI设计规范.md` |
| 3D 管线标记退役 | `.cursor/rules/3d-asset-pipeline.mdc` |

**关键**：`PetStage` 已经能在无资源时正常出画面（占位简笔猫 + 呼吸动效），
所以在 Spine 资源到位前也不会白屏。

## 代码期望的资源约定（美术照此产出即可无缝接入）

- 落位：`assets/resources/spine/<name>/`，导出 `skeleton.json` + `.atlas` + `.png`（Spine 4.2）。
- `<name>` 由 `species` 解析（见 `PetStage.ts` 的 `SPECIES_SKELETON`）：
  - `pet_humanoid`：拟人主宠（后端返回 `default` 时的兜底，即当前主视觉）。
  - `pet_cat` / `pet_dog`：四足小宠猫/狗。
- 动画命名：至少要有 `idle`（循环）；主宠再加 `happy`（互动反馈会叠播一次再回 idle）、
  以及 `feed`/`bath`/`pet`/`play`/技巧/心情（§5.6 列表）。
- 换装挂点：Spine **slot** 用 `socket_` 前缀（对应旧 3D 的 socket 骨骼），如 `socket_hat`/`socket_neck`。
- 多皮肤/花色：用 Spine **skins**（Pro 功能），一套骨架换部件贴图即出新花色。

## 必须由人/外部完成的前置（我这边做不了）

1. **购买 Spine Pro license**（$379，合法发布 runtime 的前提；换装/网格/skins 需 Pro）。
   公司年营收超 $50 万美金则需 Enterprise。
2. **启用模块后重新导入引擎**：`engine.json` 已改，但 Cocos 编辑器需重新编译引擎
   （改 `includeModules` 后必做，否则引擎 barrel 解析失败 → 白屏，见 `cocos-toolchain` 规则）。
3. **产出 Spine 资源**（绑骨底图已备好，见下）：
   - 拟人主宠：以 `assets-src/concept/pet_humanoid_rigbase.png`（正面 A-pose、四肢摊开不重叠）
     为底图，可用 God Mode / Stretchy Studio AI 拆层 + 初绑，导入 Spine 编辑器精修挂点、
     skins、K 动画。
   - 四足小宠：以 `assets-src/concept/pet_quad_rigbase.png`（标准侧视、四腿+尾摊开、脊柱水平）
     为底图，参照 Spine 官方 Raptor 示例**手工**绑（脊柱分段 + 每条腿两骨 IK + 尾/耳），
     猫狗共用。AI 工具只认人形，四足帮不上。
   - 底图特意选了适合拆件的姿势；风格/配色沿用奶茶米色系（主色 `#D9BE96`）。

## 落地顺序（先打通再铺量）

1. 买 Spine Pro → 编辑器重导引擎（前置 1、2）。
2. **先只做拟人主宠一个 `idle`**，导出丢进 `assets/resources/spine/pet_humanoid/`，
   预览确认 `sp.Skeleton` 能播（最大风险点，先排掉）。
3. 补主宠其余动画 + 换装 skins。
4. 手工绑四足骨架，接收集/环境/赛跑。
5. 全项目确认不再用 3D 后，可在 `engine.json` 关掉 `3d` / `skeletal-animation` 减包。

## 验证

- 脚本类型检查：`node _research/typecheck.mjs`（已通过；不依赖真实资源）。
- 预览：编辑器重导引擎后打开主场景，`Ctrl+Shift+R` 强刷；无资源时应看到占位简笔猫，
  放入 Spine 资源后应看到骨骼动画。
- 微信小游戏端走 JS 运行时，Spine 支持稳定。
