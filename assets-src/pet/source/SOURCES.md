# 外来网格的来源与授权

这个目录放**采购/下载的原始网格**，是管线的输入，不是产物。
产物在 `assets-src/pet/*.glb`，出包副本在 `assets/resources/models/`，
对应关系和 sha256 见 `assets-src/BUILD.json`。

`art-sourcing.mdc` 的授权红线要求「允许商用 + 允许修改」，CC-BY 还要署名。
**署名页要在上线前就位**，那条规则里专门提过「上线前才发现要加一个页面很被动」。
所以每加一具网格，这张表就要加一行。

| 文件 | 来源 | 授权 | 署名文本 | 状态 |
| --- | --- | --- | --- | --- |
| `cat_source.glb` | Poly by Google，经 poly.pizza 分发；原文件名 `Cat by Poly by Google - 6dM1J6f6pm9.glb`，条目 ID `6dM1J6f6pm9` | **待核实**（poly.pizza 上 Poly by Google 的条目通常是 CC-BY，少数 CC0） | 待定 | ⚠️ 上线前必须回站上确认并抄下确切的授权与作者字段 |
| `cat_normalized.glb` | 由 `cat_source.glb` 归一化而来（高 2.0 / 朝 +Z） | 同上，衍生作品 | 同上 | 派生物，随源 |
| `qchibi_normalized.glb` | **不明**——从 `temp/dryrun/` 抢救出来的唯一副本，没有留下出处 | **不明** | — | ⚠️ 来源不明，**未经确认不得进出包路径**；查清前只能当实验素材 |

## 为什么要单独记这个

模型文件本身不带授权信息。下载时知道，三个月后就只剩一个文件名——
`cat_source.glb` 这个名字里已经看不出它来自 Poly 了，
是靠 `docs/` 下那份同字节的副本还留着原始文件名才追回来的（那份已删，信息收进本表）。

## 加新网格的动作

1. 下载时**连同页面 URL、作者名、授权类型一起抄进上表**，别等以后补
2. 原始文件按 `<name>_source.glb` 存进本目录，不要改名
3. 跑 `tools\blender.ps1 inspect_source.py --file ...` 归一化，产物存 `<name>_normalized.glb`
4. 适配和验收见 `3d-asset-pipeline.mdc`
