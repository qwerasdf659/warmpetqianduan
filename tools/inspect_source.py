"""量一个外来模型的身体结构，并归一化到我们的坐标约定。

买来或下来的模型不会符合任何约定：尺寸可能是 71 单位、原点在几何中心、
朝向不确定。而要把 28 根骨架拟合到它身上，第一件事是**知道各部位在哪**。

用肉眼看透视渲图猜坐标很不准，所以这里输出两样东西：

1. **归一化后的 GLB**：整体高度缩到 §5.3 的 2.0，脚底落在 y=0，面朝 +Z
2. **三视图的 ASCII 剪影**：把网格按格子占位打印出来，
   头、四肢、尾巴的位置直接从图上读坐标，比看渲图猜可靠得多

**朝向要显式传 `--forward`，不是自动判的。** 长轴能自动判（四足动物身长一定是
水平方向最长的那根轴），头尾不能：试过用「哪一端横截面更宽」来猜，在低模猫上
判反了——尾端有两条后腿撑开，比只有一个脑袋的头端还宽。先不传 `--out`
看一眼三视图，再决定传什么。

用法：
  blender --background --factory-startup -noaudio --python-exit-code 1 \
      --python tools/inspect_source.py -- \
      --file assets-src/pet/source/cat_source.glb \
      --out assets-src/pet/source/cat_normalized.glb
"""

import os
import sys
import argparse

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rig_spec  # noqa: E402
import inspect_fbx  # noqa: E402  骨骼显示网格的判据只有一份，在那边

GRID_W = 56
GRID_H = 24

# 贴地顶点的判定带宽，按总高的比例给。
#
# 原来是绝对值 0.16，那是照写实猫（腿长 0.9）定的。Q 版的腿全长只有 0.34，
# 0.16 一下吃掉半条腿，四爪的 z 全被抹平。**凡是拟合自某一具网格的绝对阈值，
# 换比例就会失效**——这类常数一律写成比例。
GROUND_BAND = 0.05

# 头、尾各取身长的这个比例。
#
# 尾巴原来的判据是 `y > 1.35`：写实猫只有竖起的尾巴超过这个高度，所以碰巧能用。
# Q 版猫头顶 1.72、耳尖 2.00，同一行会把整个头当成尾巴量（实测 1872 个顶点，
# z 范围还落在 +0.49 这种明显在前面的位置）。四足动物的尾巴该按**身长的后段**
# 定义，不是按高度。
HEAD_BAND = 0.28
TAIL_BAND = 0.22


def import_any(path):
    """按扩展名导入。FBX 和 glTF 都收——Tripo / Meshy 常给 FBX。

    FBX 的长度单位是厘米,导进来会是 100× 大、而且带一层缩放;但归一化那步
    会把整体高度重设成 2.0,缩放被彻底吸收,所以这里不用特殊处理。
    朝向由 `--forward` 显式给,同样不依赖导入器的轴设置。
    """
    ext = os.path.splitext(path)[1].lower()
    if ext == ".fbx":
        bpy.ops.import_scene.fbx(filepath=os.path.abspath(path))
    elif ext in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=os.path.abspath(path))
    else:
        raise SystemExit("unsupported source format: %s" % ext)


