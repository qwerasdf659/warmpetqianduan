"""WarmPet 标准骨架契约（28 根）。

这份文件是 docs/06-UI设计规范.md 第 5.4 节那棵骨架树的可执行版本。
文档改了就要改这里，两边必须一致；建模、动画、配饰全部绑在这套命名上。

坐标系：面朝 +Z，头顶 +Y，原点在脚底中心，1 单位 = 1 米，整体高度 2.0。

## 契约里哪些是死的，哪些是活的

**死的**：骨骼名、层级、`socket_*` 挂点、蒙皮标记。动画、配饰、遮挡规则、
前端代码全绑在这上面，改一个字就全线返工。

**活的**：28 个坐标。它们是**跟着网格拟合**的——换一具网格就重新量一遍。
这条很关键：`animations.py` 是按骨骼名生成曲线的，坐标变了重跑一遍就有新动画，
不用重做。所以「采购一具网格 + 重新拟合骨架」是可行的路线。

## 当前坐标是 Q 版比例（美术方向 A）

躯干中心 0.52、四肢全长 0.34、头 0.90–1.30、耳尖 2.00——三头身、大头短腿。
对应现在实际出包的那只模型，由 `build_skeleton.py` 程序化生成。

曾经有一版坐标拟合自 `assets-src/pet/source/cat_source.glb`
（Google Poly 低多边形猫，CC-BY，写实比例：背高 0.93、腿长 0.9），
方向定为 A 之后已整体换回 Q 版。**两套比例差一倍，不能混用**：
`build_pet_from_source.py` 的切分区间是按这里的坐标推的，
换比例不重新定标就会切错（历史事故见那个文件里 `EAR_MARGIN` 的注释）。

量法见 `tools/inspect_source.py`：归一化到高 2.0 后按贴地顶点分四象限定四肢，
按身长切片取脊背高度。
"""

import re

# 骨骼上限来自 Cocos 的 JOINT_UNIFORM_CAPACITY（cocos/rendering/define.ts）。
# 超过会从实时蒙皮退化成贴图蒙皮，而换装要求 useBakedAnimation = false。
MAX_JOINTS = 30

# (序号, 名称, 父骨骼, head, tail, 是否参与蒙皮)
#
# 全部拟合自那具猫网格的实测值（`inspect_source.py` 的 LANDMARKS 输出）：
#   四爪 x=±0.134 / ±0.131，前爪 z=+0.347，后爪 z=-0.552
#   脊背顶 1.14–1.17，躯干宽 0.49，所以躯干中心取 0.93
#   头部包围盒 y[0.95, 1.36] z[+0.70, +1.18]
#   尾巴 y[1.16, 2.00] z[-0.89, -1.18]，是**竖起来**的
BONES = [
    (1,  "root",            None,            (0.00, 0.00,  0.00), (0.00, 0.15,  0.00), False),
    # 躯干整个压在 0.5 上下，前后只有 0.4 长——Q 版的身子是个小球，不是筒
    (2,  "hips",            "root",          (0.00, 0.52, -0.20), (0.00, 0.53, -0.05), True),
    (3,  "spine_01",        "hips",          (0.00, 0.53, -0.05), (0.00, 0.54,  0.08), True),
    (4,  "spine_02",        "spine_01",      (0.00, 0.54,  0.08), (0.00, 0.58,  0.18), True),
    # 脖子几乎不存在：大头直接坐在身上，这是幼态最强的信号之一
    (5,  "neck",            "spine_02",      (0.00, 0.58,  0.18), (0.00, 0.90,  0.18), True),
    (6,  "socket_neck",     "neck",          (0.00, 0.72,  0.22), (0.00, 0.60,  0.30), False),
    (7,  "head",            "neck",          (0.00, 0.90,  0.18), (0.00, 1.30,  0.18), True),
    (8,  "ear_L",           "head",          (0.20, 1.72,  0.10), (0.30, 2.00,  0.06), True),
    (9,  "ear_R",           "head",         (-0.20, 1.72,  0.10), (-0.30, 2.00, 0.06), True),
    (10, "jaw",             "head",          (0.00, 1.26,  0.40), (0.00, 1.22,  0.62), True),
    (11, "socket_hat",      "head",          (0.00, 1.86,  0.16), (0.00, 2.06,  0.16), False),
    # 四肢极短：从 0.34 到脚底 0，全长只有 0.34（采购那只低模猫是 0.9）
    (12, "shoulder_L",      "spine_02",      (0.10, 0.55,  0.10), (0.17, 0.34,  0.14), True),
    (13, "leg_front_L_01",  "shoulder_L",    (0.17, 0.34,  0.14), (0.17, 0.21,  0.15), True),
    (14, "leg_front_L_02",  "leg_front_L_01",(0.17, 0.21,  0.15), (0.17, 0.09,  0.16), True),
    (15, "paw_front_L",     "leg_front_L_02",(0.17, 0.09,  0.16), (0.17, 0.02,  0.21), True),
    (16, "shoulder_R",      "spine_02",     (-0.10, 0.55,  0.10), (-0.17, 0.34, 0.14), True),
    (17, "leg_front_R_01",  "shoulder_R",   (-0.17, 0.34,  0.14), (-0.17, 0.21, 0.15), True),
    (18, "leg_front_R_02",  "leg_front_R_01",(-0.17, 0.21, 0.15), (-0.17, 0.09, 0.16), True),
    (19, "paw_front_R",     "leg_front_R_02",(-0.17, 0.09, 0.16), (-0.17, 0.02, 0.21), True),
    (20, "leg_back_L_01",   "hips",          (0.16, 0.36, -0.20), (0.16, 0.22, -0.20), True),
    (21, "leg_back_L_02",   "leg_back_L_01", (0.16, 0.22, -0.20), (0.16, 0.09, -0.19), True),
    (22, "paw_back_L",      "leg_back_L_02", (0.16, 0.09, -0.19), (0.16, 0.02, -0.14), True),
    (23, "leg_back_R_01",   "hips",         (-0.16, 0.36, -0.20), (-0.16, 0.22, -0.20), True),
    (24, "leg_back_R_02",   "leg_back_R_01",(-0.16, 0.22, -0.20), (-0.16, 0.09, -0.19), True),
    (25, "paw_back_R",      "leg_back_R_02", (-0.16, 0.09, -0.19), (-0.16, 0.02, -0.14), True),
    # 尾巴从臀部往后上方翘，参考图里是一条向上的弧
    (26, "tail_01",         "hips",          (0.00, 0.58, -0.30), (0.00, 0.76, -0.40), True),
    (27, "tail_02",         "tail_01",       (0.00, 0.76, -0.40), (0.00, 0.93, -0.43), True),
    (28, "tail_03",         "tail_02",       (0.00, 0.93, -0.43), (0.00, 1.07, -0.37), True),
]

