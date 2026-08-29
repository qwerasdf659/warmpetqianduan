"""量出融合之后吻部前表面到底在哪。

渲图里鼻子和嘴读成一团污渍，怀疑它们埋在吻部球体里——`species._face` 的注释
早写过这条坑（「z 必须落在吻部**表面**上」），但头部改成 Q 版大球之后
吻部整个挪了位置，鼻嘴的 z 没跟着改。

不能再凭「鼻子下面一点」估：体素重构 + 4 次平滑会把表面往里收，
收多少算不出来，只能量。

坐标换算：建模时 to_blender 把 Cocos (x, y, z) 映射成 (x, -z, y)，
glTF 导出导入是可逆的，所以量到的 Blender 坐标反推 Cocos 是
y_cocos = z_blender，z_cocos = -y_blender。
"""

import os

import bpy


def cocos(v):
    return (v.x, v.z, -v.y)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.abspath("temp/eye/pet_cat.glb"))
    body = bpy.data.objects["part_body"]

    # 只看脸中线一带，按 Cocos y 分层报告最前表面
    for lo, hi in [(1.32, 1.40), (1.26, 1.32), (1.20, 1.26),
                   (1.14, 1.20), (1.08, 1.14)]:
        front = None
        for vert in body.data.vertices:
            x, y, z = cocos(body.matrix_world @ vert.co)
            if abs(x) < 0.06 and lo <= y < hi:
                if front is None or z > front:
                    front = z
        print("cocos y in [%.2f, %.2f) : front z = %s"
              % (lo, hi, "%.3f" % front if front is not None else "no vertex"))

    print()
    print("现在鼻子在 z=0.680（半轴 z 0.037 → 最前 0.717）")
    print("现在嘴在   z=0.655（半径 0.022 → 最前 0.677）")


main()
