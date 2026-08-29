"""量眼球在 512² 贴图上到底拿到多少像素，以及被切成了几块。

星形高光在游戏里边缘发虚，怀疑是 UV 分辨率不够。烘出来的 basecolor 图上
能数出七八颗完整的星星，而眼球只有两颗——所以要么眼球被切碎、每块都恰好
带一颗星（不可能），要么贴花落到了别的几何上。两种情况的修法完全不同，
不能靠看缩略图判断。

按 UV 连通性分岛，逐岛报告面数、包围盒和折合像素。
"""

import os
import sys
from collections import defaultdict

import bpy


def islands(mesh, face_ids):
    """按「共享 UV 顶点」把面分组。"""
    uv = mesh.uv_layers.active.data
    key_of = {}
    parent = {}

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    for fid in face_ids:
        parent[fid] = fid
    for fid in face_ids:
        poly = mesh.polygons[fid]
        for li in poly.loop_indices:
            k = (round(uv[li].uv.x, 5), round(uv[li].uv.y, 5))
            if k in key_of:
                union(fid, key_of[k])
            else:
                key_of[k] = fid

    groups = defaultdict(list)
    for fid in face_ids:
        groups[find(fid)].append(fid)
    return list(groups.values())


def main():
    size = 512
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.abspath("assets-src/pet/pet_cat.glb"))
    body = bpy.data.objects["part_body"]
    mesh = body.data
    uv = mesh.uv_layers.active.data

    slots = {i for i, m in enumerate(mesh.materials)
             if m and m.name.startswith("pet_detail")}
    print("pet_detail material slots: %s of %s"
          % (sorted(slots), [m.name for m in mesh.materials]))

    detail = [p.index for p in mesh.polygons if p.material_index in slots]
    print("pet_detail faces: %d / %d" % (len(detail), len(mesh.polygons)))

    # 眼球中心（Cocos）→ 导入后的 Blender 坐标是 (x, -z, y)
    eyes = [(0.175, 1.40, 0.56), (-0.175, 1.40, 0.56)]
    eye_bl = [(x, -z, y) for x, y, z in eyes]
    radius = 0.165

    def near_eye(fid):
        poly = mesh.polygons[fid]
        c = poly.center
        return min(((c.x - e[0]) ** 2 + (c.y - e[1]) ** 2
                    + (c.z - e[2]) ** 2) ** 0.5 for e in eye_bl)

    print()
    for group in sorted(islands(mesh, detail), key=len, reverse=True):
        us = [uv[li].uv for f in group for li in mesh.polygons[f].loop_indices]
        w = (max(p.x for p in us) - min(p.x for p in us)) * size
        h = (max(p.y for p in us) - min(p.y for p in us)) * size
        d = min(near_eye(f) for f in group) / radius
        print("island faces=%-4d  %5.1f x %5.1f px   nearest-eye=%.2f R  %s"
              % (len(group), w, h, d, "EYE" if d < 1.15 else "not eye"))


main()
