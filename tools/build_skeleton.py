"""按 rig_spec 建出标准骨架，可选附一具占位网格，导出 GLB。

用法（必须带 --factory-startup，否则 Blender 会给重名骨骼追加 .001 后缀）：

  blender --background --factory-startup -noaudio --python-exit-code 1 \
      --python tools/build_skeleton.py -- --out assets-src/pet --species dog

  blender ... --python tools/build_skeleton.py -- --out assets-src/pet --species cat

  加 --skeleton-only 只导骨架，不带占位网格；加 --no-texture 只导纯色材质。

**骨架与两个物种无关**：`rig_spec.py` 那 28 根对猫狗逐根一致，
差异只在 `species.py` 的剖面规格里（docs/06 §5.1）。共用骨架是成本地基——
动画和配饰因此只做一套。
"""

import os
import sys
import argparse

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rig_spec  # noqa: E402
import animations  # noqa: E402
import pet_texture  # noqa: E402
import species  # noqa: E402

# 文档用 Cocos 坐标系描述骨架（Y 上、Z 前）；Blender 是 Z 上、-Y 前。
# 建模时转到 Blender 空间，导出时再由 FBX 的 axis 设置转回去。
def to_blender(p):
    s = rig_spec.RIG_SCALE
    x, y, z = p
    return Vector((x * s, -z * s, y * s))


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

# 造型规格在 species.py 里，按物种分两份（docs/06 §5.1 的差异表）。
# 这里只负责把那份数据变成网格：
#
# - 每个部件刚性绑定到一根骨头，这样呼吸、摇头、摆尾都能带动对应部位
# - 眼睛和鼻子绑在 head / jaw 上，摇头时会跟着转，这是「活着」最直接的信号
# - 盒子拼的模型再准也读不出幼态，所以一律用球和锥台，圆润优先（§5.2）


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


def add_sphere(center, radii):
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=SPHERE_SEGMENTS, ring_count=SPHERE_RINGS, radius=1.0)
    obj = bpy.context.active_object
    obj.scale = tuple(v * rig_spec.RIG_SCALE for v in radii)
    obj.location = to_blender(center)
    bpy.ops.object.transform_apply(location=True, scale=True)
    bpy.ops.object.shade_smooth()
    return obj


def add_taper(p0, p1, r0, r1, squash=None):
    """两点之间的一段锥台，`squash` 按 Cocos 轴向逐轴压扁。

    垂耳、卷尾、四肢都靠它。球串不出这些形状——耳朵要能折、尾巴要能弯，
    都需要「沿任意方向的一段」这个原语，而不是一串同心球。

    `squash` 是给耳朵的，圆截面的耳朵永远是根管子。**压哪个轴很关键**：
    相机固定在正前方（§3.4），所以耳廓这个面要朝着镜头，也就是压 Z（前后）、
    在 X 和 Y 上铺开。压 X 那版看着像两根天线——耳廓是有的，只是镜头
    永远只看到它的侧棱。
    """
    head, tail = to_blender(p0), to_blender(p1)
    axis = tail - head
    length = axis.length

    bpy.ops.mesh.primitive_cone_add(
        vertices=SPHERE_SEGMENTS,
        radius1=r0 * rig_spec.RIG_SCALE,
        radius2=r1 * rig_spec.RIG_SCALE,
        depth=length)
    obj = bpy.context.active_object
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(axis.normalized())
    obj.location = head + axis * 0.5
    bpy.ops.object.transform_apply(location=True, rotation=True)

    if squash:
        # Cocos 的 (x, y, z) 对应 Blender 的 (x, -z, y)
        factors = (squash[0], squash[2], squash[1])
        # 直接改顶点，绕形体自身的中心压。用 obj.scale 不行：
        # transform_apply 之后原点在世界原点，缩放会连位置一起往中线拉。
        verts = obj.data.vertices
        n = len(verts)
        center = [sum(v.co[i] for v in verts) / n for i in range(3)]
        for v in verts:
            for i in range(3):
                if factors[i] != 1.0:
                    v.co[i] = center[i] + (v.co[i] - center[i]) * factors[i]

    bpy.ops.object.shade_smooth()
    return obj


def add_limb(bone_name, r_top, r_bottom):
    """沿骨骼方向建一段锥台，四肢用。"""
    spec = {b[1]: b for b in rig_spec.BONES}[bone_name]
    return add_taper(spec[3], spec[4], r_top, r_bottom)


