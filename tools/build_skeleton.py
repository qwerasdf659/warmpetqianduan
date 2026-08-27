"""按 rig_spec 建出标准骨架，可选附一具占位网格，导出 FBX。

用法（必须带 --factory-startup，否则 Blender 会给重名骨骼追加 .001 后缀）：

  blender --background --factory-startup -noaudio --python-exit-code 1 \
      --python tools/build_skeleton.py -- --out assets-src/pet --name pet_dog

  加 --skeleton-only 只导骨架，不带占位网格。
"""

import os
import sys
import argparse

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rig_spec  # noqa: E402
import animations  # noqa: E402

# 文档用 Cocos 坐标系描述骨架（Y 上、Z 前）；Blender 是 Z 上、-Y 前。
# 建模时转到 Blender 空间，导出时再由 FBX 的 axis 设置转回去。
def to_blender(p):
    x, y, z = p
    return Vector((x, -z, y))


# 占位网格按骨骼分组，保证耳朵和颈部是独立对象——遮挡规则要能单独隐藏它们。
# 只分三组：文档 5.4 限制子网格 ≤ 3，头并进身体。
PART_GROUPS = {
    "part_ears": ["ear_L", "ear_R"],
    "part_neck": ["neck"],
    "part_body": [
        "head", "jaw",
        "hips", "spine_01", "spine_02",
        "shoulder_L", "leg_front_L_01", "leg_front_L_02", "paw_front_L",
        "shoulder_R", "leg_front_R_01", "leg_front_R_02", "paw_front_R",
        "leg_back_L_01", "leg_back_L_02", "paw_back_L",
        "leg_back_R_01", "leg_back_R_02", "paw_back_R",
        "tail_01", "tail_02", "tail_03",
    ],
}

# 两个材质球，正好卡在文档 5.4 的上限。
# 参数照 3.4 节：PBR、粗糙度 0.9、金属度 0，不用 unlit。
MATERIALS = {
    "pet_body": (0.851, 0.745, 0.588, 1.0),    # #D9BE96 占位毛色
    "pet_detail": (0.180, 0.130, 0.098, 1.0),  # #2E2119 眼睛、鼻子
}
MATERIAL_ROUGHNESS = 0.9
MATERIAL_METALLIC = 0.0

SPHERE_SEGMENTS = 10
SPHERE_RINGS = 6

# 占位造型。盒子拼的模型再准也读不出幼态——养成品类的「可爱」几乎全来自
# 大眼睛和圆润轮廓（docs/06 §5.2），所以占位模型也要圆、眼睛也要有。
#
# 每个部件刚性绑定到一根骨头（权重 1），这样呼吸、摇头、摆尾都能带动对应部位。
# 眼睛和鼻子绑在 head / jaw 上，摇头时会跟着转，这是「活着」最直接的信号。
#
# 坐标是 Cocos 空间（Y 上、Z 前），和 rig_spec 一致。
SHAPES = [
    # (bone, 材质, 形状, 中心, 半轴)
    ("hips",        "pet_body",   "sphere", (0.00, 0.82, -0.28), (0.27, 0.26, 0.30)),
    ("spine_01",    "pet_body",   "sphere", (0.00, 0.86, -0.05), (0.29, 0.28, 0.30)),
    ("spine_02",    "pet_body",   "sphere", (0.00, 0.89,  0.20), (0.27, 0.26, 0.28)),
    ("head",        "pet_body",   "sphere", (0.00, 1.36,  0.44), (0.36, 0.34, 0.34)),
    ("jaw",         "pet_body",   "sphere", (0.00, 1.24,  0.66), (0.17, 0.14, 0.17)),
    # 眼睛突出球面一点，正面才有存在感
    ("head",        "pet_detail", "sphere", (0.15, 1.42,  0.70), (0.085, 0.095, 0.085)),
    ("head",        "pet_detail", "sphere", (-0.15, 1.42, 0.70), (0.085, 0.095, 0.085)),
    # 高光用毛色材质，浅色点在深色眼球上就是高光，不用第三个材质球
    ("head",        "pet_body",   "sphere", (0.185, 1.46, 0.755), (0.032, 0.032, 0.032)),
    ("head",        "pet_body",   "sphere", (-0.115, 1.46, 0.755), (0.032, 0.032, 0.032)),
    ("jaw",         "pet_detail", "sphere", (0.00, 1.27,  0.80), (0.055, 0.045, 0.050)),
    ("paw_front_L", "pet_body",   "sphere", (0.20, 0.09,  0.28), (0.10, 0.08, 0.13)),
    ("paw_front_R", "pet_body",   "sphere", (-0.20, 0.09, 0.28), (0.10, 0.08, 0.13)),
    ("paw_back_L",  "pet_body",   "sphere", (0.18, 0.09, -0.30), (0.10, 0.08, 0.13)),
    ("paw_back_R",  "pet_body",   "sphere", (-0.18, 0.09, -0.30), (0.10, 0.08, 0.13)),
    ("tail_01",     "pet_body",   "sphere", (0.00, 0.80, -0.43), (0.075, 0.075, 0.075)),
    ("tail_02",     "pet_body",   "sphere", (0.00, 0.66, -0.57), (0.060, 0.060, 0.060)),
    ("tail_03",     "pet_body",   "sphere", (0.00, 0.50, -0.64), (0.045, 0.045, 0.045)),
    ("neck",        "pet_body",   "sphere", (0.00, 1.02,  0.37), (0.155, 0.16, 0.155)),
    ("ear_L",       "pet_body",   "cone",   (0.17, 1.62,  0.38), (0.105, 0.30, 0.105)),
    ("ear_R",       "pet_body",   "cone",   (-0.17, 1.62, 0.38), (0.105, 0.30, 0.105)),
]

