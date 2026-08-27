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

# 三个部件共用一个材质球，材质数保持为 1（文档 5.4 上限是 2）。
# 参数照 3.4 节：PBR、粗糙度 0.9、金属度 0，不用 unlit。
MATERIAL_NAME = "pet_body"
MATERIAL_BASE_COLOR = (0.851, 0.745, 0.588, 1.0)  # #D9BE96 占位毛色
MATERIAL_ROUGHNESS = 0.9
MATERIAL_METALLIC = 0.0

BONE_RADIUS = {
    "hips": 0.22, "spine_01": 0.22, "spine_02": 0.20,
    "neck": 0.12, "head": 0.26, "jaw": 0.10,
    "ear_L": 0.07, "ear_R": 0.07,
    "tail_01": 0.06, "tail_02": 0.05, "tail_03": 0.04,
}
DEFAULT_RADIUS = 0.08


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


def make_material():
    mat = bpy.data.materials.new(MATERIAL_NAME)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = MATERIAL_BASE_COLOR
    bsdf.inputs["Roughness"].default_value = MATERIAL_ROUGHNESS
    bsdf.inputs["Metallic"].default_value = MATERIAL_METALLIC
    return mat


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