def fuse(objs, name, voxel_size, tri_budget, smooth_iters):
    """把一组交叠的图元融合成一个连续曲面。

    之前的做法是把球和锥直接 join 在一起——那只是把它们放进同一个对象，
    表面依然互相穿插，接缝清清楚楚，看上去就是「一堆球」。
    体素重构会重新生成一张包裹住整体的外表面，剪影才是一整只动物。

    代价是面数暴涨且拓扑不可控，所以紧接着塌陷减面压回预算。
    占位模型不需要漂亮的布线，只需要正确的剪影和可接受的面数。
    """
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()

    obj = bpy.context.active_object
    obj.name = name
    obj.data.name = name

    remesh = obj.modifiers.new(name="Remesh", type="REMESH")
    remesh.mode = "VOXEL"
    remesh.voxel_size = voxel_size
    remesh.use_smooth_shade = True
    bpy.ops.object.modifier_apply(modifier=remesh.name)

    obj.data.calc_loop_triangles()
    tris = len(obj.data.loop_triangles)
    if tris > tri_budget:
        dec = obj.modifiers.new(name="Decimate", type="DECIMATE")
        dec.decimate_type = "COLLAPSE"
        dec.ratio = tri_budget / tris
        bpy.ops.object.modifier_apply(modifier=dec.name)

    if smooth_iters:
        # 体素重构的表面是一格一格堆出来的，法线里全是台阶，光一打就是一层疙瘩。
        # 拉普拉斯平滑把台阶抹平，剪影几乎不变。
        #
        # 迭代次数按部件给：身体可以多平几次，耳朵只能平一次——
        # 平滑会顺手把猫的尖耳尖端一起抹圆，那是猫最重要的辨识点。
        smooth = obj.modifiers.new(name="Smooth", type="SMOOTH")
        smooth.factor = 0.6
        smooth.iterations = smooth_iters
        bpy.ops.object.modifier_apply(modifier=smooth.name)

    # 重构 + 塌陷减面会留下零面积三角形和游离顶点，glTF 导出器会报
    # "Mesh X is not valid, and may be exported wrongly"。清一遍。
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.dissolve_degenerate(threshold=1e-5)
    bpy.ops.mesh.delete_loose()
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")

    # 体素重构会丢掉 UV，展开推迟到所有部件都成型之后统一做（见 pack_uv）。
    bpy.ops.object.shade_smooth()
    return obj


def pack_uv(parts):
    """三个部件一起展开，打包进同一个 0-1 空间。

    它们共用一个材质球，也就共用一张贴图。各自单独展开的话三份 UV 会全部
    铺满 0-1，在贴图上完全重叠——烘焙时后一个部件把前一个覆盖掉，
    耳朵会顶着一块肚子的颜色。

    多物体同时进编辑模式再 smart_project，Blender 会跨物体统一装箱。
    """
    bpy.ops.object.select_all(action="DESELECT")
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    # 512 贴图下 4 像素边距约合 0.008 UV 单位（§5.8），取 0.012 留点余量
    bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.012)
    bpy.ops.object.mode_set(mode="OBJECT")


def skin_to_armature(parts, arm_obj):
    """用自动权重绑定。

    刚性绑定（整块 100% 绑一根骨头）在盒子上看不出问题，融合成连续曲面之后
    就会露馅——关节处会硬生生地切开。自动权重按到骨骼的距离生成渐变，
    这正是文档 5.4 对关节「两侧渐变过渡，不要硬切」的要求。

    socket_* 已经在建骨架时标了 use_deform = False，自动权重不会碰它们，
    「挂点权重必须为 0」那条自然满足。
    """
    bpy.ops.object.select_all(action="DESELECT")
    for p in parts:
        p.select_set(True)
    arm_obj.select_set(True)
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")

    # 引擎 shader 的 a_weights 是 vec4，超出 4 根的影响会被丢弃，
    # 与其让引擎静默截断，不如在这里显式归并再归一化。
    for p in parts:
        bpy.context.view_layer.objects.active = p
        bpy.ops.object.select_all(action="DESELECT")
        p.select_set(True)
        bpy.ops.object.vertex_group_limit_total(limit=4)
        bpy.ops.object.vertex_group_normalize_all(lock_active=False)
        fill_unweighted(p, arm_obj)


def fill_unweighted(obj, arm_obj):
    """把自动权重没覆盖到的顶点补给最近的骨头。

    glTF 导出器一旦发现有顶点没有任何权重，就会凭空插一根 neutral_bone 兜底，
    骨骼数从 28 变成 29，直接违反骨架契约。与其让导出器替我们做决定，
    不如在这里按距离显式指派——反正这些顶点本来也该跟着最近的骨头动。
    """
    deform = [b for b in arm_obj.data.bones if b.use_deform]
    groups = {g.name: g for g in obj.vertex_groups}

    for v in obj.data.vertices:
        if any(ge.weight > 0 for ge in v.groups):
            continue

        co = obj.matrix_world @ v.co
        best, best_d = None, None
        for bone in deform:
            head = arm_obj.matrix_world @ bone.head_local
            tail = arm_obj.matrix_world @ bone.tail_local
            axis = tail - head
            length_sq = axis.length_squared
            t = 0.0 if length_sq < 1e-9 else max(0.0, min(1.0, (co - head).dot(axis) / length_sq))
            d = (co - (head + axis * t)).length
            if best_d is None or d < best_d:
                best, best_d = bone.name, d

        if best:
            group = groups.get(best) or obj.vertex_groups.new(name=best)
            groups[best] = group
            group.add([v.index], 1.0, "REPLACE")


