---
name: ui-font-subset
description: Adds or updates the bundled Chinese UI font for WarmPet by subsetting a full CJK font down to the characters the project actually uses, then wiring it into Label creation. Use when the user says 字体 / 换字体 / 字太细 / 字像贴上去的 / 文字不融入, when text looks unlike the reference art, when new UI copy or new game entries were added (the subset must be regenerated or new glyphs render blank), or when asking about 包体 vs 字体 tradeoffs.
---

# 界面中文字体：子集化 + 接进 Label

**结论（已定）**：自带 **Resource Han Rounded CN Bold**（思源黑体的圆角衍生版，
SIL OFL 1.1），子集化后进主包。别用系统字体，也别用 BMFont。

## 为什么必须自带字体

系统黑体笔画细、末端是方的，`isBold` 只是**伪加粗**。量出来的差距（量法见
skill `ui-visual-parity` 的 `text-weight.mjs`）：

| 指标 | 竞品 | 我们（系统字体 + 描边） |
| --- | --- | --- |
| 字本体过渡像素 | **57.7%** | 19.7% |
| 字本体笔画占比 | **5.6%** | 0.2% |

「过渡像素」= 字色与底色之间的层次。竞品的字有肉，我们的是细线 ——
观感就是用户说的「像直接文本编辑上去的」。

**这个差距靠调参数补不出来。** 我连推两轮（字号 18→19、描边 2→3、描边色加深）
只从 29.2% 走到 28.7%，等于没动。第三轮才定位到字体本身。

## 三种方案为什么选子集化

| | BMFont 位图 | **子集化 TTF** | 微信系统字体 |
| --- | --- | --- | --- |
| 加新入口/改文案 | **要重烘图集** | 重跑脚本，可挂构建流程 | 无需处理 |
| 换字号 | 位图放大失真 | 矢量，任意字号清晰 | 清晰 |
| 多层描边 | 能烘进图 | 只能运行时单色 `LabelOutline` | 不能 |
| 字形统一 | 统一 | 统一 | **由设备决定，不统一** |

- **BMFont 的适用面很窄**：只有「固定的少量字 + 固定字号」才划算。
  本项目要持续加玩法入口和名字，字表一直在变 → 不适用。
  它唯一的优势（多层描边烘进图）**其实用不上** ——
  实测竞品也只是单层描边（`stroke-profile.mjs` 逐像素扫，
  笔画进出只有一档中间色，那是抗锯齿而非第二层描边）。
- **微信 `WX.GetWXFont`** 不占包体，但字形由用户设备决定 ——
  这恰好丢掉了我们要的统一圆体观感，与目标冲突。
- 子集化后只有 237KB，主包（上限 4MB，当前 2.09MB）放得下，**不必走远程**。
  远程反而要处理「字体没到货时的兜底」，白增复杂度。

## 授权：只能用 OFL，不能用阿里巴巴普惠体

| 字体 | 许可 | 能否子集化 |
| --- | --- | --- |
| Resource Han Rounded / 源泉圆体 / 昭源环方 | SIL OFL 1.1 | **可以**，允许修改与嵌入分发 |
| 阿里巴巴普惠体 | 自有协议 | **不可以** —— 2.0 明确禁止未授权 modify/convert 字体文件，子集化就撞这条 |

OFL 要求**随分发保留许可证**，所以 `LICENSE-ResourceHanRounded.txt` 和字体放同一目录。
上游仓库里的文件名是 `OFL-License.txt`（不是 `SIL_Open_Font_License_1.1.txt`，那个 404）。

## 工作流

```
- [ ] 1. 扫字表（排除注释，只取真文案）
- [ ] 2. 子集化（hinting 关掉，省一半体积）
- [ ] 3. 落位 + 取许可证
- [ ] 4. 让用户在编辑器里导入（生成 .meta）
- [ ] 5. 量 text-weight 验收
```

### 1. 扫字表

