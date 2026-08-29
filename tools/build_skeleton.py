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


def add_sphere(center, radii, res=None):
    segments, rings = res or (SPHERE_SEGMENTS, SPHERE_RINGS)
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=segments, ring_count=rings, radius=1.0)
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


def build_skin_part(graph, name, subdiv, tri_budget):
    """用 Skin 修改器 + 细分曲面从骨架图长出一个部件。

    优点是真的：沿边生成连续管面、分叉点自动过渡、出来是有边流的四边形网格，
    关节不再是「两个球泡在一起」。输入也正好是手上已有的关节坐标 + 粗细。

    **但在 3000 面的预算里它打不过球体那条路，实测过五轮：**

    | 配置 | 结果 |
    | --- | --- |
    | 细分一级 | 截面只有八边，躯干像个倒角木盒子 |
    | 细分二级 | 圆了，但减面前就有 9000 面 |
    | 二级 + 减面到 2000 | 四条腿被合并成一个桶，腿之间的空隙没了 |

    根因是 Skin 每个环只有四条边，**圆不圆完全取决于细分级数**，加节点只加环
    不加边。而二级细分的面数是预算的三倍，减面又保不住相邻肢体之间的空隙。

    另外分叉枢纽的形状不可控，头挂在图上会比设定小一圈，眼睛耳朵全飘出去——
    所以头最后还是用图元单独做（见 species._DOG_HEAD）。

    什么时候该回来用它：**面数预算抬到 6000 以上**（比如宠物按 §8.5 挪进远程
    Asset Bundle 之后），二级细分不用减面，上面三条问题一次全消。
    """
    nodes = graph["nodes"]
    order = list(nodes.keys())
    index = {n: i for i, n in enumerate(order)}
    verts = [to_blender(nodes[n][0]) for n in order]

    edges = set()
    for chain in graph["chains"]:
        for a, b in zip(chain, chain[1:]):
            edges.add(tuple(sorted((index[a], index[b]))))

    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(v) for v in verts], sorted(edges), [])
    mesh.update()

    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj

    skin = obj.modifiers.new(name="Skin", type="SKIN")
    skin.use_smooth_shade = True

    # skin_vertices 这一层是**加了修改器之后**才存在的，提前访问会 KeyError
    layer = mesh.skin_vertices[0].data
    for n, i in index.items():
        r = nodes[n][1] * rig_spec.RIG_SCALE
        layer[i].radius = (r, r)
    # 必须指定一个根顶点，否则 Skin 不知道从哪里开始生成
    layer[0].use_root = True

    bpy.ops.object.modifier_apply(modifier=skin.name)

    if subdiv:
        sub = obj.modifiers.new(name="Subdiv", type="SUBSURF")
        sub.levels = subdiv
        sub.render_levels = subdiv
        bpy.ops.object.modifier_apply(modifier=sub.name)

    # 二级细分本身已经够光滑，平滑只再收一点点，多了会把体积一起吃掉
    smooth = obj.modifiers.new(name="Smooth", type="SMOOTH")
    smooth.factor = 0.4
    smooth.iterations = 1
    bpy.ops.object.modifier_apply(modifier=smooth.name)

    obj.data.calc_loop_triangles()
    tris = len(obj.data.loop_triangles)
    if tris > tri_budget:
        dec = obj.modifiers.new(name="Decimate", type="DECIMATE")
        dec.decimate_type = "COLLAPSE"
        dec.ratio = tri_budget / tris
        bpy.ops.object.modifier_apply(modifier=dec.name)

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


