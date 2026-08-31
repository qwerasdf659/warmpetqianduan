---
name: pet-part-rig-prep
description: >-
  Produces rig-ready 2D pet part art for Spine skeletal animation: generate each
  body part (head, ears, eyes, body, legs, tail) as a separate image, key out the
  flat background to a transparent PNG, and lay parts out with the naming and
  checklist a Spine import needs. Use when the user wants to 生成宠物分件图 /
  分件立绘, 去白底 / 抠白底 / remove background, or 备/准备绑骨素材 (prepare
  rigging/skeleton assets) for a 2D pet or character.
---

# 宠物分件图 → 去白底 → 绑骨素材

把「一张整图的宠物」变成「Spine 可绑骨的分件透明图」。产出是一套按部件命名、
背景已透明、比例一致的 PNG，导进 Spine 编辑器就能绑骨、导出后进 Cocos（接入细节见
规则 `spine-2d-pet`）。

## 工作流

```
- [ ] 1. 生成分件图：每个部件单独出图，纯色平背景，风格/比例一致
- [ ] 2. 去白底：用 scripts/dewhite.ps1 把平背景抠成透明
- [ ] 3. 备绑骨素材：按标准命名归到一个目录 + 写 parts.json 清单
```

### 1. 生成分件图

用图像生成工具（`cursor` 的 `GenerateImage`，或 `lovart-api` skill）**逐个部件**出图，
不要一次出整只。标准部件清单与生成提示词要点见 [reference.md](reference.md)。

关键约束（否则后面绑骨对不齐）：

- **纯色平背景**，且背景色**不能出现在宠物身上**。浅毛/白猫用洋红 `#FF00FF`；深色宠物用白 `#FFFFFF`。
- 同一批部件**同一画风、同一光照、同一线条粗细**，侧视（四足行走机位）。
- 各部件在画面里**相对大小要对**（头和身子的比例得能拼回一只），部件间留白、不要粘连。

### 2. 去白底（抠平背景）

`scripts/dewhite.ps1` 按「到背景色的距离」做色键，带柔化边。默认抠白底：

```
pwsh scripts/dewhite.ps1 -in <输入文件或目录> -out <输出目录>
```

浅毛宠物在洋红底上生成时，改抠洋红：

```
pwsh scripts/dewhite.ps1 -in parts_raw -out parts -bgR 255 -bgG 0 -bgB 255 -tol 40
```

参数：`-tol` 容差（越大抠得越狠）、`-feather` 边缘柔化带宽。输入是目录时批量处理整目录 PNG。

### 3. 备绑骨素材

- 把透明部件按 [reference.md](reference.md) 的**标准部件名**重命名，放进一个目录，如 `pet_parts/<species>/`。
- 生成 `parts.json` 清单（部件名 + 建议锚点/父级），给绑骨时对照。
- 交付前对照 [reference.md](reference.md) 的「Spine 绑骨/导出检查表」——**导出格式要和引擎 spine 版本一致**（本项目 3.8），
  贴图**不要预乘**（straight alpha），否则进 Cocos 会出白边（见规则 `spine-2d-pet`）。

## 校验回路

抠完必看：把透明 PNG 叠在**深色和浅色两种底**上各看一眼——

- 残留背景色边 → 调大 `-tol`；
- 宠物本体被抠出洞（尤其浅毛）→ 说明背景色和毛色太近，**换背景色重新生成第 1 步**，别硬调参数。
