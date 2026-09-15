---
name: asset-change-verification
description: Verifies that an art or UI change actually reached the screen in the WarmPet Cocos project, and diagnoses silent failures where exit code is 0 but nothing changed. Covers the full chain — generate, key out the background, import, trigger reimport, probe runtime values, measure outline strength, and zoom in for eyeball confirmation. Use when the user says 改了没生效 / 没什么变化 / 图案还是没变 / 感觉一样, when a batch generation job "finished" suspiciously fast, when cutout output size equals input size, when a screenshot measurement returns absurd numbers, or when confirming whether new PNGs in assets/resources are live in the preview.
---

# 确认美术改动真的上屏了

**核心问题**：磁盘 PNG 是新的、代码引用正确、加载回调成功 —— 这三件事全部成立时，
屏幕上依然可能是旧画面。本 skill 是一条**从产物一路查到运行时真值**的流程。

选型结论与踩坑记录在规则 `silent-failure-and-verification`（自动读取），
本文件只讲怎么做。

## 排查顺序（必须按序，别跳）

每一步都可能是终点。**跳过前面几步直接截图测量是最常见的错误**，
因为量到的是旧纹理，数字会稳定地骗你。

```
- [ ] 1. 产物存在且是新的（不是「生成失败」也不是「没下载」）
- [ ] 2. 抠底真的抠掉了东西（尺寸变了、seam-check 通过）
- [ ] 3. 文件已进 assets/ 且 library/ 缓存已更新（否则停下来找用户）
- [ ] 4. 运行时探针：节点存在、frame 名正确、active=true
- [ ] 5. 运行时渲染尺寸够大（细节留得住）
- [ ] 6. 测量 + 放大肉眼确认
```

---

## 步骤 1：产物存在且是新的

**别看日志说什么，看文件系统。**

```powershell
Get-ChildItem "lovart\raw\<name>" -Filter *.png |
    Sort-Object LastWriteTime |
    ForEach-Object { "$($_.LastWriteTime.ToString('HH:mm:ss'))  $($_.Length)  $($_.Name)" }
```

对账两件事：**最新文件的时间戳**是否在本次运行之后、**耗时**是否合理
（单张图约 60~170 秒；「10 秒跑完 4 张」= 全部失败）。

### Lovart 出图：不要用 `--download`

`--download` **静默失败** —— 退出码 0、日志有 `[image] https://...`、
目录里空的。自己抓 URL 下载：

```powershell
$env:PYTHONIOENCODING = 'utf-8'   # ⚠️ 不要设 PYTHONUTF8=1，中文提示词会碎
$skill = Join-Path $HOME '.cursor\skills\lovart-api\scripts\agent_skill.py'
$p = ' ' + ([IO.File]::ReadAllText("prompts\$n.txt")).Trim()   # 前导空格防特殊字符被吃
& python3 $skill chat --prompt $p --json 2>&1 | Out-File "raw\$n\run.log" -Encoding utf8
$m = [regex]::Match([IO.File]::ReadAllText("raw\$n\run.log"), 'https://[^\s"]+\.png')
if ($m.Success) { Invoke-WebRequest -Uri $m.Value -OutFile "raw\$n\$n.png" -TimeoutSec 120 }
else { Get-Content "raw\$n\run.log" -Tail 12 }   # 全量看尾部，不要关键词过滤
```

**写成内联，不要 `powershell -File`** —— 嵌套调用会让子进程完全不输出
（日志 3 字节、退出码 1）。

---

## 步骤 2：抠底真的抠掉了东西

```
node scripts/cutout.mjs <in.png> <out.png> 12
node scripts/resize.mjs <out.png> <out_512.png> 512
node scripts/seam-check.mjs <目录>
```

**`cutout.mjs` 打出的输入输出尺寸相同 = 一个像素都没抠掉。**

容差用 **12**，不是 26。脚本已改为**局部容差**（拿像素和「把它带进来的
背景邻居」比，而非和全局白色比），因为模型经常无视「纯白背景」
把底烘成**带渐变的奶油色**。局部容差下**容差越大越危险**：

| 局部容差 | 12 | 18 | 26 |
| --- | --- | --- | --- |
| 育婴室填充率 | **65%** | 13% | 4% |

大容差会从描边薄弱处漏进画面内部把物件掏空。

`seam-check.mjs` 的验收线：**四角 0/4 不透明**、**外圈 ≤ 5%**。
四角 4/4 = 实心矩形（抠底完全没生效）；外圈大面积不透明 = 有烘进去的背景板。

---

## 步骤 3：library/ 缓存是否已更新（最容易漏）

**Cocos 的资源监听不捕获脚本/工具写入的文件。** 磁盘图是新的，
预览里还是旧的，且不报任何错。

```powershell
$root = 'C:\Users\Administrator\Desktop\warmpet'
foreach ($n in 'alcove_bath', 'alcove_care') {
    $png = Get-Item "$root\assets\resources\map\alcoves\$n.png"
    $m = [IO.File]::ReadAllText("$root\assets\resources\map\alcoves\$n.png.meta")
    $u = ([regex]'"uuid":\s*"([0-9a-f\-]{36})"').Match($m).Groups[1].Value
    $lib = Get-ChildItem "$root\library\$($u.Substring(0,2))" -Filter "$u*.png" -EA SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    "$n png=$($png.LastWriteTime.ToString('HH:mm:ss')) lib=$(if($lib){$lib.LastWriteTime.ToString('HH:mm:ss')}else{'MISSING'})"
}
```