# 眼球在 UV 图集里单独占一块，不让 smart_project 把它切碎。
#
# 实测（`_research/probe-eye-uv.py`）：smart_project 把**每只眼球切成 6 个
# 35×36 px 的小岛**，整只眼睛的图案跨在六块之间，每块四周还各有 6 px 的烘焙留边。
# 星形高光因此永远是虚的——不是贴花画得不够细，是它落地的像素不够、而且被缝切开。
#
# 改法：把 smart_project 的结果整体缩到 [0, BODY_UV_FIT]²，右边空出来的一条
# 给两只眼睛，每只一个 EYE_UV_SIZE 的方块（512 图上 128 px）。眼球的 UV 直接按
# 贴花那套光轴平面投影算，于是**纹素网格和贴花的像素是对齐的**，能到最锐。
#
# 代价是身体损失 27% 的线性分辨率。这笔交换合算：毛色和毛流都是低频的，
# 而眼睛是全脸唯一的高频细节，也是玩家唯一会盯着看的地方。
BODY_UV_FIT = 0.73
EYE_UV_SIZE = 0.25
EYE_UV_ORIGIN = [(0.745, 0.005), (0.745, 0.265)]
# 只搬**朝前那半个球**。整个球搬过去的话前后两半会投影到同一块 UV 上，
# 烘焙时互相覆盖，而且 inspect_fbx 的 UV 重叠检查会直接 FAIL。
# 0.12 这个门限还顺手滤掉赤道附近那圈掠射的退化面（可见边界在 0.31）。
EYE_FRONT_MIN = 0.12


def scale_uvs(parts, factor):
    """整体缩放 UV，给专用岛腾地方。以 (0,0) 为锚点，缩完仍在 0-1 内。"""
    for part in parts:
        for loop_uv in part.data.uv_layers.active.data:
            loop_uv.uv = (loop_uv.uv[0] * factor, loop_uv.uv[1] * factor)


def project_eye_uvs(parts, eyes):
    """把每只眼球的前半球换成沿光轴的平面投影 UV，放进预留的方块里。

    判据和烘焙着色器里的遮罩保持一致（`pet_texture.EYE_MASK_RADIUS`），
    否则会出现「这块面吃到了贴花但 UV 没搬过来」的错位。
    """
    body = next((p for p in parts if p.name == "part_body"), None)
    if body is None:
        return 0

    mesh = body.data
    slots = {i for i, m in enumerate(mesh.materials) if m and m.name == "pet_detail"}
    if not slots:
        return 0
    uv = mesh.uv_layers.active.data
    mw = body.matrix_world
    rot = mw.to_3x3()
    moved = 0

    for (center, radius, axis), (ox, oy) in zip(eyes, EYE_UV_ORIGIN):
        c = to_blender(center)
        r = radius * rig_spec.RIG_SCALE
        w = to_blender(axis).normalized()
        side = Vector((0.0, 0.0, 1.0)).cross(w)
        side = side.normalized() if side.length > 1e-6 else Vector((1.0, 0.0, 0.0))
        up = w.cross(side)

        for poly in mesh.polygons:
            if poly.material_index not in slots:
                continue
            if (mw @ poly.center - c).length > r * pet_texture.EYE_MASK_RADIUS:
                continue
            if (rot @ poly.normal).normalized().dot(w) < EYE_FRONT_MIN:
                continue
            for li in poly.loop_indices:
                d = (mw @ mesh.vertices[mesh.loops[li].vertex_index].co) - c
                su = max(-1.0, min(1.0, d.dot(side) / r))
                sv = max(-1.0, min(1.0, d.dot(up) / r))
                uv[li].uv = (ox + (su * 0.5 + 0.5) * EYE_UV_SIZE,
                             oy + (sv * 0.5 + 0.5) * EYE_UV_SIZE)
            moved += 1

    return moved