def part_of(bone_name):
    """遮挡规则要求耳朵和颈部能单独隐藏，所以它们必须是独立网格（docs/06 §5.5）。"""
    if bone_name in ("ear_L", "ear_R"):
        return "part_ears"
    if bone_name == "neck":
        return "part_neck"
    return "part_body"


def build_placeholder(arm_obj, profile, tex_dir=None, tex_name=None):
    materials = make_materials()

    # 融合的体素尺寸按部件大小给：身体大、可以粗一点，耳朵薄、太粗会被抹平。
    # 猫的尖立三角耳尤其吃这个数——体素粗了尖会被直接抹圆，就变成狗耳了。
    fuse_plan = {
        name: (voxel * rig_spec.RIG_SCALE, budget, smooth)
        for name, (voxel, budget, smooth) in profile["fuse"].items()
    }
    groups = {name: [] for name in fuse_plan}
    # 眼睛和鼻子不参与融合：体素重构只保留一张外表面，
    # 一起融进去就会和脸连成一体，深色材质也没了。
    details = []

    for kind, bone_name, mat_name, params in profile["shapes"]:
        if kind == "sphere":
            obj = add_sphere(*params)
        elif kind == "taper":
            obj = add_taper(*params)
        else:
            raise ValueError("unknown shape kind: %s" % kind)

        if mat_name == "pet_detail":
            obj.data.materials.append(materials[mat_name])
            details.append(obj)
        else:
            groups[part_of(bone_name)].append(obj)

    for bone_name, r_top, r_bottom in profile["limbs"]:
        groups[part_of(bone_name)].append(add_limb(bone_name, r_top, r_bottom))

    parts = []
    for part_name, pieces in groups.items():
        if not pieces:
            continue
        voxel, budget, smooth = fuse_plan[part_name]
        part = fuse(pieces, part_name, voxel, budget, smooth)
        part.data.materials.clear()
        part.data.materials.append(materials["pet_body"])
        parts.append(part)

    # 融合完再把细节件并进身体，它们保留自己的材质槽，作为独立的面片岛存在
    body = next(p for p in parts if p.name == "part_body")
    if details:
        bpy.ops.object.select_all(action="DESELECT")
        for d in details:
            d.select_set(True)
        body.select_set(True)
        bpy.context.view_layer.objects.active = body
        bpy.ops.object.join()

    pack_uv(parts)
    if tex_dir:
        others = [m for name, m in materials.items() if name != "pet_body"]
        pet_texture.bake(parts, materials["pet_body"], others, to_blender,
                         tex_dir, tex_name, profile["blobs"], profile["features"])

    skin_to_armature(parts, arm_obj)
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
        # AUTO 会按图像自身的格式走：basecolor 存的是 JPEG 就还是 JPEG，
        # 法线贴图存的是 PNG 就还是 PNG。统一转 PNG 会让 basecolor 体积翻几倍。
        export_image_format="AUTO",
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
    ap.add_argument("--species", default="dog", choices=sorted(species.PROFILES))
    ap.add_argument("--name", default=None, help="默认 pet_<species>")
    ap.add_argument("--skeleton-only", action="store_true")
    ap.add_argument("--also-fbx", action="store_true")
    ap.add_argument("--no-anim", action="store_true")
    ap.add_argument("--no-texture", action="store_true",
                    help="跳过毛色贴图烘焙，只导纯色材质")
    ap.add_argument("--anim-gain", type=float, default=1.0,
                    help="动画幅度增益，调试时放大用，正式资源保持 1.0")
    args = ap.parse_args(argv)
    name = args.name or ("pet_" + args.species)

    animations.set_gain(args.anim_gain)

    reset_scene()
    arm_obj = build_armature()
    tex_dir = None if (args.skeleton_only or args.no_texture) \
        else os.path.join(args.out, "tex")
    parts = [] if args.skeleton_only else build_placeholder(
        arm_obj, species.PROFILES[args.species], tex_dir=tex_dir, tex_name=name)

    clips = []
    if not args.no_anim:
        for clip_name, builder in animations.BUILDERS.items():
            builder(arm_obj)
            clips.append(clip_name)

    os.makedirs(args.out, exist_ok=True)
    written = []

    glb_path = os.path.join(args.out, name + ".glb")
    export_glb(glb_path, has_anim=bool(clips))
    written.append(glb_path)

    if args.also_fbx:
        fbx_path = os.path.join(args.out, name + ".fbx")
        export_fbx(fbx_path, has_anim=bool(clips))
        written.append(fbx_path)

    print("BUILD_OK")
    print("  species    : %s" % args.species)
    print("  bones      : %d (limit %d)" % (len(arm_obj.data.bones), rig_spec.MAX_JOINTS))
    print("  mesh parts : %s" % ([p.name for p in parts] or "none (skeleton only)"))
    print("  clips      : %s" % (clips or "none"))
    textures = sorted({os.path.basename(i.filepath_raw)
                       for i in bpy.data.images if i.filepath_raw})
    print("  textures   : %s" % (textures or "none"))
    for w in written:
        print("  exported   : %s" % w)


if __name__ == "__main__":
    main()
