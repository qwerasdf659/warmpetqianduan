"""一次性诊断：描边壳到底被推到了多大。

预览图里描边壳变成了一件盖住半只猫的大斗篷，而设定的外扩量只有 0.03 单位。
先量出壳和本体各自的包围盒，再决定是位移量的问题还是空间的问题。
"""

import os
import sys

import bpy

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tools"))
import render_preview  # noqa: E402


def dims(obj):
    box = [obj.matrix_world @ v.co for v in obj.data.vertices]
    lo = [min(p[i] for p in box) for i in range(3)]
    hi = [max(p[i] for p in box) for i in range(3)]
    return lo, hi


def main():
    render_preview.reset()
    bpy.ops.import_scene.gltf(
        filepath=os.path.abspath("temp/eye/pet_cat.glb"))

    line_mat = render_preview.make_outline_material()
    for obj in [o for o in bpy.data.objects if o.type == "MESH"]:
        lo, hi = dims(obj)
        print("BODY  %-12s scale=%s" % (obj.name, tuple(round(s, 4) for s in obj.scale)))
        print("      lo=%s hi=%s" % (tuple(round(v, 3) for v in lo),
                                     tuple(round(v, 3) for v in hi)))
        shell = render_preview.add_outline(obj, line_mat)
        # 位移是修改器算的，要看结果得取求值后的网格
        evaluated = shell.evaluated_get(bpy.context.evaluated_depsgraph_get())
        box = [shell.matrix_world @ v.co for v in evaluated.data.vertices]
        lo2 = [min(p[i] for p in box) for i in range(3)]
        hi2 = [max(p[i] for p in box) for i in range(3)]
        print("SHELL %-12s lo=%s hi=%s" % (shell.name,
                                           tuple(round(v, 3) for v in lo2),
                                           tuple(round(v, 3) for v in hi2)))
        grow = max(abs(hi2[i] - hi[i]) for i in range(3))
        print("      grow=%.4f (expected %.4f)" % (grow, render_preview.TOON["line_width"]))


main()