def flatten_eye_normals(parts, eyes):
    """把眼球前半球的法线全部改成光轴方向，让整只眼睛吃同一档色阶。

    参考图（docs/06 §5.2 方向 A）那双眼睛是 **2D 平涂**：一片均匀的暖棕加一颗星。
    而球面在三档卡通着色下必然有明暗渐变——朝侧面的那一圈被乘上 shadeColor，
    左下角压出一块阴影，眼睛就读成一颗玻璃弹珠而不是手绘的眼睛。

    法线一拍平，`0.5 * dot(N, L) + 0.5` 在整个前半球上是同一个值，
    落在 baseStep 之上就是满亮度的一片平涂。剪影完全不变，代价是零。

    副作用要知道：引擎的描边 pass 是 `localPos += normal * lineWidth * 0.001`，
    所以眼球的描边壳会变成「整体沿光轴前移」而不是「向外扩一圈」。
    这正合意——眼廓已经画在贴花里了，不需要再来一圈几何描边。
    """
    body = next((p for p in parts if p.name == "part_body"), None)
    if body is None:
        return 0

    mesh = body.data
    slots = {i for i, m in enumerate(mesh.materials) if m and m.name == "pet_detail"}
    if not slots:
        return 0

    # 必须先把现有的逐角法线整套读出来：normals_split_custom_set 要求给全网格
    # 每个角一个值，只传眼球那些会把其余部分全抹平。
    normals = [tuple(cn.vector) for cn in mesh.corner_normals]
    mw = body.matrix_world
    rot = mw.to_3x3()
    inv = rot.inverted_safe()
    flattened = 0

    for center, radius, axis in eyes:
        c = to_blender(center)
        r = radius * rig_spec.RIG_SCALE
        w = to_blender(axis).normalized()
        local = (inv @ w).normalized()

        for poly in mesh.polygons:
            if poly.material_index not in slots:
                continue
            if (mw @ poly.center - c).length > r * pet_texture.EYE_MASK_RADIUS:
                continue
            if (rot @ poly.normal).normalized().dot(w) < EYE_FRONT_MIN:
                continue
            for li in poly.loop_indices:
                normals[li] = tuple(local)
            flattened += 1

    mesh.normals_split_custom_set(normals)
    return flattened


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
        # 自动权重不保证给每个部件都建出顶点组——外来网格上尤其常见，
        # 小而孤立的部件（切下来的耳朵）可能一个组都没有。
        # 那两个算子在没有顶点组时会直接抛异常，所以要先判一下；
        # 真正的兜底是下面的 fill_unweighted，它按距离把顶点指派给最近的骨头。
        if p.vertex_groups:
            bpy.ops.object.vertex_group_limit_total(limit=4)
            bpy.ops.object.vertex_group_normalize_all(lock_active=False)
        else:
            print("  NOTE: %s got no auto weights, falling back to nearest-bone" % p.name)
        fill_unweighted(p, arm_obj)
        unify_coincident_weights(p)


def unify_coincident_weights(obj, max_influences=4):
    """把**位置重合**的顶点的权重强制统一。

    低多边形模型在硬边和 UV 缝处顶点是成对重复的（那只猫 1120 个顶点里有
    821 个是冗余的）。这类网格有一种特有的失效方式：一对本来重合的顶点被
    指派给了不同骨骼，骨骼一动它们就分开，模型上裂出缝——看起来是
    「网格被切成一块一块的」，而静止姿态下完全正常，所以很容易漏掉。

    成因是权重来自两个不同的来源：自动权重覆盖到的顶点走热力图，
    没覆盖到的走 `fill_unweighted` 的硬指派。一对重合顶点各走一条，结果就不一致。

    所以这里不去修某一个来源，而是在最后一步抹平差异：按位置分桶，
    桶内取平均权重再归一化。只要重合顶点权重相同，无论怎么运动都不会分开。

    对我们自己程序化生成的网格是空操作——那些网格是焊死的，没有重合顶点。
    """
    mesh = obj.data
    buckets = {}
    for vert in mesh.vertices:
        key = (round(vert.co.x, 5), round(vert.co.y, 5), round(vert.co.z, 5))
        buckets.setdefault(key, []).append(vert.index)

    groups = obj.vertex_groups
    fixed = 0
    for ids in buckets.values():
        if len(ids) < 2:
            continue

        total = {}
        for i in ids:
            for ge in mesh.vertices[i].groups:
                total[ge.group] = total.get(ge.group, 0.0) + ge.weight
        if not total:
            continue

        # 合并会取两者骨骼的并集，可能超过 4 根；引擎的 a_weights 是 vec4，
        # 超出的会被静默丢弃，所以这里先截断再归一化。
        top = sorted(total.items(), key=lambda kv: kv[1], reverse=True)[:max_influences]
        scale = sum(w for _, w in top)
        if scale <= 0.0:
            continue

        for gi in total:
            groups[gi].remove(ids)
        for gi, w in top:
            groups[gi].add(ids, w / scale, "REPLACE")
        fixed += 1

    if fixed:
        print("  unified %d coincident vertex groups on %s" % (fixed, obj.name))


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


