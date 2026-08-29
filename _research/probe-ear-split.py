"""扫耳朵切分阈值，找出能整块切下耳朵、又不带走颅骨的区间。

为什么要扫而不是试一个数：`build_pet_from_source.split_ears` 的判据是
「够高 + 够偏」，两个界互相牵制——侧向界给紧了会把耳朵竖着劈一半
（实测 |x|>0.12 只切下 122 面，源网格的耳朵有 340 面，剩下 218 面留在
身体上，渲出来是头顶一块橙色碎片）；给松了会把颅骨顶那圈一起带走，
藏耳时头顶破洞。

判据不能靠看渲图，要看数：**切下来的面数应当等于源网格里耳朵的真实面数**。
这个测试用例恰好知道真值（340），所以能定标。

用法：
  blender --background --factory-startup -noaudio \
      --python _research/probe-ear-split.py -- \
      --file temp/dryrun/qchibi_normalized.glb --expect 340
"""

import os
import sys
import argparse

import bpy

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                "..", "tools"))
import rig_spec  # noqa: E402


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", required=True)
    ap.add_argument("--expect", type=int, default=0,
                    help="源网格里耳朵的真实三角面数，用来定标")
    args = ap.parse_args(argv)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(args.file))

    objs = [o for o in bpy.data.objects if o.type == "MESH"]
    tris = []
    for obj in objs:
        mw = obj.matrix_world
        obj.data.calc_loop_triangles()
        for t in obj.data.loop_triangles:
            tris.append([mw @ obj.data.vertices[i].co for i in t.vertices])
    print("source: %s  objects=%s  tris=%d"
          % (args.file, [o.name for o in objs], len(tris)))

    ear_root = rig_spec.HEAD_OF["ear_L"]
    min_z = rig_spec.HEAD_OF["tail_01"][2]
    print("ear_L root = %s   tail_01 z = %+.2f" % (ear_root, min_z))
    print("\n  margin  x_frac  min_y  min|x|   ear_tris   delta_vs_expect")

    for margin in (0.00, 0.02, 0.06, 0.12):
        for x_frac in (0.0, 0.15, 0.30, 0.45, 0.60):
            min_y = ear_root[1] - margin
            min_x = abs(ear_root[0]) * x_frac
            n = 0
            for verts in tris:
                # Blender: z 是上（Cocos y），-y 是前（Cocos z），x 同 x
                if all(v.z > min_y and abs(v.x) > min_x and -v.y > min_z
                       for v in verts):
                    n += 1
            delta = ("%+d" % (n - args.expect)) if args.expect else "-"
            print("  %6.2f  %6.2f  %5.2f  %6.2f   %8d   %s"
                  % (margin, x_frac, min_y, min_x, n, delta))

    print("\nPROBE_OK")


if __name__ == "__main__":
    main()
