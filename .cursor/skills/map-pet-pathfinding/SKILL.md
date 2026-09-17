---
name: map-pet-pathfinding
description: >-
  为 WarmPet 家庭地图的宠物做「满地板 2D 游走 + 绕开道具障碍」，并在新增/替换道具图
  后重新生成障碍遮罩。涵盖：从道具 PNG 的 alpha 自动生成低分辨率障碍遮罩
  (mapPropMasks.ts)、栅格 A* 寻路 (mapPathfind.ts)、长按拖动宠物、以及用调试网格
  按格号定位「该走却标红/该挡没挡」。触发词：宠物走动 / 猫乱走 / 走进家具 / 绕开道具 /
  避障 / 寻路 / 障碍区域不对 / 红色区域 / 穿过道具 / 从道具中间穿过 / 拖动宠物 /
  移动宠物 / 加了新道具 / 从道具库拿道具 / 换了道具图 / 细杆家具。
---

# 家庭地图宠物寻路与障碍遮罩

选型结论和踩过的坑见规则 `pet-roaming-pathfinding`（每次自动读）。本 skill 是
**可执行的工作流**：加/换道具图后怎么重生成障碍、怎么调参、怎么用调试网格定位。

## 何时用

- 新增或替换了 `assets/resources/map/{props,alcoves}/*.png` → **必须重生成遮罩**，
  否则新道具没有障碍、或用旧形状（症状：猫穿过新家具，或绕开一个不存在的形状）。
- 用户说「猫走进家具了 / 障碍区域不对 / 某块该走却是红的」→ 用调试网格定位。
- 要调猫的可走范围、避障松紧、拖动手感。

## 新道具（不在现有 6 样里）红区准不准

- **是否成障碍 = 自动**：`loadProps` 里 `on:'floor'` 且非 `flat` 的道具加载后自动
  进 `obstacleNodes`。平铺物（地毯/坐垫/食盆）要在 `PROPS` 标 `flat: true` 才不挡。
- **形状准不准 = 有没有重跑遮罩脚本**：跑了就精准贴形状；忘跑则 `maskFor` 返回
  undefined、寻路退回矩形底座近似（不崩、不漏障碍，但不规则道具偏）。
- 想免掉「忘跑」：把 `gen-prop-masks.mjs` 挂进构建流程。

## 加/换道具图后重生成障碍遮罩（最常用）

```powershell
# 1) 依赖（首次）：pngjs 装在 .build/node_modules
cd .build; npm i pngjs
# 2) 生成 —— 读 props/alcoves 全部 PNG，写 assets/scripts/ui/mapPropMasks.ts
node scripts\gen-prop-masks.mjs
```

- 脚本把每张图的 alpha 降采样成 **20×24 的 0/1 网格**（'1'=实体、'0'=透明，
  `rows[0]` 是图最上一行），写成 TS 数据模块直接 import。
- **为什么离线 + TS**：Cocos 的 `Texture2D` 运行时默认不可读，读 GPU 像素不可靠；
  写成 TS 就没有异步/纹理可读性的坑。运营只需「丢图 → 跑脚本」，可挂进构建流程。
- 脚本在 `.cursor/skills/game-art-from-ai/scripts/gen-prop-masks.mjs`（版本控制），
  首次用先拷进 `.build/scripts/`（依赖在 `.build`，ESM 按脚本自身位置找 node_modules）：
  ```powershell
  Copy-Item .cursor\skills\game-art-from-ai\scripts\gen-prop-masks.mjs .build\scripts\ -Force
  ```
- **改了 `.build` 里的脚本要同步回 skill**，否则下次拿到旧逻辑。

生成后按名字自检遮罩形状对不对（斜楼梯应是三角、爬架应是「宽顶+细柱+宽底」）：

```powershell
Select-String -Path assets\scripts\ui\mapPropMasks.ts -Pattern "'prop_stairs'|'prop_tower'"
```

## 障碍如何喂给寻路（代码路径，改动时对照）