def make_shape(kind, params):
    if kind == "sphere":
        return add_sphere(*params)
    if kind == "taper":
        return add_taper(*params)
    raise ValueError("unknown shape kind: %s" % kind)


# Skin 的截面只有四边，**圆不圆完全取决于细分级数**，加节点只会加环、不会加边。
# 一级细分出来是八边形，躯干看着像个倒角的木盒子。
#
# 所以走二级细分再塌陷减面：二级的顶点已经落在光滑曲面上，减面是合并边、
# 不会把顶点挪回盒子上，所以剪影还是圆的。直接一级细分省下来的面数
# 换不到这个效果。
SKIN_SUBDIV = 2
SKIN_BUDGET = {"part_body": 2000, "part_neck": 200}


def build_placeholder_skin(arm_obj, profile, materials):
    """身体和颈部用 Skin + 细分长出来，耳朵仍是压扁的锥台，五官仍是小图元。

    Skin 只会长管子，长不出扁平的耳廓，也长不出眼球这种独立小件，
    所以这三类各用最合适的做法，不强求统一。
    """
    parts = [
        build_skin_part(profile["skin_body"], "part_body",
                        SKIN_SUBDIV, SKIN_BUDGET["part_body"]),
        build_skin_part(profile["skin_neck"], "part_neck",
                        SKIN_SUBDIV, SKIN_BUDGET["part_neck"]),
    ]
    for part in parts:
        part.data.materials.clear()
        part.data.materials.append(materials["pet_body"])

    voxel, budget, smooth = profile["fuse"]["part_ears"]
    ears = [make_shape(kind, params)
            for kind, _bone, _mat, params in profile["ear_shapes"]]
    ear_part = fuse(ears, "part_ears", voxel * rig_spec.RIG_SCALE, budget, smooth)
    ear_part.data.materials.clear()
    ear_part.data.materials.append(materials["pet_body"])
    parts.append(ear_part)

    # 头单独融合成一块。体素比身体细一档——吻部要能读出来，
    # 粗体素会把它抹平成一张脸。
    head_pieces = [make_shape(kind, params)
                   for kind, _bone, _mat, params in profile["head_shapes"]]
    head = fuse(head_pieces, "head_blob", 0.016 * rig_spec.RIG_SCALE, 900, 3)
    head.data.materials.clear()
    head.data.materials.append(materials["pet_body"])

    # 五官整块并进身体，各自保留材质槽，作为独立的面片岛存在
    face = [head]
    for kind, _bone, mat_name, params in profile["face_shapes"]:
        obj = make_shape(kind, params)
        obj.data.materials.append(materials[mat_name])
        face.append(obj)

    body = parts[0]
    bpy.ops.object.select_all(action="DESELECT")
    for obj in face:
        obj.select_set(True)
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()

    return parts


