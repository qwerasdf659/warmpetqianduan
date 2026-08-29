"""把一具外来网格加工成符合契约的宠物资产。

和 `build_skeleton.py` 的区别：那个是**生成**造型（脚本拼图元），
这个是**适配**造型（拿别人做好的网格，套上我们的骨架和规格）。
造型由受过训练的人做、规格适配由脚本做——这个分工才是可持续的。

流程：

  归一化的源网格 → 切出 part_ears → 建 28 根骨架 → 自动权重 + 补漏
  → 生成动画 → 导出 GLB

## 两条刻意不做的事

**不重新展 UV，不烘贴图。** 低多边形模型的 UV 指向一张很小的色块调色板
（这具猫是 32×32），重新 `smart_project` 会把所有顶点指到错误的色块上，
颜色全毁。外来模型的 UV 和贴图要原样保留。

**不切 part_neck。** §5.5 要求颈部能单独隐藏（戴围巾时），但那条规则假设的是
按部件建模的网格。从一具连续的网格上切下一圈颈环，隐藏它就会露出一个洞——
比围巾穿模更糟。所以这里只切耳朵（戴帽藏耳是真正常见的冲突，而且耳朵是
天然可分离的凸起），围巾改用「做大到能包住颈部」来避免穿模。

用法：
  blender --background --factory-startup -noaudio --python-exit-code 1 \
      --python tools/build_pet_from_source.py -- \
      --source assets-src/pet/source/cat_normalized.glb \
      --out assets-src/pet --name pet_cat
"""

import os
import sys
import argparse

import bpy
import bmesh

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rig_spec  # noqa: E402
import animations  # noqa: E402
import build_skeleton  # noqa: E402

# 耳朵的切分区间**从 rig_spec 推导，不写绝对值**。
#
# 原来是 `EAR_MIN_Y = 1.19` / `EAR_MIN_Z = 0.70`，量自那具写实低模猫
# （头顶 1.36、耳根 1.20、头部 z 到 1.18）。rig_spec 的坐标改拟合成 Q 版之后
# 这两个数全废了：Q 版耳根在 1.72，而整只猫的最大 z 只有 0.60——
# `z > 0.70` 一个面都选不出来，脚本却照样打 BUILD_OK。
# 凡是拟合自某一具网格的绝对阈值，换比例都会这样失效。
EAR_ROOT = rig_spec.HEAD_OF["ear_L"]

# 耳根往下留的余量。
#
# **骨骼起点不是网格接缝**：`ear_L` 的 head 埋在颅骨里面，可见的耳朵网格底边
# 比它低一截。`_research/probe-ear-split.py` 扫了这具网格——真值 340 面，
# 余量 0.02 只切下 173 面，0.12（min_y=1.60）切下 365 面。
#
# 宁可多切也不要少切：多切的那 25 面是颅骨顶，藏耳时那个洞永远在帽子底下；
# 少切留下的耳朵碎片是**常驻可见**的一块异色（渲出来是头顶一块橙斑）。
#
# 换一具网格要用那个探针重新定标，别沿用这个数。
EAR_MARGIN = 0.12

# 只用来排除竖起的尾巴。尾巴也可能很高，但它一定在臀部之后。
EAR_MIN_Z = rig_spec.HEAD_OF["tail_01"][2]

# 耳朵占总面数的合理上限。用来抓「阈值太低把整个头都划成耳朵」——
# 那正是旧的绝对阈值（EAR_MIN_Y=1.19）碰上 Q 版网格时会发生的事。
EAR_MAX_SHARE = 0.25


def decimate_to_budget(body, budget):
    """塌陷减面到三角面预算以内。Tripo/Meshy 出的网格常有两三万面。

    用 COLLAPSE 而不是 UNSUBDIV：前者按代价合并边,能保住 UV 缝和大轮廓;
    低模色块模型最怕的是 UV 被打乱(那具 Poly 猫的 32×32 调色板一乱颜色全毁),
    COLLAPSE 会尽量不动 UV 边界。留 3% 余量给切耳朵之后的两块合计。
    """
    body.data.calc_loop_triangles()
    tris = len(body.data.loop_triangles)
    if tris <= budget:
        print("  decimate   : %d tris already within budget %d" % (tris, budget))
        return
    dec = body.modifiers.new(name="Decimate", type="DECIMATE")
    dec.decimate_type = "COLLAPSE"
    dec.use_collapse_triangulate = True
    dec.ratio = (budget * 0.97) / tris
    bpy.ops.object.select_all(action="DESELECT")
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.modifier_apply(modifier=dec.name)
    body.data.calc_loop_triangles()
    print("  decimate   : %d -> %d tris (budget %d)"
          % (tris, len(body.data.loop_triangles), budget))