TARGET_HEIGHT = 2.0
# 坐标已经是最终单位——它们是在网格归一化到高 2.0 之后量出来的，不用再缩放。
# 之前那套 Q 版坐标是按手感排的、总高对不上 2.0，才需要乘 1.214。
RIG_SCALE = 1.0

# 总高的可接受区间。基准是 2.0（§5.3），但**总高由耳型决定，不是可调参数**：
# 尖立耳的物种最高点是耳尖（猫 2.02），垂耳的最高点就是头顶（狗 1.79），
# 而头顶高度被骨架和眼线锁住。硬凑到等高只会做出兔子耳，我们试过三版。
#
# 真正必须对齐的是脚底线、肩高、眼高和挂点——那些由共用骨架保证，与总高无关。
HEIGHT_RANGE = (1.70, 2.05)

BONE_NAMES = [b[1] for b in BONES]
PARENT_OF = {b[1]: b[2] for b in BONES}
HEAD_OF = {b[1]: b[3] for b in BONES}
SOCKET_BONES = [b[1] for b in BONES if b[1].startswith("socket_")]
DEFORM_BONES = [b[1] for b in BONES if b[5]]

# 遮挡规则（5.5）要求耳朵和颈部能单独 active = false，所以必须是独立网格节点。
REQUIRED_MESH_PARTS = ["part_ears", "part_neck"]

# 全小写 + 下划线 + 数字。中文、空格、点号一律不合法。
# Blender 重名时会追加 .001，这条正则同时能抓到那种情况。
NAME_PATTERN = re.compile(r"^[a-z][a-z0-9_]*(_[LR])?(_\d{2})?$")

# 宠物 22000（图生 3D 的英雄宠物），其余不变。
#
# 3000 那档是给「低端机 + 同屏多角色」定的。但宠物在屏上只有 1–2 只，
# 而且图生 3D（Tripo/Meshy）的贴图是**碎片化 UV 图集**：一减面就把 UV 缝上的
# 顶点合并、三角形跨到不同色块之间，把别处的颜色拉过来——脸上全是撕裂的条纹。
# 实测 8000 面都还在撕，这个图集基本减不得。
# 20700 面的单只骨骼角色，蒙皮约 11000 顶点、DrawCall 1–2，低端机毫无压力
# （瓶颈从来是 DrawCall 和过度绘制，不是这个量级的顶点数）。
# 程序化那套占位造型仍在 3000 量级，用不到这个上限。
TRI_BUDGET = {"pet": 22000, "accessory": 400, "furniture": 800, "petpet": 300}

