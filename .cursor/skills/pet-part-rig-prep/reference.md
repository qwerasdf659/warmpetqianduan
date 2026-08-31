# 参考：部件清单 · 生成提示词 · Spine 检查表

## 标准部件清单（四足宠物侧视）

参照本项目 `Cat.json` 的骨架结构，一只可行走的四足宠物按这套分件即可绑出全套动作：

| 部件名 | 说明 | 建议父骨 |
|---|---|---|
| `Body` | 躯干（主承重） | root |
| `Head` | 头 | Body |
| `Ear_L` / `Ear_R` | 左右耳 | Head |
| `Eye_L` / `Eye_R` | 左右眼（可另出 闭眼/眯眼 备用件） | Head |
| `Mouth` | 嘴（可另出 张嘴/舔 备用件） | Head |
| `L_Leg_Front` / `R_Leg_Front` | 前腿 ×2 | Body |
| `L_Leg_Back` / `R_Leg_Back` | 后腿 ×2 | Body |
| `Paw_Front` / `Paw_Back` | 爪（走路抬脚露出，可选独立件） | 对应腿 |
| `Tail` | 尾（可分 2~3 段做摆动） | Body |

要点：**左右腿要各出一份**（走路交替迈步靠它）；耳/尾多留几帧姿态备用件，动作更活。

## 生成提示词要点

- 单部件、纯色平背景、无阴影投影、无渐变背景。
- 统一：`side view, flat cartoon style, thick clean outline, soft cel shading, consistent lighting`。
- 背景色关键词写死，例如浅毛宠物：`solid magenta #FF00FF background, subject not magenta`。
- 一句话锁比例：先出 `Body` 定基准尺寸，其余部件按「相对 Body 的大小」描述，避免各画各的。
- 关节处**多留一点重叠余量**（如大腿根塞进躯干下面一截），绑骨时不会露缝。

## Spine 绑骨 / 导出检查表

- [ ] 所有部件透明底、边缘干净（叠深/浅底都无残留背景色）
- [ ] 部件命名与上表一致，左右成对齐全
- [ ] 在 Spine 里按父骨层级挂好，网格(mesh)给需要形变的部件（身体/腿/尾）
- [ ] 建至少一套完整**皮肤(skin)**；若要「一骨多花色」，每种花色一套 skin，共用骨骼与动画
- [ ] 至少有 `idle` / `walk`；命名可自定，但接入端按候选表匹配（见规则 `spine-2d-pet`）
- [ ] **导出 spine 版本 = 引擎 spine 版本**（本项目 **3.8**）
- [ ] 图集**不勾预乘 alpha**（straight），否则进 Cocos 出白边
- [ ] 导出三件套 `.json`(或`.skel`) + `.atlas` + `.png`，同名，落 `assets/resources/spine/<name>/`

## 已知坑

- **白/浅毛宠物抠白底会把本体抠出洞**：改用洋红等饱和背景生成，再用 `-bgR/-bgG/-bgB` 抠该色。
- 背景色和毛色太近时，别靠调 `-tol` 硬救——回第 1 步换背景色重生更省事。
- `dewhite.ps1` 用逐像素处理，只适合分件这种中小图；整张大图会慢。