def simplify_material(parts, tex_size):
    """只保留 BaseColor 一张贴图,缩到 tex_size,丢掉法线 / ORM。

    游戏里宠物整体换成 `builtin-toon`,那个 effect 只采样 mainTexture(BaseColor);
    法线贴图没接口、ORM 更用不上(§5.8 那条「Normal 强烈建议」是给 PBR 宠物的,
    我们的宠物走卡通着色,不吃法线)。所以留一张 512² 的 BaseColor 就够,
    材质数也从此稳稳落在 1(≤2 预算)。

    外来网格的 UV 原样不动(§ 3d-asset-pipeline「UV 和贴图必须原样保留」),
    这里只是**换掉贴图分辨率**,不重新展 UV、不重烘,所以颜色不会错位。
    """
    mats = {m for p in parts for m in p.data.materials if m}
    base_img = None
    for mat in mats:
        if not mat.use_nodes:
            continue
        nt = mat.node_tree
        bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if bsdf is None:
            continue
        link = next((l for l in nt.links
                     if l.to_socket == bsdf.inputs["Base Color"]), None)
        if link and link.from_node.type == "TEX_IMAGE" and link.from_node.image:
            base_img = link.from_node.image
        # 断开法线,让导出器不带它
        for sock in ("Normal",):
            for l in [l for l in nt.links if l.to_socket == bsdf.inputs[sock]]:
                nt.links.remove(l)

    if base_img is None:
        print("  texture    : WARNING no base color image found")
        return

    if base_img.size[0] > tex_size or base_img.size[1] > tex_size:
        print("  texture    : %s %dx%d -> %d"
              % (base_img.name, base_img.size[0], base_img.size[1], tex_size))
        base_img.scale(tex_size, tex_size)
    else:
        print("  texture    : %s %dx%d (kept)"
              % (base_img.name, base_img.size[0], base_img.size[1]))

    # 只留 basecolor 的图像块,其余从数据里清掉,免得导出器把它们塞进 GLB
    keep = {base_img}
    for img in list(bpy.data.images):
        if img not in keep and (img.filepath_raw or img.packed_file or img.pixels):
            try:
                bpy.data.images.remove(img)
            except RuntimeError:
                pass


def load_source(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(path))
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    if not meshes:
        raise SystemExit("no mesh in %s" % path)

    bpy.ops.object.select_all(action="DESELECT")
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.active_object
    # 导入时的变换要烤进网格，否则骨架坐标和网格顶点不在同一个空间里
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    obj.name = "part_body"
    obj.data.name = "part_body"

    xs = [v.co.x for v in obj.data.vertices]
    ys = [v.co.z for v in obj.data.vertices]
    zs = [-v.co.y for v in obj.data.vertices]
    print("  loaded     : %d verts  x[%+.2f,%+.2f] y[%.2f,%.2f] z[%+.2f,%+.2f] (Cocos)"
          % (len(obj.data.vertices), min(xs), max(xs), min(ys), max(ys),
             min(zs), max(zs)))
    return obj


def split_ears(body):
    """把耳朵切成独立网格（§5.5 戴帽要能藏耳）。

    判据是 Cocos 空间里「够高 + 够偏 + 不在臀后」，三个界都从 rig_spec 的耳骨
    坐标推出来。Blender 里 y 上 = z，z 前 = -y，所以下面比的是
    `co.z` 对高度、`co.x` 对侧向、`-co.y` 对前后。
    """
    mesh = body.data
    bpy.ops.object.select_all(action="DESELECT")
    body.select_set(True)
    bpy.context.view_layer.objects.active = body

    # 必须在编辑模式里用 bmesh 选，而且先显式全不选。
    #
    # 在物体模式设 `poly.select` 不管用：进编辑模式时 Blender 按当前的
    # 选择模式重新推导选区，而刚导入的网格顶点往往是**全选**状态——
    # 结果 separate 把整只猫都划给了耳朵，part_body 变成空网格，
    # 报错却发生在很后面的导出阶段（"has no primitives"），很难往回追。
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="DESELECT")
    bpy.ops.mesh.select_mode(type="FACE")

    min_y = EAR_ROOT[1] - EAR_MARGIN

    bm = bmesh.from_edit_mesh(mesh)
    for face in bm.faces:
        face.select = all(
            v.co.z > min_y and -v.co.y > EAR_MIN_Z for v in face.verts)
    picked = [f for f in bm.faces if f.select]
    total = len(bm.faces)
    xs = [v.co.x for f in picked for v in f.verts]
    bmesh.update_edit_mesh(mesh)

    print("  ear region : y>%.2f z>%+.2f (from rig_spec ear_L / tail_01)"
          % (min_y, EAR_MIN_Z))
    print("  ear faces  : %d / %d" % (len(picked), total))

    if not picked:
        bpy.ops.object.mode_set(mode="OBJECT")
        print("  WARNING: no faces matched the ear region, part_ears not created")
        return None

    # 两条通用防线。判据都很弱，但它们守的是**整类**错误，
    # 而这类错误单看面数是发现不了的。
    if len(picked) > EAR_MAX_SHARE * total:
        bpy.ops.object.mode_set(mode="OBJECT")
        raise SystemExit(
            "BUILD_FAILED: ear region took %d/%d faces (>%.0f%%); "
            "min_y=%.2f is too low -- the whole head is being classified as ears"
            % (len(picked), total, EAR_MAX_SHARE * 100, min_y))
    if min(xs) >= 0 or max(xs) <= 0:
        bpy.ops.object.mode_set(mode="OBJECT")
        raise SystemExit(
            "BUILD_FAILED: ear region is entirely on one side (x [%+.2f, %+.2f]); "
            "expected two lobes straddling x=0" % (min(xs), max(xs)))

    bpy.ops.mesh.separate(type="SELECTED")
    bpy.ops.object.mode_set(mode="OBJECT")

    # separate 把新块作为另一个选中对象留在场景里
    ears = next(o for o in bpy.context.selected_objects if o is not body)
    ears.name = "part_ears"
    ears.data.name = "part_ears"
    return ears


