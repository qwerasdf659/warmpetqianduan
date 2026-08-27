"""WarmPet 标准骨架契约（28 根）。

这份文件是 docs/06-UI设计规范.md 第 5.4 节那棵骨架树的可执行版本。
文档改了就要改这里，两边必须一致；建模、动画、配饰全部绑在这套命名上。

坐标系：面朝 +Z，头顶 +Y，原点在脚底中心，1 单位 = 1 米。
尺寸按 adult 狗（基准）建，整体高度约 2.0（含耳）。猫用 0.88 的根节点缩放表达。
"""

import re

# 骨骼上限来自 Cocos 的 JOINT_UNIFORM_CAPACITY（cocos/rendering/define.ts）。
# 超过会从实时蒙皮退化成贴图蒙皮，而换装要求 useBakedAnimation = false。
MAX_JOINTS = 30

# (序号, 名称, 父骨骼, head, tail, 是否参与蒙皮)
BONES = [
    (1,  "root",            None,            (0.00, 0.00,  0.00), (0.00, 0.20,  0.00), False),
    (2,  "hips",            "root",          (0.00, 0.56, -0.22), (0.00, 0.59, -0.06), True),
    (3,  "spine_01",        "hips",          (0.00, 0.59, -0.06), (0.00, 0.62,  0.08), True),
    (4,  "spine_02",        "spine_01",      (0.00, 0.62,  0.08), (0.00, 0.66,  0.20), True),
    (5,  "neck",            "spine_02",      (0.00, 0.66,  0.20), (0.00, 0.88,  0.26), True),
    (6,  "socket_neck",     "neck",          (0.00, 0.68,  0.26), (0.00, 0.52,  0.32), False),
    (7,  "head",            "neck",          (0.00, 0.88,  0.26), (0.00, 1.18,  0.28), True),
    (8,  "ear_L",           "head",          (0.16, 1.30,  0.20), (0.22, 1.80,  0.12), True),
    (9,  "ear_R",           "head",         (-0.16, 1.30,  0.20), (-0.22, 1.80, 0.12), True),
    (10, "jaw",             "head",          (0.00, 1.00,  0.42), (0.00, 0.96,  0.64), True),
    (11, "socket_hat",      "head",          (0.00, 1.52,  0.26), (0.00, 1.72,  0.26), False),
    (12, "shoulder_L",      "spine_02",      (0.07, 0.62,  0.14), (0.16, 0.44,  0.16), True),
    (13, "leg_front_L_01",  "shoulder_L",    (0.16, 0.44,  0.16), (0.16, 0.26,  0.16), True),
    (14, "leg_front_L_02",  "leg_front_L_01",(0.16, 0.26,  0.16), (0.16, 0.09,  0.16), True),
    (15, "paw_front_L",     "leg_front_L_02",(0.16, 0.09,  0.16), (0.16, 0.02,  0.24), True),
    (16, "shoulder_R",      "spine_02",     (-0.07, 0.62,  0.14), (-0.16, 0.44, 0.16), True),
    (17, "leg_front_R_01",  "shoulder_R",   (-0.16, 0.44,  0.16), (-0.16, 0.26, 0.16), True),
    (18, "leg_front_R_02",  "leg_front_R_01",(-0.16, 0.26, 0.16), (-0.16, 0.09, 0.16), True),
    (19, "paw_front_R",     "leg_front_R_02",(-0.16, 0.09, 0.16), (-0.16, 0.02, 0.24), True),
    (20, "leg_back_L_01",   "hips",          (0.15, 0.50, -0.24), (0.15, 0.28, -0.26), True),
    (21, "leg_back_L_02",   "leg_back_L_01", (0.15, 0.28, -0.26), (0.15, 0.10, -0.20), True),
    (22, "paw_back_L",      "leg_back_L_02", (0.15, 0.10, -0.20), (0.15, 0.02, -0.14), True),
    (23, "leg_back_R_01",   "hips",         (-0.15, 0.50, -0.24), (-0.15, 0.28, -0.26), True),
    (24, "leg_back_R_02",   "leg_back_R_01",(-0.15, 0.28, -0.26), (-0.15, 0.10, -0.20), True),
    (25, "paw_back_R",      "leg_back_R_02",(-0.15, 0.10, -0.20), (-0.15, 0.02, -0.14), True),
    (26, "tail_01",         "hips",          (0.00, 0.62, -0.28), (0.00, 0.58, -0.40), True),
    (27, "tail_02",         "tail_01",       (0.00, 0.58, -0.40), (0.00, 0.52, -0.50), True),
    (28, "tail_03",         "tail_02",       (0.00, 0.52, -0.50), (0.00, 0.44, -0.56), True),
]

# 上面的坐标是按造型手感排的，整体高度不一定正好落在文档 5.3 要求的 2.0 单位上。
# 相机位置和 FOV 都是按 2.0 定的（§3.4），尺寸不对就要每次换模型都重调相机。
# 与其回头去改二十几行数字，不如统一乘一个系数——等比缩放不影响任何比例关系。
TARGET_HEIGHT = 2.0
RIG_SCALE = 1.214

# 总高的可接受区间。基准是 2.0（§5.3），但**总高由耳型决定，不是可调参数**：
# 尖立耳的物种最高点是耳尖（猫 2.02），垂耳的最高点就是头顶（狗 1.79），
# 而头顶高度被骨架和眼线锁住。硬凑到等高只会做出兔子耳，我们试过三版。
#
# 真正必须对齐的是脚底线、肩高、眼高和挂点——那些由共用骨架保证，与总高无关。
HEIGHT_RANGE = (1.70, 2.05)

BONE_NAMES = [b[1] for b in BONES]
PARENT_OF = {b[1]: b[2] for b in BONES}
SOCKET_BONES = [b[1] for b in BONES if b[1].startswith("socket_")]
DEFORM_BONES = [b[1] for b in BONES if b[5]]

# 遮挡规则（5.5）要求耳朵和颈部能单独 active = false，所以必须是独立网格节点。
REQUIRED_MESH_PARTS = ["part_ears", "part_neck"]

# 全小写 + 下划线 + 数字。中文、空格、点号一律不合法。
# Blender 重名时会追加 .001，这条正则同时能抓到那种情况。
NAME_PATTERN = re.compile(r"^[a-z][a-z0-9_]*(_[LR])?(_\d{2})?$")

TRI_BUDGET = {"pet": 3000, "accessory": 400, "furniture": 800, "petpet": 300}

# 贴图尺寸（§5.8 / §7）。一律正方形且为 2 的幂——PVRTC 不满足这条会把图
# 强行拉到更大的正方形，体积反而暴涨。
TEX_SIZE = {"pet": 512, "accessory": 256, "furniture": 256, "petpet": 128}

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