def load(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    import_any(path)

    # glTF 导入器会为骨骼造显示用的 Icosphere。它不属于资产，而**混进来不会报错**：
    # 它是个 ±1 的球，归一化的缩放系数会按「球 + 模型」的合并包围盒算
    # （实测 0.667，正确值 0.978），贴地带宽里也会混进球底的顶点，
    # 四爪坐标变成左右不对称的乱数。全程零报错，最后照样打 SOURCE_OK。
    shapes = inspect_fbx.bone_shape_objects(
        [o for o in bpy.data.objects if o.type == "ARMATURE"])
    meshes = [o for o in bpy.data.objects
              if o.type == "MESH" and o not in shapes]
    if shapes:
        print("  skipped    : %s (bone display shapes)"
              % sorted(o.name for o in shapes))
    if not meshes:
        raise SystemExit("no mesh in %s" % path)
    return meshes


def world_verts(meshes):
    pts = []
    for obj in meshes:
        mw = obj.matrix_world
        for v in obj.data.vertices:
            pts.append(mw @ v.co)
    return pts


def bake_transforms(meshes):
    """把导入时的变换烤进网格，后面所有测量和缩放才对得上。"""
    bpy.ops.object.select_all(action="DESELECT")
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def detect_long_axis(pts):
    """长轴：四足动物身长一定是水平方向最长的那根轴。"""
    span_x = max(p.x for p in pts) - min(p.x for p in pts)
    span_y = max(p.y for p in pts) - min(p.y for p in pts)
    return "y" if span_y >= span_x else "x"


# 从「头朝源模型的哪个方向」到「要绕 Z 转多少度」的映射。
# 目标是把头转到 Blender 的 -Y，也就是 Cocos 的 +Z（§5.3 朝向 +Z）。
#
# 为什么不自动判头尾：试过用「哪一端横截面更宽」来猜，在这只猫上判反了——
# 尾端有两条后腿撑开，比只有一个脑袋的头端还宽。低面数模型上这类启发式
# 都不可靠，所以改成显式传入，由人看一眼三视图决定。
FORWARD_ROT = {"-y": 0.0, "+y": 180.0, "+x": -90.0, "-x": 90.0}


def normalize(meshes, forward):
    """转到我们的约定：面朝 +Z（Blender 的 -Y），脚底 z=0，整体高 2.0。"""
    import math

    rot_z = math.radians(FORWARD_ROT[forward])

    bpy.ops.object.select_all(action="DESELECT")
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]

    if rot_z:
        bpy.ops.transform.rotate(value=rot_z, orient_axis="Z", orient_type="GLOBAL")
        bpy.ops.object.transform_apply(rotation=True)

    pts = world_verts(meshes)
    height = max(p.z for p in pts) - min(p.z for p in pts)
    scale = rig_spec.TARGET_HEIGHT / height if height > 0 else 1.0
    bpy.ops.transform.resize(value=(scale, scale, scale))
    bpy.ops.object.transform_apply(scale=True)

    pts = world_verts(meshes)
    shift = Vector((
        -(max(p.x for p in pts) + min(p.x for p in pts)) / 2.0,
        -(max(p.y for p in pts) + min(p.y for p in pts)) / 2.0,
        -min(p.z for p in pts),
    ))
    bpy.ops.transform.translate(value=shift)
    bpy.ops.object.transform_apply(location=True)
    return scale


def landmarks(pts):
    """把拟合骨架要用的关键点算出来，输出的是 **Cocos 坐标**。

    为什么不靠读三视图：ASCII 图的分辨率只到 ±0.04，而且侧视图把左右腿
    压在一起，四条腿的 x 读不出来。这里直接算。

    四条腿的定位用「贴地顶点按 x 正负 / 前后分成四象限」——站姿四足动物
    一定是这个拓扑，比通用聚类简单也更稳。
    """
    def cocos(p):
        return (p.x, p.z, -p.y)

    cps = [cocos(p) for p in pts]
    zs = [c[2] for c in cps]
    z_mid = (min(zs) + max(zs)) / 2.0
    ground = [c for c in cps if c[1] < GROUND_BAND * rig_spec.TARGET_HEIGHT]

    print("\nLANDMARKS (Cocos: x right, y up, z forward)")

    paws = {}
    for name, x_pos, front in (("front_L", True, True), ("front_R", False, True),
                               ("back_L", True, False), ("back_R", False, False)):
        sel = [c for c in ground
               if (c[0] > 0) == x_pos and (c[2] > z_mid) == front]
        if not sel:
            continue
        cx = sum(c[0] for c in sel) / len(sel)
        cz = sum(c[2] for c in sel) / len(sel)
        paws[name] = (cx, cz)
        print("  paw %-8s x=%+.3f z=%+.3f  (%d verts)" % (name, cx, cz, len(sel)))

    # 四爪必须左右镜像。不对称说明贴地带宽里混进了不该有的顶点，
    # 而那种数据看起来完全正常（就是几个小数），不显式判一次是发现不了的——
    # Icosphere 那次事故的表征恰恰就是这个。
    for left, right in (("front_L", "front_R"), ("back_L", "back_R")):
        if left not in paws or right not in paws:
            print("  WARNING: %s / %s missing, leg landmarks incomplete"
                  % (left, right))
            continue
        skew = abs(paws[left][0] + paws[right][0])
        span = max(abs(paws[left][0]), abs(paws[right][0]), 1e-6)
        if skew > 0.25 * span:
            print("  WARNING: %s / %s not mirrored (x %+.3f vs %+.3f)"
                  % (left, right, paws[left][0], paws[right][0]))

    # 沿身长切片，每片给出脊背高度和宽度——脊椎和四肢根部的高度从这里取
    print("  spine profile (z from front to back):")
    steps = 8
    z_lo, z_hi = min(zs), max(zs)
    for i in range(steps):
        a = z_hi - (i + 1) * (z_hi - z_lo) / steps
        b = z_hi - i * (z_hi - z_lo) / steps
        sel = [c for c in cps if a <= c[2] <= b]
        if not sel:
            continue
        top = max(c[1] for c in sel)
        width = max(c[0] for c in sel) - min(c[0] for c in sel)
        print("    z %+.2f..%+.2f  top=%.2f  width=%.2f  n=%d"
              % (a, b, top, width, len(sel)))

    def bbox(label, sel):
        if not sel:
            print("  %-13s none" % label)
            return
        print("  %-13s x[%+.2f,%+.2f] y[%.2f,%.2f] z[%+.2f,%+.2f]  n=%d"
              % (label,
                 min(c[0] for c in sel), max(c[0] for c in sel),
                 min(c[1] for c in sel), max(c[1] for c in sel),
                 min(c[2] for c in sel), max(c[2] for c in sel), len(sel)))

    span = z_hi - z_lo
    bbox("head bbox", [c for c in cps if c[2] > z_hi - span * HEAD_BAND])
    bbox("tail bbox", [c for c in cps if c[2] < z_lo + span * TAIL_BAND])
    return paws