`MapView` 加载每个道具图后，把**实际渲染节点**收进 `obstacleNodes`（存 `{node, art}`），
`collectObstacleBoxes()` 读节点真实 `position` + `UITransform` 尺寸 + 按 `art` 从
`PROP_MASKS` 取遮罩，喂给 `new PetGrid(L, boxes)`。道具并发加载，`rebuildGridSoon()`
防抖收齐一批重建一次栅格。

- **障碍框必须读运行时真值**（缩放后尺寸），不是布局表 `PROPS` 的目标框 ——
  表里的框和 `placeArt` 缩放后对不上，会让障碍偏移。
- 平铺物（`PropSlot.flat`：地毯/坐垫/食盆）不收进障碍，猫可踩过。
- 护理室（`zone.art`）、楼梯（`prop_stairs`）也走同一套遮罩路线。

## 调参（都是单值，改一处）

`mapPathfind.ts` 顶部：
- `CELL`（栅格边长，现 16）：调细缝隙更清楚、更贵。
- `CAT_RADIUS`（猫半径，现 12）：避障松紧。大了堵死过道、相邻家具粘连。
- `MIN_BLOCK_W`（障碍每行最小宽度，现 40）：细杆家具（台灯杆只占图宽 10%）照实标
  会被猫从两侧空隙穿过 → 每行有实体就撑到至少这么宽。验证：探针读台灯附近每行
  障碍格宽度，灯杆段应 ≥32px（不是一格）。

`gen-prop-masks.mjs` 顶部：`COLS×ROWS`（遮罩精度）、`ALPHA`（实体阈值）、
`FILL`（降采样格实体占比阈值，去抗锯齿边缘）。

`mapLayout.computeLayout`：`petMinX/maxX/petMinY/petMaxY`（可走范围）。
护理室/楼梯/家具由遮罩挡，**别靠缩小范围去躲**。

## 用调试网格定位「障碍不对」

1. `MapView` 顶部 `DEBUG_GRID = true`，强刷预览（`Ctrl+Shift+R`）。
2. 画面出现：蓝格=可走、红格=障碍、橙线=猫当前路径、每格编号（左→右、上→下、从 1）。
3. 让用户报格号：「第 653 号该走却是红的」。
4. **先确认不是旧编译**（见下），再看遮罩/膨胀：
   - 该走却红 → 遮罩把透明处标实了（调 `FILL`/`ALPHA` 重生成），或膨胀太大（降 `CAT_RADIUS`）。
   - 该挡没挡 → 遮罩把实体标空了，或该道具没进 `obstacleNodes`。
5. 排查完 **`DEBUG_GRID = false`**。

## ⚠️ 编译滞后会让你查错方向（本项目反复中招）

改完代码，编辑器编译滞后甚至卡住，截图/探针跑的是**旧画面**。用户说「还是不对」时
**先确认他看的是不是旧编译**：

```powershell
$dir = "temp\programming\packer-driver\targets\preview\chunks"
Get-ChildItem $dir -Recurse -File -Filter *.js | Select-String -Pattern "你这次的独特字符串" -List
# 搜不到 = 旧编译，等编译 / 编辑器重新导入，别改逻辑
```

卡死超 10 分钟：关 Cocos → 删 `temp/` `library/` `build/` → 重开（**不删 `.meta`**）。

## ⚠️ 探针读 UITransform 尺寸可能是 nil

playwright `evaluate` 里 `tr.width`/`tr.contentSize` 可能取到 undefined（上下文
getter 问题），**不代表运行时代码错**。改成在游戏代码里 `console.log` 打印真值，
探针捕获 console 输出 —— 那才是运行时真值。

## 长按拖动宠物（三手势共存）

`MapView.setupInput`：短按宠物=互动、长按宠物拖=移动、按空白拖=平移地图。
- 长按用 `update(dt)` 累计（`LONG_PRESS_SEC`）触发 `beginDragPet`；手指先移动超阈值
  则取消长按待命、退回拖地图。
- 拖宠物时 `Tween.stopAllByTarget` 停散步；松手 `endDragPet` 用 `petGrid.snapToFree`
  吸附到最近可走点，延时重启散步。
