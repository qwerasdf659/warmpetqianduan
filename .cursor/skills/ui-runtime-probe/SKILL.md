---
name: ui-runtime-probe
description: Probes the running WarmPet Cocos preview to diagnose why code-drawn UI (Graphics/Label/runtime node trees) is blank, missing, mispositioned, or eats every click. Reads runtime truth — node existence, active, child count, contentSize, world coords — instead of guessing from screenshots. Use when the user says 为什么空白 / 没显示 / 点哪都跳 / 气泡是空的 / 按钮点不动 / 改了没生效 for a map/HUD/action-bar screen, or when a code UI change needs confirming on-screen. For art-asset (PNG) changes use asset-change-verification instead.
---

# 探测运行时 UI 节点树

代码画的 UI 失败（空白 / 不显示 / 点不动 / 点哪都跳）**长得都一样**，
光看截图会连着猜错好几轮。这条 skill 是「读运行时真值」的可执行流程。

选型结论与踩坑记录在规则 `ui-runtime-verification`（自动读取），本文件只讲怎么做。
美术资源（PNG）没上屏走 `asset-change-verification`，别混。

## 前置：脚本落位 + 预览在跑

首次用先把脚本拷进 `.build/`（依赖装在 `.build/node_modules`，脚本按自身位置往上找）：

```powershell
Copy-Item .cursor\skills\ui-runtime-probe\scripts\*.mjs .build\scripts\ -Force
```

确认预览(7456)和假后端(8899)都起着，否则探针连不上会**明确报错**
（不要把「连不上」当成「节点不存在」）：

```powershell
try { Get-NetTCPConnection -LocalPort 7456 -State Listen -EA Stop|Out-Null; 'preview=UP' } catch { 'preview=DOWN' }
try { Get-NetTCPConnection -LocalPort 8899 -State Listen -EA Stop|Out-Null; 'mock=UP' } catch { 'mock=DOWN' }
```

预览没起：让用户在编辑器点预览。假后端没起：`node _research/mock-server.mjs`。

## 排查顺序（按序，别跳）

```
- [ ] 0. 编译产物里有没有你这次的改动（编译滞后会骗过截图）
- [ ] 1. 通用节点探针：节点在不在、active、子节点数、contentSize、世界坐标
- [ ] 2. 对照判据表定位（下方）
- [ ] 3. 需要时手动调一次刷新函数，隔离「逻辑错」还是「没被触发」
- [ ] 4. crop-zoom 放大肉眼确认内容真的可见
```

## 步骤 0：先确认跑的是新代码

编辑器编译**滞后甚至卡死**（实测卡过 20 分钟），此时截图是旧画面、
看起来就像改动没生效。**搜产物里有没有你这次加的新符号/新注释**，
别看时间戳（chunk 是 hash 命名，内容变了时间戳可能不变）：

```powershell
$dir = "temp\programming\packer-driver\targets\preview\chunks"
$hit = Get-ChildItem $dir -Recurse -File -Filter *.js | Select-String -Pattern "你这次独特的函数名或注释" -List
if ($hit) { "新代码已进产物 ✓" } else { "还是旧编译 —— 别急着改代码" }
```

搜不到：等编译，或关 Cocos → 删 `temp/` `library/` `build/` → 重开（不删 `.meta`）。
预览标签页要 **`Ctrl+Shift+R`** 强制刷新。

## 步骤 1：通用节点探针

```powershell
# 传节点名正则，读所有匹配节点的运行时状态
node scripts/probe-nodes.mjs "PetBubble|MapActionBar|MapBtn_|MapInput" 24000
```

输出每个节点的 `active / kids（子节点数）/ size（contentSize）/ world（世界坐标）`，
有 Sprite 打 `frame`、有 Label 打 `text`。

## 步骤 2：判据表

| 读到的真值 | 结论 |
| --- | --- |
| 匹配 0 个节点 | 建节点的代码没跑（查可选回调 `if(cb)cb(...)`、early return）或名字正则不对 |
| 有节点但 `kids=0`（本应有内容） | 内容没画（画图函数没被调，或被 `removeAllChildren` 清了没重画） |
| `active=false` | 被某个刷新分支隐藏了 |
| `size=0x0` | 触摸命中不到（拖动却照样能用 → 症状「能拖但点不动」） |
| `world` 超出 `[0,vw] / [0,vh]` | 画在屏幕外（宠物走到边缘时气泡会被裁，是预期） |
| `frame=NONE` | Sprite 加载失败或没回来 |
| `text="🐟"` 之类 | emoji 不在子集字体里 → 必然空白，改用矢量图标 |
| kids/坐标都正常仍空白 | 尺寸太小 / 颜色同底色 / 被兄弟层盖住 → crop-zoom 放大看 |

## 步骤 3：手动调刷新，隔离「逻辑错」vs「没触发」

`kids=0` 且刷新标志位是空的（如 `bubbleNeed=''`）时，在探针里手动调一次刷新函数：
**调完 `kids` 变 1 = 逻辑对、只是没被触发**（首刷时序陷阱，见
`ui-runtime-verification`）；**调完仍 0 或报错 = 逻辑本身错**。

现成的专项探针（可当模板改）：

```powershell
node scripts/probe-bubble.mjs      # 宠物气泡：need / 图标层子节点数 / 手动 refresh 对比
node scripts/probe-actionbar.mjs   # 互动条：zones 无 lobby / 条子节点数 / 点空地板不跳走
```

`probe-actionbar.mjs` 还会**点一下空地板**验证「点哪都跳转」已修
（`mapStillAlive=OK` = 没跳走）。

## 步骤 4：放大肉眼确认

节点树对了不等于看得见（尺寸/颜色/遮挡）。先读世界坐标定位，再裁那一块放大：

```powershell
node scripts/crop-zoom.mjs <in.png> <out.png> <x> <y> <w> <h> 8
```

⚠️ 世界坐标是「屏幕中心为原点」，crop-zoom 的 x/y 是**左上角为原点的像素**，
要换算（截图分辨率可能和视口不同，headless 实测出过 720x846）。

## 布局校验（不依赖预览）

改了互动条/宠物落位这类布局常量，先跑纯算术校验，几档屏高都要过：

```powershell
node scripts/check-actionbar.mjs   # 互动条上沿 vs 宠物落位，846/896/736/640 四档
```

⚠️ 校验脚本内含布局常量的**副本**，改了 `mapLayout.ts`/`MapActionBar.ts`
要同步这里，否则查的是假的（规则 `map-scroll-view`）。

## 脚本清单

| 脚本 | 用途 |
| --- | --- |
| `scripts/probe-nodes.mjs` | 通用节点树探针（传名字正则） |
| `scripts/probe-bubble.mjs` | 宠物需求气泡专项 |
| `scripts/probe-actionbar.mjs` | 地图互动条 + 点空地板不跳走 |
| `scripts/check-actionbar.mjs` | 互动条落位纯算术校验（多档屏高） |
| `scripts/crop-zoom.mjs` | 裁一块整数倍最近邻放大 |
| `scripts/shot-now.mjs` | 无头浏览器截预览到绝对路径 |

**改了 `.build/scripts/` 下的脚本要同步回本目录**，否则下次读 skill 拿到旧逻辑
（规则 `authoring-rules-and-skills`）。
