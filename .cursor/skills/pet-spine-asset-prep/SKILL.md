---
name: pet-spine-asset-prep
description: 为 2D 骨骼动画（Spine/DragonBones/LoongBones）准备宠物角色的分件素材。生成/整理按身体部位分开的透明 PNG，批量去除 AI 生成图的白底，并给出接入 Cocos（sp.Skeleton）的要点。当用户要做宠物骨骼动画、拆分件图、给角色绑骨备料、处理 Spine 贴图白底/透明问题，或把骨骼资源接进本项目时使用。
disable-model-invocation: true
---

# 宠物骨骼素材备料（Pet Spine Asset Prep）

把一只宠物变成可绑骨的素材，并接进本项目的 Cocos Spine 舞台（`assets/scripts/ui/PetStage.ts`）。
选型与踩坑背景见规则 `.cursor/rules/2d-skeletal-art-tooling.mdc`。

## 流程总览

```
1. 出分件图    每个身体部位一张透明 PNG（头/耳/身/尾/前腿/后腿…）
2. 去白底      AI 生成图常是 RGB 白底 → 跑 remove_bg.py
3. 核实透明    确认变成 RGBA、猫脸内部高光没被挖空
4. 绑骨        LoongBones 手动 / SOON / 代码生成（四足没有 AI 一键）
5. 接入 Cocos  放 resources/spine/<name>/，对齐动画命名
```

## 1. 出分件图（部件划分）

四足猫最小可用部件：`head(含耳/脸) / body / tail / leg_front / leg_back`（左右腿复制翻转即可）。
用图像生成时**每个部件单独出一张**，要求：只画该部件、完整形状（补全被遮挡处）、居中、透明底。
注意：**多数图像模型即使要求透明也会给白底**，所以第 2 步必做。

## 2. 去白底（关键，必做）

AI 生成图常是 `RGB` 无 alpha，预览看着透明是假象，进引擎会有白框。
用 flood-fill 从四角只清外部白色，**不伤脸内高光/奶油色毛发**：

```bash
# 处理整个目录里的 PNG（分件图建议落在 assets-src/concept/parts/）
python .cursor/skills/pet-spine-asset-prep/scripts/remove_bg.py assets-src/concept/parts

# 或指定文件；白边残留就调大阈值
python .cursor/skills/pet-spine-asset-prep/scripts/remove_bg.py a.png b.png --thresh 80
```

依赖：`Pillow`（`pip install pillow`）。脚本**原地覆盖**，先备份原图。

## 3. 核实透明

```bash
python -c "from PIL import Image; im=Image.open('assets-src/concept/parts/cat_head.png'); print(im.mode, im.getbbox())"
```

要看到 `RGBA`；`getbbox()` 明显小于整图 = 背景已清。再肉眼看一眼别把眼睛高光挖空。

## 4. 绑骨（本项目只有四足，没有 AI 一键这条路）

- **四足** → LoongBones 手动绑（免费，导 Spine/DragonBones）或让 agent 代码生成骨架+idle；SOON 宣称多物种但需实测。
- LoongBones 操作坑见规则文件（导入靠拖拽、别用人形预设、自动装配要求骨名=图名）。
- God Mode / Meowa 这类自动绑骨**写死人形**，四足用不了；「拟人主宠」方案 2026-09-07 已废弃，不要再走那条分支。

## 5. 接入 Cocos（本项目约定）

- Spine 三件套放 `assets/resources/spine/<name>/`，运行时 `resources.load('spine/<name>')`。
- 动画命名对齐 `PetStage.ts`：`IDLE_CANDIDATES` / `WALK_CANDIDATES` / `HAPPY_CANDIDATES` / `ACTION_ANIM`。
- 非预乘图集设 `skel.premultipliedAlpha = false`，否则透明边算成白色出白框。
- Spine 版本要对上引擎 runtime（SOON 出 4.2.43）。
- 换新主宠改 `SPECIES_SKELETON` / `FALLBACK_SKELETON`；没 default 皮肤要 `setSkin`。
- 预览要起假后端：`node _research/mock-server.mjs`，编辑器场景里看不到宠物是正常的（运行时加载）。