**`lib` 早于 `png` → 停下来，后面的测量全部无效。**

改 `LastWriteTime` 触发不了重新导入（实测等 60 秒无反应）。
**唯一可靠解法：让用户在编辑器资源管理器里右键目标目录 →「重新导入资源」。**
不要杀掉正在运行的编辑器 —— 可能有未保存的场景改动。

---

## 步骤 4~5：运行时探针

`probe-artsize.mjs` 读分区框尺寸。要查具体节点用这个模板 —— 关键是
**数子节点 + 打 frame 名 + 打 contentSize**，三个一起才能定位：

```js
const walk = (n) => {
  if (/SpriteLayer|ColorIcon_/.test(n.name)) {
    const kids = (n.children || []).map((c) => {
      const s = c.getComponent(cc.Sprite);
      const t = c.getComponent(cc.UITransform);
      return `${c.name} frame=${s && s.spriteFrame ? s.spriteFrame.name : 'NONE'}` +
        ` size=${t ? Math.round(t.contentSize.width) + 'x' + Math.round(t.contentSize.height) : 'noTR'}` +
        ` active=${c.activeInHierarchy}`;
    });
    out.push(`${n.name}: ${kids.length} children`, ...kids);
  }
  for (const c of (n.children || [])) walk(c);
};
```

怎么读结果：

| 症状 | 结论 |
| --- | --- |
| `SpriteLayer: 0 children` | 挂载代码一次没跑（查 `if (cb) cb(doWork())` 这类写法） |
| `frame=NONE` | 加载失败或还没回来 |
| `frame=<正确名> active=true` **但画面没变** | 图上屏了，问题在**尺寸**或**图本身长得太像** |
| `size=noTR` | 没有 UITransform，触摸也命中不到 |

**`active=true` 只证明加载成功，不证明看得见。** 渲染尺寸太小会让多色细节
被降采样吃掉：图标从 `ENTRY * 0.52`（约 29px）放大到 `0.74` 才留得住。

---

## 步骤 6：测量 + 放大肉眼确认

```
node scripts/shot-now.mjs <out.png>
node scripts/edge-strength.mjs <竞品.png> <我们.png> <rx0> <ry0> <rx1> <ry1>
node scripts/crop-zoom.mjs <in.png> <out.png> <x> <y> <w> <h> 6
```

### 「简陋 / 没变化」查轮廓强度，不要减元素

`edge-strength.mjs` 量相邻像素明度落差。实测洗浴间壁龛：

| 指标 | 竞品 | 我们（旧） |
| --- | --- | --- |
| 明显轮廓占比（落差 >20） | **46.3%** | 22.8% |
| 强轮廓占比（落差 >50） | **26.5%** | 13.4% |
| 最深像素明度 | **91** | 59 |

**三个数必须一起读。** 我们有比竞品**更深**的颜色（59 < 91）却只有一半轮廓
→ 深色全堆在一两块大面积暗部，而竞品把对比度**均匀分配到每个物件边界**。

结论：**竞品元素更多反而更清楚，靠边界对比而不是元素少。**
验收线：明显轮廓占比 **≥ 25%**（单图）。本项目四张实测改后 22.5%~31.5%。

### 三个测量陷阱

- **数值离谱先看图**。底部区量出「彩色占比 71%、明度 63」是量到了
 **FPS 调试面板**。有调试面板时底部采样不可用。
- **整图统计稀释小面积问题**。按钮区色相 1/12 vs 竞品 8/12 时，
 整图彩色占比却已持平（9.2% vs 9.8%）—— 墙和地板占了大头。小元素单独框。
- **必须放大肉眼看**。414×896 里一个壁龛只有 116×135px。
 我曾靠「色相 4/12 → 6/12」判断生效，`crop-zoom` 放大后发现画面几乎没变。
 **把竞品同部位裁同倍数并排看**，单看自己的图判断不了。

---

## 输出与脚本

改动生效的判定要**同时**满足：

1. `library/` 时间戳 ≥ PNG 时间戳
2. 运行时探针 `frame=<正确名> active=true`
3. 渲染尺寸达到目标值（`probe-artsize.mjs`）
4. `edge-strength.mjs` 明显轮廓占比 ≥ 25%
5. `crop-zoom.mjs` 放大后肉眼能看出差别

**任一条不满足就不要向用户报「已生效」。**

| 脚本 | 用途 |
| --- | --- |
| `scripts/cutout.mjs` | 局部容差抠底（默认容差 12） |
| `scripts/resize.mjs` | 缩到长边 512 |
| `scripts/seam-check.mjs` | 四角 alpha / 外圈不透明比例 / 外圈主色 |
| `scripts/edge-strength.mjs` | 轮廓清脆度，查「简陋 / 糊成一团」 |
| `scripts/crop-zoom.mjs` | 裁一块整数倍最近邻放大 |
| `scripts/probe-artsize.mjs` | 读运行时分区框尺寸 |
| `scripts/shot-now.mjs` | 无头浏览器截预览 |

出图侧的描边与背景纪律见 skill `game-art-from-ai`；
截图测量的完整数值表见 skill `ui-visual-parity`；
选型结论与全部踩坑见规则 `silent-failure-and-verification`。