```bash
cd .build && node scripts/scan-chars-ui.mjs
```

**字表必须扫出来，不能人手维护。** 漏字的表现是运行时那个字变空白/方框，
不报错、只在特定界面出现，极难发现。

两个脚本分工：`scan-chars-ui.mjs` 剥掉注释、只取字符串字面量（给预算用），
`scan-chars.mjs` 扫全量含注释（兜底核对）。本项目实测
**全量 1398 字，真实界面文案只有 651 字** —— 差的那些全是注释。
按注释的字数买字体预算是纯浪费。

剥注释要用状态机而不是正则：正则处理不了「字符串里含 `//`」（如 URL），
会把后半个字符串当注释切掉、导致漏字。

### 2. 子集化

```bash
node scripts/subset-font.mjs [源字体] [字表] [输出目录]
```

**`hinting: false` 是体积的关键。** 带 hinting 时按单字 1.2KB 估算是 780KB，
关掉之后实测只有 237KB（woff2 112KB）。屏幕字号下 hinting 对渲染几乎无影响。

除汉字外必须补三类，否则它们变方框：ASCII（数字/字母/`/`/`:`，
「40/150」这种进度文本要用）、全角标点（中文界面的逗号句号和 ASCII 不同码位）、
界面用到的特殊符号。

⚠️ 弯引号 `" " ' '` 写进 JS 字面量会撞引号边界，报
`SyntaxError: Unexpected string` 且报错指向整行、看不出是哪个字符。
用 `'\u201c\u201d\u2018\u2019'`。

### 3. 落位

- 字体 → `assets/resources/fonts/rhr-bold.ttf`
- 许可证 → 同目录（OFL 要求）
- 完整字库和中间产物留在 `.build/font/`，**不进 assets**（13.3MB）

### 4. 编辑器导入（必须用户操作）

新 TTF 要编辑器生成 `.meta` 才能被 `resources.load` 找到，**CLI 做不了**。
Cocos 也不捕获脚本写入的文件，所以改时间戳没用。
判据：`assets/resources/fonts/rhr-bold.ttf.meta` 是否存在。

### 5. 接进代码的两个要点

```ts
// widgets.ts
export function preloadUIFont(done?: () => void): void  // bootstrap 里调，不 await
```

- **不要 await**。字体是观感增强不是功能依赖，加载失败要能继续进游戏
  （铁律「软失败不死亡」）。
- **必须回填先建好的 Label**。字体异步到货，而加载界面的文字在它之前就建好了；
  不回填的话首屏那几行永远是系统字体、和后面的界面不一致。
  做法是字体未到货时把 Label 存进 `pendingLabels`，回调里统一赋值。
- **自带圆体已是 Bold 字重，不要再叠 `isBold`**（小字会糊）。
  伪粗只在退回系统字体时才有意义：`label.isBold = !!opts.bold && !uiFont`。

## 字体到位后，描边只给 1

换上圆体 Bold 之后**描边不再承担加重任务**，宽度只给 1。

| 描边宽度 | 结果 |
| --- | --- |
| 1 | ✅ 极细一圈轮廓，压住底色、避免字发飘 |
| 2 | 12~15 号小字开始糊 |
| 3 | 相邻笔画的描边连成一片，把字之间的底色填满 → 读成「一坨棕色」 |

⚠️ 宽度 3 那版的「过渡像素占比」反而从 29.2% 涨到 56.4%，
**指标涨了不等于画面对了**（完整教训见规则 `visual-measurement-method`）。

配色跟着底色走，不要写死：底色浅（L>230）用深字，
底色中等（L≈190~220）用**白字 + 深棕描边**。
判断底色明暗要用 `pixel-grid.mjs` 打网格，别用直方图 —— 小字上分不清笔画和描边。

## 加了新文案之后

重跑第 1、2 步即可，其余不动。**忘了重跑的表现是新字变方框**，
所以加入口的同时就该跑一遍。可以挂进构建流程自动化。