# 四肢用锥台连接，比球串起来更像腿
LIMBS = [
    ("leg_front_L_01", 0.10, 0.085), ("leg_front_L_02", 0.085, 0.070),
    ("leg_front_R_01", 0.10, 0.085), ("leg_front_R_02", 0.085, 0.070),
    ("leg_back_L_01", 0.11, 0.090), ("leg_back_L_02", 0.090, 0.072),
    ("leg_back_R_01", 0.11, 0.090), ("leg_back_R_02", 0.090, 0.072),
]


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = "METRIC"
    bpy.context.scene.unit_settings.scale_length = 1.0


def build_armature(name="Armature"):
    arm_data = bpy.data.armatures.new(name)
    arm_obj = bpy.data.objects.new(name, arm_data)
    bpy.context.collection.objects.link(arm_obj)
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.mode_set(mode="EDIT")

    for _, bone_name, _, head, tail, deform in rig_spec.BONES:
        eb = arm_data.edit_bones.new(bone_name)
        eb.head = to_blender(head)
        eb.tail = to_blender(tail)
        eb.roll = 0.0
        eb.use_deform = deform

    for _, bone_name, parent, _, _, _ in rig_spec.BONES:
        if parent:
            arm_data.edit_bones[bone_name].parent = arm_data.edit_bones[parent]

    bpy.ops.object.mode_set(mode="OBJECT")

    created = [b.name for b in arm_data.bones]
    unexpected = [n for n in created if n not in rig_spec.BONE_NAMES]
    if unexpected:
        raise RuntimeError("Blender renamed bones (duplicate names?): %s" % unexpected)
    return arm_obj


def box_for_bone(bone_name, head, tail, radius):
    """沿骨骼方向建一个盒子，顶点全部 100% 绑到这根骨头上。"""
    h, t = to_blender(head), to_blender(tail)
    axis = t - h
    length = axis.length
    if length < 1e-6:
        raise RuntimeError("zero-length bone: %s" % bone_name)

    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, 0))
    obj = bpy.context.active_object
    obj.name = "box_%s" % bone_name
    # size=1.0 的立方体顶点在 ±0.5，所以缩放值就是最终的全长/全宽。
    obj.scale = (radius * 2.0, radius * 2.0, length)
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(axis.normalized())
    obj.location = h + axis * 0.5
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    vg = obj.vertex_groups.new(name=bone_name)
    vg.add(range(len(obj.data.vertices)), 1.0, "REPLACE")
    return obj


def make_materials():
    made = {}
    for name, color in MATERIALS.items():
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes["Principled BSDF"]
        bsdf.inputs["Base Color"].default_value = color
        bsdf.inputs["Roughness"].default_value = MATERIAL_ROUGHNESS
        bsdf.inputs["Metallic"].default_value = MATERIAL_METALLIC
        made[name] = mat
    return made


def bind_to_bone(obj, bone_name):
    """整块刚性绑定到一根骨头，权重 1。占位模型不需要渐变权重。"""
    vg = obj.vertex_groups.new(name=bone_name)
    vg.add(range(len(obj.data.vertices)), 1.0, "REPLACE")
    return obj


def add_sphere(center, radii):
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=SPHERE_SEGMENTS, ring_count=SPHERE_RINGS, radius=1.0)
    obj = bpy.context.active_object
    obj.scale = radii
    obj.location = to_blender(center)
    bpy.ops.object.transform_apply(location=True, scale=True)
    bpy.ops.object.shade_smooth()
    return obj


def add_cone(center, radii):
    """耳朵用锥体。尖立的剪影是猫狗最主要的辨识点（docs/06 §5.2）。"""
    bpy.ops.mesh.primitive_cone_add(vertices=SPHERE_SEGMENTS, radius1=1.0, depth=1.0)
    obj = bpy.context.active_object
    obj.scale = (radii[0], radii[2], radii[1])
    obj.location = to_blender(center)
    bpy.ops.object.transform_apply(location=True, scale=True)
    bpy.ops.object.shade_smooth()
    return obj