def _finish_placeholder(parts, arm_obj, profile, materials, tex_dir, tex_name):
    """两条造型路线的公共收尾：统一展 UV、烘贴图、蒙皮。"""
    pack_uv(parts)
    scale_uvs(parts, BODY_UV_FIT)
    moved = project_eye_uvs(parts, profile["eyes"])
    print("  eye uv     : %d faces moved to dedicated islands" % moved)
    if tex_dir:
        others = [m for name, m in materials.items() if name != "pet_body"]
        pet_texture.bake(parts, materials["pet_body"], others, to_blender,
                         tex_dir, tex_name, profile["blobs"], profile["features"],
                         profile["eyes"])
    # 拍平法线放在烘焙**之后**：法线贴图那一遍烘的是着色法线，
    # 先拍平会把眼球那块烘成一片平面法线。pet_toon 用不到法线贴图，
    # 但没理由往交付物里放一块已知是错的数据。
    flat = flatten_eye_normals(parts, profile["eyes"])
    print("  eye normals: %d faces flattened to the optical axis" % flat)
    skin_to_armature(parts, arm_obj)
    return parts


def build_placeholder(arm_obj, profile, body_mode="skin", tex_dir=None, tex_name=None):
    materials = make_materials()
    if body_mode == "skin":
        parts = build_placeholder_skin(arm_obj, profile, materials)
        return _finish_placeholder(parts, arm_obj, profile, materials, tex_dir, tex_name)

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
        obj = make_shape(kind, params)
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
    if details:
        body = next(p for p in parts if p.name == "part_body")
        bpy.ops.object.select_all(action="DESELECT")
        for d in details:
            d.select_set(True)
        body.select_set(True)
        bpy.context.view_layer.objects.active = body
        bpy.ops.object.join()

    return _finish_placeholder(parts, arm_obj, profile, materials, tex_dir, tex_name)


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
    ap.add_argument("--body", default="blob", choices=("blob", "skin"),
                    help="造型做法：blob=图元+体素重构（默认，当前预算下更好看）"
                         "；skin=Skin 修改器+细分（见 build_skin_part 的实测结论）")
    ap.add_argument("--skeleton-only", action="store_true")
    ap.add_argument("--also-fbx", action="store_true")
    ap.add_argument("--no-anim", action="store_true")
    ap.add_argument("--no-texture", action="store_true",
                    help="跳过毛色贴图烘焙，只导纯色材质")
    ap.add_argument("--anim-gain", type=float, default=1.0,
                    help="动画幅度增益，调试时放大用，正式资源保持 1.0")
    args = ap.parse_args(argv)
    name = args.name or ("pet_" + args.species)

    # 骨架的 28 个坐标是**活的**（rig_spec 开头那条），而 species.py 的图元
    # 尺寸是按 Q 版比例摆的。骨架一旦重新拟合到一具外来网格，两者的比例就
    # 差一倍，这条路生成的东西是错的——那种情况用 build_pet_from_source.py。
    #
    # 判据取前腿根的高度：Q 版是 0.34，采购那只低模猫拟合出来是 0.9。
    # 别拿 RIG_SCALE 判——它只是个换算系数，Q 版坐标改成最终单位之后
    # 就一直是 1.0，那个旧判据会在正确的配置下天天误报。
    leg_top = rig_spec.HEAD_OF["leg_front_L_01"][1]
    if abs(leg_top - 0.34) > 0.10:
        print("WARNING: rig_spec 的前腿根在 y=%.2f，species.py 的图元按 0.34 排，"
              "比例不匹配。" % leg_top)
        print("         正式宠物资源请用 tools/build_pet_from_source.py。")

    animations.set_gain(args.anim_gain)

    reset_scene()
    arm_obj = build_armature()
    tex_dir = None if (args.skeleton_only or args.no_texture) \
        else os.path.join(args.out, "tex")
    parts = [] if args.skeleton_only else build_placeholder(
        arm_obj, species.PROFILES[args.species],
        body_mode=args.body, tex_dir=tex_dir, tex_name=name)

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
    print("  species    : %s (body=%s)" % (args.species, args.body))
    for part in parts:
        part.data.calc_loop_triangles()
        print("  %-11s: %d tris" % (part.name, len(part.data.loop_triangles)))
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
