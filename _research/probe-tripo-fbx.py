"""量一个 FBX 的头身比、面数、朝向——判断它是不是 Q 版比例。

只做测量,不改文件。判据:Q 版(方向 A)的头占总高约 55%,写实猫头占约 20%。
"""

import os
import sys

import bpy

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tools"))
import inspect_fbx  # noqa: E402  骨骼显示网格的判据


def main():
    path = sys.argv[sys.argv.index("--") + 1]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=os.path.abspath(path))

    shapes = inspect_fbx.bone_shape_meshes() if hasattr(inspect_fbx, "bone_shape_meshes") else set()
    meshes = [o for o in bpy.data.objects if o.type == "MESH" and o not in shapes]

    verts = []
    tris = 0
    for o in meshes:
        o.data.calc_loop_triangles()
        tris += len(o.data.loop_triangles)
        verts += [o.matrix_world @ v.co for v in o.data.vertices]

    if not verts:
        print("NO MESH")
        return

    xs = [p.x for p in verts]
    ys = [p.y for p in verts]
    zs = [p.z for p in verts]
    lo = (min(xs), min(ys), min(zs))
    hi = (max(xs), max(ys), max(zs))
    size = tuple(hi[i] - lo[i] for i in range(3))

    print("meshes     : %s" % [o.name for o in meshes])
    print("tris       : %d" % tris)
    print("verts      : %d" % len(verts))
    print("bbox size  : x=%.3f y=%.3f z=%.3f (Blender raw)" % size)
    up = max(range(3), key=lambda i: size[i])
    print("longest axis: %s (len %.3f)" % ("xyz"[up], size[up]))

    # 顶部 12% 的顶点数 —— Q 版大头这一带会很密（整个脑袋),写实猫只有耳尖
    axis = up
    span = size[axis]
    top_cut = hi[axis] - span * 0.12
    top_n = sum(1 for p in verts if p[axis] >= top_cut)
    print("top-12%% band: %d verts (%.1f%% of total)"
          % (top_n, 100.0 * top_n / len(verts)))

    # 材质/贴图
    mats = {m.name for o in meshes for m in o.data.materials if m}
    imgs = {img.name for img in bpy.data.images if img.filepath_raw or img.packed_file}
    print("materials  : %s" % sorted(mats))
    print("images     : %s" % sorted(imgs))

    # 骨架
    arms = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    for a in arms:
        print("armature   : %s  bones=%d" % (a.name, len(a.data.bones)))


main()