def add_limb(bone_name, r_top, r_bottom):
    """沿骨骼方向建一段锥台。"""
    spec = {b[1]: b for b in rig_spec.BONES}[bone_name]
    head, tail = to_blender(spec[3]), to_blender(spec[4])
    axis = tail - head
    length = axis.length

    bpy.ops.mesh.primitive_cone_add(
        vertices=SPHERE_SEGMENTS, radius1=r_top, radius2=r_bottom, depth=length)
    obj = bpy.context.active_object
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(axis.normalized())
    obj.location = head + axis * 0.5
    bpy.ops.object.transform_apply(location=True, rotation=True)
    bpy.ops.object.shade_smooth()
    return obj


def build_placeholder(arm_obj):
    spec_by_name = {b[1]: b for b in rig_spec.BONES}
    material = make_material()
    parts = []

    for part_name, bone_names in PART_GROUPS.items():
        boxes = []
        for bone_name in bone_names:
            _, _, _, head, tail, _ = spec_by_name[bone_name]
            boxes.append(box_for_bone(bone_name, head, tail,
                                      BONE_RADIUS.get(bone_name, DEFAULT_RADIUS)))

        bpy.ops.object.select_all(action="DESELECT")
        for b in boxes:
            b.select_set(True)
        bpy.context.view_layer.objects.active = boxes[0]
        if len(boxes) > 1:
            bpy.ops.object.join()

        part = bpy.context.active_object
        part.name = part_name
        part.data.name = part_name
        part.data.materials.clear()
        part.data.materials.append(material)
        part.parent = arm_obj
        mod = part.modifiers.new(name="Armature", type="ARMATURE")
        mod.object = arm_obj
        parts.append(part)

    return parts


def export_fbx(path, has_anim=False):
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.fbx(
        filepath=path,
        use_selection=True,
        object_types={"ARMATURE", "MESH"},
        # True 会给每条骨链尾端追加 *_end，28 根会变成 40 多根，直接违约。
        add_leaf_bones=False,
        armature_nodetype="NULL",
        primary_bone_axis="Y",
        secondary_bone_axis="X",
        # socket_* 不蒙皮，开这个会把它们过滤掉。
        use_armature_deform_only=False,
        bake_anim=has_anim,
        bake_anim_use_all_actions=has_anim,
        bake_anim_use_all_bones=has_anim,
        bake_anim_force_startend_keying=has_anim,
        bake_anim_step=1.0,
        # 默认 1.0 会抽稀曲线，把动作压平。
        bake_anim_simplify_factor=0.0,
        path_mode="COPY",
        embed_textures=False,
        mesh_smooth_type="FACE",
        apply_unit_scale=True,
        apply_scale_options="FBX_SCALE_NONE",
        axis_forward="-Z",
        axis_up="Y",
    )


def export_glb(path, has_anim=False):
    """首选格式。FBX 的长度单位是厘米，导进引擎会多一层 100 倍缩放的根节点，
    和「按成长阶段缩放宠物根节点」冲突；glTF 原生用米，没有这个补偿节点。"""
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_skins=True,
        export_influence_nb=4,
        export_leaf_bone=False,
        export_def_bones=False,
        export_rest_position_armature=True,
        export_animations=has_anim,
        export_animation_mode="ACTIONS",
        export_force_sampling=True,
        export_optimize_animation_size=False,
        export_apply=True,
    )


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--name", default="pet_dog")
    ap.add_argument("--skeleton-only", action="store_true")
    ap.add_argument("--also-fbx", action="store_true")
    ap.add_argument("--no-anim", action="store_true")
    ap.add_argument("--anim-gain", type=float, default=1.0,
                    help="动画幅度增益，调试时放大用，正式资源保持 1.0")
    args = ap.parse_args(argv)

    animations.set_gain(args.anim_gain)

    reset_scene()
    arm_obj = build_armature()
    parts = [] if args.skeleton_only else build_placeholder(arm_obj)

    clips = []
    if not args.no_anim:
        for name, builder in animations.BUILDERS.items():
            builder(arm_obj)
            clips.append(name)

    os.makedirs(args.out, exist_ok=True)
    written = []

    glb_path = os.path.join(args.out, args.name + ".glb")
    export_glb(glb_path, has_anim=bool(clips))
    written.append(glb_path)

    if args.also_fbx:
        fbx_path = os.path.join(args.out, args.name + ".fbx")
        export_fbx(fbx_path, has_anim=bool(clips))
        written.append(fbx_path)

    print("BUILD_OK")
    print("  bones      : %d (limit %d)" % (len(arm_obj.data.bones), rig_spec.MAX_JOINTS))
    print("  mesh parts : %s" % ([p.name for p in parts] or "none (skeleton only)"))
    print("  clips      : %s" % (clips or "none"))
    for w in written:
        print("  exported   : %s" % w)


if __name__ == "__main__":
    main()