# 贴图尺寸（§5.8 / §7）。一律正方形且为 2 的幂——PVRTC 不满足这条会把图
# 强行拉到更大的正方形，体积反而暴涨。
# 宠物 1024，其余仍 256/128。512 那档是给**自烘的低频毛发贴图**定的——
# 那种贴图的信息量低，512 足够。但图生 3D（Tripo/Meshy）的宠物把脸整个
# **画进贴图**（眼睛、条纹、腮红全在里面），而且 UV 是碎片化图集、脸只占一小块，
# 512 下脸部纹理放大到屏幕上明显发软（UI 文字锐、独独宠物糊，就是这一处）。
# 1024 仍是 2 的幂、仍满足 PVRTC；显存多约 4MB、包体多两三百 KB，主视觉值这个价。
TEX_SIZE = {"pet": 1024, "accessory": 256, "furniture": 256, "petpet": 128}

# 每个材质球一个 DrawCall，整屏预算是低端机 50。
MAX_SUBMESHES = 3
MAX_MATERIALS = 2

# 分门类的部件限制。宠物要求耳朵、颈部独立（§5.5 的遮挡规则），
# 配饰、家具、Petpet 是单件单材质（§7），拿宠物的规则去判会一律误报。
PART_LIMITS = {
    "pet":       {"submeshes": 3, "materials": 2, "required": REQUIRED_MESH_PARTS},
    "accessory": {"submeshes": 1, "materials": 1, "required": []},
    "furniture": {"submeshes": 1, "materials": 1, "required": []},
    "petpet":    {"submeshes": 1, "materials": 1, "required": []},
}

# 动画清单，对应 docs/06 §5.6。猫狗共用，只做一套。
ANIM_FPS = 30
CLIP_SPEC = {
    # 第一批 · 基础
    "idle":        {"duration": (2.0, 3.0), "loop": True},
    "idle_hungry": {"duration": (2.0, 3.0), "loop": True},
    "idle_sick":   {"duration": (2.0, 3.0), "loop": True},
    "feed":        {"duration": (1.5, 2.0), "loop": False},
    "bath":        {"duration": (1.5, 2.0), "loop": False},
    "pet":         {"duration": (1.0, 1.5), "loop": False},
    "play":        {"duration": (1.5, 2.5), "loop": False},
    "happy":       {"duration": (1.0, 1.5), "loop": False},
    # 第二批 · 性格变体
    "idle_lively": {"duration": (2.0, 3.0), "loop": True},
    "idle_timid":  {"duration": (2.0, 3.0), "loop": True},
    "idle_lazy":   {"duration": (2.0, 3.0), "loop": True},
    # 第三批 · 训练技巧
    "trick_sit":   {"duration": (1.0, 1.5), "loop": False},
    "trick_shake": {"duration": (1.0, 1.5), "loop": False},
    "trick_roll":  {"duration": (1.5, 2.0), "loop": False},
    "trick_jump":  {"duration": (1.5, 2.0), "loop": False},
    "trick_dance": {"duration": (2.5, 3.5), "loop": True},
    # 第四批 · 赛跑。只加两个：冲刺用 race_run 提速到 1.3 播，
    # 落败复用 idle_lazy——名次在 /race/start 就定了，客户端只是播一段
    # 结果已知的表演，不是实时模拟，对动画丰富度的要求比真对战低得多。
    "race_run":    {"duration": (0.6, 1.0), "loop": True},
    "race_win":    {"duration": (1.5, 2.5), "loop": False},
}


def check_name(name):
    """返回不合规的原因，合规则返回 None。"""
    if any(ord(c) > 127 for c in name):
        return "contains non-ASCII characters"
    if " " in name:
        return "contains space"
    if "." in name:
        return "contains dot (Blender duplicate suffix?)"
    if not NAME_PATTERN.match(name):
        return "does not match [a-z][a-z0-9_]* with optional _L/_R and _NN"
    return None


def diff_against_spec(actual_names):
    """把实际骨骼名和契约对比，返回 (缺失, 多余)。"""
    expected = set(BONE_NAMES)
    actual = set(actual_names)
    return sorted(expected - actual), sorted(actual - expected)
