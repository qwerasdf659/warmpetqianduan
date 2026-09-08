---
name: design-mockup-archive
description: >-
  Generates and iterates WarmPet UI / character design mockups (home screen,
  loading screen, character sheets, comparison sheets) and archives them into
  `docs/` under the project naming convention, keeping exactly one file tagged
  定稿. Use when the user asks to 出图 / 出一张设计稿 / 首页图 / 立绘 / 花色表 /
  对比图, to 改设计稿 (iterate on an existing mockup), or to 存进 docs / 保存设计稿.
---

# 设计稿产出与归档

产出 WarmPet 的界面与角色设计稿，然后按项目命名规范归档到 `docs/`。
定稿结论本身在规则里，**出图前先读**：首页看 `first-screen-and-loading`，
猫狗形象看 `spine-2d-pet`，设计 token（色值、字号、圆角、间距）看
`docs/06-UI设计规范.md` §2。

## 工作流

```
- [ ] 1. 出图：提示词里带全设计 token 与形象约束
- [ ] 2. 迭代：一次只改一处，上一版当 reference，其余部分完整重述
- [ ] 3. 归档：scripts/archive-mockup.ps1，定稿标签保持唯一
```

## 1. 出图

用 `GenerateImage`，竖屏界面取 `9:16`，规格表/对比表取 `16:9` 或 `4:3`。

**提示词必须显式带上这几组约束**，缺一样就会飘：

| 约束 | 内容 |
| --- | --- |
| 色值 | 底 `#F2E4D0`、面板 `#FFFCF7`、主色 `#D9A05B`、深棕字 `#4A3728`。写十六进制，别写"暖色调" |
| 比例混搭 | 人物**正常日系比例**（约七头身），猫狗**Q 版**。必须同时写明「渲染语言统一：同样的手绘赛璐璐、同样描边粗细、同一光照方向」——头身比不同没关系，渲染方式不同才会读成两张图拼的 |
| 猫 | 高窄**尖立三角耳**、细长上翘尾、身形纤细、小粉三角鼻、闭嘴微笑 |
| 狗 | **小立耳**（短厚圆尖、间距开、明显比猫小一圈）+ **深色圆鼻头** + 略长吻部 + 张嘴吐舌。狗的辨识度靠脸不靠耳朵 |
| 眼睛 | 大圆眼 + **左上角白色五角星高光** + 腮红。这是定稿的美术方向 A |
| 人物 | 全身着装、自然站姿、平视机位。校园风（白衬衫/水手服 + 百褶裙 + 中筒袜），不要把镜头或设计重点放在腿部——小游戏要过备案和适龄提示，角色设计越干净越省事 |
| 底部留白 | 合规块会吃掉屏幕下三分之一，构图时关键元素别放底部（`docs/06-UI设计规范.md` §6.5） |

**生成图里这些内容全是模型编的，不要当真**：著作权人、软著登记号、ISBN、审批文号、
互推位卡片上的文案。它们只是占位，别往提审材料里抄。

## 2. 迭代

**一次只改一处。** 把上一版路径传给 `reference_image_paths`，并在提示词里
**完整重述其余部分**——只写"其他不变"会飘。

即使给了 reference，模型仍会顺手改动没让它改的地方。实测最常飘的三处，
改完必须逐项核对：

- 猫狗的**大小和位置**（会自己缩放、挪位）
- **底部文字块的间距**（会被主按钮压住）
- 标题 logo 的**字形和字数**（改文案时尤其要核对是不是四个字都对）

## 3. 归档

在仓库根目录运行（本机只有 Windows PowerShell 5.1，没装 `pwsh`）：

```
powershell -NoProfile -ExecutionPolicy Bypass -File .cursor/skills/design-mockup-archive/scripts/archive-mockup.ps1 -In <生成图路径> -Label "进度条版" -Final
```

三种模式：

| 参数 | 产出 | 用于 |
| --- | --- | --- |
| `-Label "进度条版" -Final` | `首页设计稿-9-定稿-进度条版.png` | 新定稿，序号自动 +1 |
| `-Label "备选-完整合规块版" -NoSeq` | `首页设计稿-备选-完整合规块版.png` | 带前缀但不占迭代序号 |
| `-Label "宠物花色表-猫狗各5款" -Raw` | `宠物花色表-猫狗各5款.png` | 规格表，前缀和序号都不加 |

- `-Final` 会先把同前缀旧文件名里的`定稿-`摘掉，**保证定稿唯一**——人接手时才分得清
  哪版是最终。旧版本不删，留作对比，要回退是现成的。
- 脚本末尾打印全部设计稿和总体积。这些图**会进 git**（`.gitignore` 没排除 `docs/*.png`），
  单张约 2 MB，迭代中间版攒多了要清。

> **不要用 `-Prefix ""` 来实现"不加前缀"**，Windows PowerShell 的 `-File` 调用会把空串
> 当成缺参数报错。这就是 `-Raw` 存在的原因。

## 两条容易搞错的事

**`docs/` 下的设计稿不是可入包资源。** 它们是 9:16 给人看的参考。真要进游戏必须另出
**1024×1024 正方形**——iOS 的 PVRTC 要求 2 的幂且长宽相等，竖图直接进包会被强行拉成
正方形、体积暴涨（`docs/06-UI设计规范.md` §4.3）。而且首屏资源占主包，上限 4 MB。

**带中文的 `.ps1` 必须存成 UTF-8 with BOM。** Windows PowerShell 5.1 按系统 ANSI 码页
（中文机器上是 GBK）读脚本文件，没有 BOM 的话多字节字符会把换行一起吃掉，
**表现是莫名的语法错误**（`缺少 ")"`、`字符串缺少终止符`），而文件本身看起来完全正常。
新建或改完带中文的脚本后转一次：

```
$p = '<脚本路径>'
$txt = [System.IO.File]::ReadAllText($p, (New-Object System.Text.UTF8Encoding $false))
[System.IO.File]::WriteAllText($p, $txt, (New-Object System.Text.UTF8Encoding $true))
```

**控制台看中文文件名也要先设编码**，否则输出是乱码。脚本里已经设了
`[Console]::OutputEncoding`；手工 `ls` 时自己补一句：

```
[Console]::OutputEncoding=[System.Text.Encoding]::UTF8
```