def report(parts):
    for obj in parts:
        obj.data.calc_loop_triangles()
        xs = [v.co.x for v in obj.data.vertices]
        ys = [v.co.z for v in obj.data.vertices]           # Cocos y
        zs = [-v.co.y for v in obj.data.vertices]          # Cocos z
        print("  %-11s tris=%-5d x[%+.2f,%+.2f] y[%.2f,%.2f] z[%+.2f,%+.2f]"
              % (obj.name, len(obj.data.loop_triangles),
                 min(xs), max(xs), min(ys), max(ys), min(zs), max(zs)))


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--name", default="pet_cat")
    ap.add_argument("--no-anim", action="store_true")
    ap.add_argument("--no-ears", action="store_true",
                    help="不切耳朵，整只留成 part_body。图生 3D 的连续高模上，"
                         "切耳会把薄薄的内耳膜蒙皮扯坏，得不偿失——和 part_neck "
                         "同类的已知取舍。代价是丢掉「帽子遮耳」（§5.5），可接受。")
    ap.add_argument("--anim-gain", type=float, default=1.0)
    ap.add_argument("--tri-budget", type=int, default=rig_spec.TRI_BUDGET["pet"],
                    help="减面目标,默认宠物预算 3000")
    ap.add_argument("--tex-size", type=int, default=rig_spec.TEX_SIZE["pet"],
                    help="BaseColor 目标边长,默认 512")
    args = ap.parse_args(argv)

    animations.set_gain(args.anim_gain)

    body = load_source(args.source)
    decimate_to_budget(body, args.tri_budget)

    if args.no_ears:
        # 整只不切。内耳膜是连续网格上的一片薄面，切下来单独蒙皮会被扯成
        # 一片耷拉的碎片（和 part_neck 切颈环露洞同类）。inspect_fbx 会为
        # 缺少 part_ears 报一条 FAIL，那是已知且接受的偏差。
        parts = [body]
        print("  ears       : kept joined (--no-ears)")
        arm = build_skeleton.build_armature()
        build_skeleton.skin_to_armature(parts, arm)
        simplify_material(parts, args.tex_size)
        clips = []
        if not args.no_anim:
            for clip_name, builder in animations.BUILDERS.items():
                builder(arm)
                clips.append(clip_name)
        os.makedirs(args.out, exist_ok=True)
        path = os.path.join(args.out, args.name + ".glb")
        build_skeleton.export_glb(path, has_anim=bool(clips))
        print("BUILD_OK")
        print("  bones      : %d (limit %d)" % (len(arm.data.bones), rig_spec.MAX_JOINTS))
        report(parts)
        print("  clips      : %s" % (clips or "none"))
        print("  exported   : %s" % path)
        return

    ears = split_ears(body)
    if ears is None:
        # 这里不能继续。§5.5 的遮挡规则要求 part_ears 是独立网格节点，
        # 少了它导出的就是个不合规的资产——而原来这条路只打一句 WARNING
        # 就走到 BUILD_OK，产物要等 inspect_fbx 才被拦下，中间那段时间里
        # 它看起来完全是「构建成功」的。
        #
        # 切不出来几乎总是同一个原因：rig_spec 的耳骨坐标还没拟合到这具网格上。
        # 回去跑 inspect_source.py 量一遍、填进 BONES，再重跑本脚本。
        raise SystemExit(
            "BUILD_FAILED: part_ears could not be split from the source mesh; "
            "refit rig_spec ear_L / ear_R to this mesh and retry")
    parts = [body, ears]

    arm = build_skeleton.build_armature()
    build_skeleton.skin_to_armature(parts, arm)
    simplify_material(parts, args.tex_size)

    clips = []
    if not args.no_anim:
        for clip_name, builder in animations.BUILDERS.items():
            builder(arm)
            clips.append(clip_name)

    os.makedirs(args.out, exist_ok=True)
    path = os.path.join(args.out, args.name + ".glb")
    build_skeleton.export_glb(path, has_anim=bool(clips))

    print("BUILD_OK")
    print("  source     : %s" % args.source)
    print("  bones      : %d (limit %d)" % (len(arm.data.bones), rig_spec.MAX_JOINTS))
    report(parts)
    print("  clips      : %s" % (clips or "none"))
    print("  exported   : %s" % path)


if __name__ == "__main__":
    main()