def silhouette(pts, horiz, vert, title, flip_h=False):
    """把顶点打进格子，输出 ASCII 剪影。

    读法：横轴和纵轴上都标了刻度，直接从图上读部位坐标。
    比看透视渲图猜可靠——渲图有透视缩放，读不出数。
    """
    hs = [getattr(p, horiz) for p in pts]
    vs = [getattr(p, vert) for p in pts]
    h_lo, h_hi = min(hs), max(hs)
    v_lo, v_hi = min(vs), max(vs)
    h_span = max(1e-6, h_hi - h_lo)
    v_span = max(1e-6, v_hi - v_lo)

    grid = [[" "] * GRID_W for _ in range(GRID_H)]
    for p in pts:
        h = (getattr(p, horiz) - h_lo) / h_span
        if flip_h:
            h = 1.0 - h
        col = min(GRID_W - 1, int(h * (GRID_W - 1)))
        row = min(GRID_H - 1, int((getattr(p, vert) - v_lo) / v_span * (GRID_H - 1)))
        grid[GRID_H - 1 - row][col] = "#"

    print("\n%s   %s: %.2f .. %.2f%s   %s: %.2f .. %.2f"
          % (title, horiz, h_lo, h_hi, " (flipped)" if flip_h else "",
             vert, v_lo, v_hi))
    for r, row in enumerate(grid):
        value = v_hi - (r / (GRID_H - 1)) * v_span
        print("  %6.2f |%s|" % (value, "".join(row)))
    ruler = "".join("+" if c % 10 == 0 else "-" for c in range(GRID_W))
    print("         |%s|" % ruler)
    labels = " " * 9
    for c in range(0, GRID_W, 10):
        h = c / (GRID_W - 1)
        value = h_hi - h * h_span if flip_h else h_lo + h * h_span
        labels += ("%-10.2f" % value)
    print(labels)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", required=True)
    ap.add_argument("--out")
    ap.add_argument("--forward", default="-y", choices=sorted(FORWARD_ROT),
                    help="源模型里头朝哪个方向（先不传 --out 看一眼三视图再定）")
    args = ap.parse_args(argv)

    meshes = load(args.file)
    bake_transforms(meshes)

    pts = world_verts(meshes)
    print("SOURCE: %s" % args.file)
    print("  meshes     : %s" % [o.name for o in meshes])
    print("  verts      : %d" % len(pts))
    print("  long axis  : %s   forward=%s" % (detect_long_axis(pts), args.forward))

    scale = normalize(meshes, args.forward)
    pts = world_verts(meshes)
    print("  scale      : x%.5f -> height %.3f" % (scale, rig_spec.TARGET_HEIGHT))
    print("  bounds     : x [%.2f, %.2f]  y [%.2f, %.2f]  z [%.2f, %.2f]"
          % (min(p.x for p in pts), max(p.x for p in pts),
             min(p.y for p in pts), max(p.y for p in pts),
             min(p.z for p in pts), max(p.z for p in pts)))

    colors = sorted({a.name for o in meshes for a in o.data.color_attributes})
    print("  vertex col : %s" % (colors or "none"))

    landmarks(pts)

    # 三视图。横轴直接用 Blender 的 y，而 Cocos 的 +Z 就是 Blender 的 -y，
    # 所以图的**左边是头（Cocos +Z）**，右边是尾。读坐标时记得取反：
    # Cocos z = -(图上的 y)。
    silhouette(pts, "y", "z", "SIDE VIEW  (head/+Z on the LEFT, Cocos z = -y)")
    silhouette(pts, "x", "z", "FRONT VIEW (Cocos x = x, Cocos y = z)")
    silhouette(pts, "y", "x", "TOP VIEW   (head/+Z on the LEFT)")

    if args.out:
        out = os.path.abspath(args.out)
        os.makedirs(os.path.dirname(out), exist_ok=True)
        bpy.ops.object.select_all(action="SELECT")
        bpy.ops.export_scene.gltf(
            filepath=out, export_format="GLB", use_selection=True,
            export_yup=True, export_skins=False, export_animations=False,
            export_apply=True)
        print("\n  normalized : %s" % out)

    print("\nSOURCE_OK")


if __name__ == "__main__":
    main()
