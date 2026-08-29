"""查蒙皮会不会把网格撕开。

低多边形模型在硬边处顶点是**成对重复**的（这只猫 1188 顶点 / 594 面，
远高于共享顶点该有的比例）。这类网格有个特有的失效方式：一对本来重合的顶点，
如果被指派给了不同的骨骼，骨骼一动它们就分开，模型上出现裂缝——
看起来就是「被分割成一块一块的」。

`fill_unweighted` 按距离给无权重顶点刷 1.0 的硬权重，正是最容易造成这种
不一致的地方：重合的两个顶点距离两根骨骼几乎等距时，可能各归一根。

判据：找出静止姿态下重合的顶点对，在动画各帧算它们的距离。
静止时为 0，动起来还接近 0 就没裂；变大就是裂了，而且能报出多大。

用法：
  blender --background --factory-startup -noaudio \
      --python _research/probe-skin-cracks.py -- --file assets/resources/models/pet_cat.glb
"""

import sys
import argparse

import bpy

TOL = 1e-5
FRAMES = (0, 9, 18, 27, 36, 45, 54, 63, 72)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", required=True)
    args = ap.parse_args(argv)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 30
    bpy.ops.import_scene.gltf(filepath=args.file)

    arms = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    shapes = set()
    for a in arms:
        for pb in a.pose.bones:
            if pb.custom_shape:
                shapes.add(pb.custom_shape)
    meshes = [o for o in bpy.data.objects if o.type == "MESH" and o not in shapes]

    depsgraph = bpy.context.evaluated_depsgraph_get()

    for obj in meshes:
        # 静止姿态下按坐标分组，找出重合的顶点对
        rest = {}
        for i, v in enumerate(obj.data.vertices):
            key = (round(v.co.x, 5), round(v.co.y, 5), round(v.co.z, 5))
            rest.setdefault(key, []).append(i)
        groups = [ids for ids in rest.values() if len(ids) > 1]
        pairs = sum(len(ids) - 1 for ids in groups)
        print("\n%s: %d verts, %d coincident groups (%d redundant)"
              % (obj.name, len(obj.data.vertices), len(groups), pairs))
        if not groups:
            continue

        for frame in FRAMES:
            bpy.context.scene.frame_set(frame)
            depsgraph = bpy.context.evaluated_depsgraph_get()
            evaluated = obj.evaluated_get(depsgraph)
            mesh = evaluated.to_mesh()

            worst = 0.0
            worst_at = None
            for ids in groups:
                pts = [mesh.vertices[i].co for i in ids]
                for a in range(len(pts)):
                    for b in range(a + 1, len(pts)):
                        d = (pts[a] - pts[b]).length
                        if d > worst:
                            worst = d
                            worst_at = tuple(pts[a])
            evaluated.to_mesh_clear()

            flag = "  <-- CRACK" if worst > 0.01 else ""
            print("  frame %-3d max gap = %.4f%s   at %s"
                  % (frame, worst, flag,
                     "(%.2f, %.2f, %.2f)" % worst_at if worst_at else "-"))


if __name__ == "__main__":
    main()
