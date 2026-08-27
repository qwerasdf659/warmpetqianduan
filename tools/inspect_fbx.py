"""检查任意 FBX / GLB 是否满足 docs/06 的骨架与网格契约。

对我们自己导出的文件是回归测试；对 Meshy、Tripo 这类外部产出，
它回答三个决定性问题：骨骼多少根、命名是什么规范、耳朵和颈部能不能单独隐藏。

用法：
  blender --background --factory-startup -noaudio --python-exit-code 1 \
      --python tools/inspect_fbx.py -- --file path/to/model.fbx

输出全部为 ASCII，避免 Windows 控制台的编码问题。
退出码 0 = 全部通过，1 = 有 FAIL 项。
"""

import os
import sys
import argparse

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rig_spec  # noqa: E402

failures = []


def check(passed, label, detail=""):
    mark = "PASS" if passed else "FAIL"
    print("  [%s] %s%s" % (mark, label, (" -- " + detail) if detail else ""))
    if not passed:
        failures.append(label)


def load(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    # glTF 的关键帧时间以秒记录，导入时按当前场景帧率重新采样。
    # 不先对齐帧率的话，量出来的是导入方的帧率，和创作时的无关。
    bpy.context.scene.render.fps = rig_spec.ANIM_FPS
    ext = os.path.splitext(path)[1].lower()
    if ext == ".fbx":
        bpy.ops.import_scene.fbx(filepath=path)
    elif ext in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=path)
    else:
        raise SystemExit("unsupported extension: %s" % ext)


def bone_shape_objects(armatures):
    """导入器会为骨骼生成显示用的网格（glTF 导入器造的 Icosphere 就是），
    这些不属于模型资产，统计面数和部件时必须排除。"""
    shapes = set()
    for arm in armatures:
        for pb in arm.pose.bones:
            if pb.custom_shape:
                shapes.add(pb.custom_shape)
    return shapes


def print_tree(armature):
    bones = armature.data.bones
    roots = [b for b in bones if b.parent is None]

    def walk(bone, depth, index):
        print("    %-3d %s%s%s" % (
            index[0], "  " * depth, bone.name,
            "" if bone.use_deform else "   (no deform)"))
        index[0] += 1
        for child in sorted(bone.children, key=lambda c: c.name):
            walk(child, depth + 1, index)

    index = [1]
    for r in roots:
        walk(r, 0, index)


def inspect_armature(armature):
    bones = armature.data.bones
    names = [b.name for b in bones]

    print("\nSKELETON: %s" % armature.name)
    print("  bone count : %d" % len(bones))
    print("  hierarchy  :")
    print_tree(armature)

    print("\nSKELETON CHECKS")
    check(len(bones) <= rig_spec.MAX_JOINTS,
          "bone count within Cocos uniform limit (%d)" % rig_spec.MAX_JOINTS,
          "found %d" % len(bones))

    bad = [(n, rig_spec.check_name(n)) for n in names if rig_spec.check_name(n)]
    check(not bad, "bone names follow naming convention",
          "; ".join("%s: %s" % (n, r) for n, r in bad[:5]))

    leaf = [n for n in names if n.endswith("_end") or n.endswith("_END")]
    check(not leaf, "no leaf bones (add_leaf_bones must be False)",
          "found %s" % leaf[:5])

    missing, extra = rig_spec.diff_against_spec(names)
    check(not missing and not extra, "matches rig_spec exactly",
          "missing=%s extra=%s" % (missing[:6], extra[:6]))

    present = [n for n in rig_spec.SOCKET_BONES if n in names]
    check(len(present) == len(rig_spec.SOCKET_BONES),
          "socket bones present", "found %s" % present)

    return names


def inspect_meshes(meshes, kind):
    limits = rig_spec.PART_LIMITS[kind]
    print("\nMESHES")
    total_tris = 0
    for obj in meshes:
        mesh = obj.data
        mesh.calc_loop_triangles()
        tris = len(mesh.loop_triangles)
        total_tris += tris
        uv_layers = [uv.name for uv in mesh.uv_layers]
        print("  %-14s tris=%-6d materials=%-2d uv_layers=%s"
              % (obj.name, tris, len(mesh.materials), uv_layers or "NONE"))

    print("\nMESH CHECKS")
    check(total_tris <= rig_spec.TRI_BUDGET[kind],
          "total triangles within %s budget (%d)" % (kind, rig_spec.TRI_BUDGET[kind]),
          "found %d" % total_tris)

    check(len(meshes) <= limits["submeshes"],
          "submesh count within budget (%d)" % limits["submeshes"],
          "found %d" % len(meshes))

    materials = {m.name for o in meshes for m in o.data.materials if m}
    check(materials, "meshes have materials assigned",
          "" if materials else "engine will render magenta placeholder")
    check(len(materials) <= limits["materials"],
          "material count within budget (%d)" % limits["materials"],
          "found %d: %s" % (len(materials), sorted(materials)))

    names = [o.name for o in meshes]
    for part in limits["required"]:
        check(part in names, "separate mesh node '%s' exists" % part,
              "" if part in names else "occlusion rule 5.5 cannot work without it")

    # 只查「不超过一套」会漏掉一套都没有的情况——体素重构就会把 UV 抹掉，
    # 而没有 UV 的网格根本没法贴图，属于交付不合格。
    bad_uv = [
        "%s(%d)" % (o.name, len(o.data.uv_layers))
        for o in meshes
        if len(o.data.uv_layers) != 1
    ]
    check(not bad_uv, "exactly one UV set per mesh", "found %s" % bad_uv)

    # socket 骨骼上挂了权重，配饰会跟着网格变形，等于挂点失效。
    leaked = []
    for obj in meshes:
        socket_groups = [g for g in obj.vertex_groups if g.name.startswith("socket_")]
        for g in socket_groups:
            for v in obj.data.vertices:
                if any(ge.group == g.index and ge.weight > 0.0 for ge in v.groups):
                    leaked.append("%s/%s" % (obj.name, g.name))
                    break
    check(not leaked, "socket bones carry zero skin weights", "leaked on %s" % leaked)

    over4 = []
    for obj in meshes:
        gi = {g.index for g in obj.vertex_groups}
        for v in obj.data.vertices:
            if sum(1 for ge in v.groups if ge.group in gi and ge.weight > 0) > 4:
                over4.append(obj.name)
                break
    check(not over4, "at most 4 bone influences per vertex", "exceeded on %s" % over4)


def _is_pow2(n):
    return n > 0 and (n & (n - 1)) == 0


def inspect_textures(meshes, kind):
    """贴图规格（§5.8）。PVRTC 要求正方形且为 2 的幂，不满足会被强行拉到
    更大的正方形，体积反而暴涨。"""
    limit = rig_spec.TEX_SIZE[kind]
    images = {}
    for obj in meshes:
        for mat in obj.data.materials:
            if not mat or not mat.use_nodes:
                continue
            for node in mat.node_tree.nodes:
                if node.type == "TEX_IMAGE" and node.image:
                    images[node.image.name] = node.image

    print("\nTEXTURES")
    if not images:
        print("  (none -- flat colour materials only)")
        return
    for name, img in sorted(images.items()):
        print("  %-30s %dx%d  %s" % (name, img.size[0], img.size[1],
                                     img.colorspace_settings.name))

    print("\nTEXTURE CHECKS")
    bad = ["%s(%dx%d)" % (n, i.size[0], i.size[1]) for n, i in sorted(images.items())
           if i.size[0] != i.size[1] or not _is_pow2(i.size[0])]
    check(not bad, "textures are square powers of two", "found %s" % bad)

    over = ["%s(%d)" % (n, i.size[0]) for n, i in sorted(images.items())
            if i.size[0] > limit]
    check(not over, "textures within %s budget (%d)" % (kind, limit),
          "found %s" % over)


GRID = 256


def _inside(px, py, a, b, c):
    denom = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
    if abs(denom) < 1e-12:
        return False
    w0 = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (py - c[1])) / denom
    w1 = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (py - c[1])) / denom
    return w0 >= 0.0 and w1 >= 0.0 and (w0 + w1) <= 1.0


def _uv_coverage(obj):
    """把每个材质槽的 UV 三角形栅格化，返回 {材质名: {格子: 命中次数}} 和越界标记。

    栅格化而不是只看包围盒，是因为「UV 不重叠」这条要判的是实际覆盖面积——
    两组 UV 壳的包围盒几乎必然相交，但islands 之间留着边距就不算重叠。
    """
    mesh = obj.data
    if not mesh.uv_layers:
        return {}, False
    mesh.calc_loop_triangles()
    uvs = mesh.uv_layers[0].data

    coverage = {}
    out_of_range = False
    for tri in mesh.loop_triangles:
        pts = [tuple(uvs[li].uv) for li in tri.loops]
        for u, v in pts:
            if u < -1e-4 or u > 1.0001 or v < -1e-4 or v > 1.0001:
                out_of_range = True

        slot = tri.material_index
        mat = mesh.materials[slot] if slot < len(mesh.materials) else None
        key = mat.name if mat else "<none>"
        cells = coverage.setdefault(key, {})

        us = [p[0] for p in pts]
        vs = [p[1] for p in pts]
        x0 = max(0, int(min(us) * GRID)); x1 = min(GRID - 1, int(max(us) * GRID))
        y0 = max(0, int(min(vs) * GRID)); y1 = min(GRID - 1, int(max(vs) * GRID))
        for ix in range(x0, x1 + 1):
            px = (ix + 0.5) / GRID
            for iy in range(y0, y1 + 1):
                py = (iy + 0.5) / GRID
                if _inside(px, py, pts[0], pts[1], pts[2]):
                    cells[(ix, iy)] = cells.get((ix, iy), 0) + 1

    return coverage, out_of_range


def inspect_uv_layout(meshes):
    """UV 必须在 0-1 内，且共用同一材质的网格之间不能重叠（§5.8）。

    重叠这条对我们尤其致命：三个部件共用一个材质球，也就共用一张贴图。
    UV 叠在一起时烘焙会互相覆盖，耳朵上会印出一块肚子的颜色。
    """
    print("\nUV CHECKS")
    per_obj = {}
    out_of_range = []
    for obj in meshes:
        coverage, bad = _uv_coverage(obj)
        per_obj[obj.name] = coverage
        if bad:
            out_of_range.append(obj.name)

    check(not out_of_range, "all UVs inside 0-1", "outside on %s" % out_of_range)

    # 允许极少量误报：格子中心正好落在两个相邻三角形的公共边上会被数两次
    tolerance = 0.005

    self_overlap = []
    for name, coverage in per_obj.items():
        for mat_name, cells in coverage.items():
            if not cells:
                continue
            doubled = sum(1 for c in cells.values() if c > 1)
            if doubled > len(cells) * tolerance:
                self_overlap.append("%s/%s %d/%d" % (name, mat_name, doubled, len(cells)))
    check(not self_overlap, "no UV shells overlap within a mesh (no mirrored UVs)",
          "found %s" % self_overlap)

    by_material = {}
    for name, coverage in per_obj.items():
        for mat_name, cells in coverage.items():
            by_material.setdefault(mat_name, []).append((name, set(cells)))

    cross = []
    for mat_name, entries in sorted(by_material.items()):
        for i in range(len(entries)):
            for j in range(i + 1, len(entries)):
                (na, ca), (nb, cb) = entries[i], entries[j]
                shared = ca & cb
                smaller = min(len(ca), len(cb)) or 1
                if len(shared) > smaller * tolerance:
                    cross.append("%s: %s^%s %d cells" % (mat_name, na, nb, len(shared)))
    check(not cross, "meshes sharing a material do not overlap in UV space",
          "found %s" % cross)


def inspect_animations():
    actions = list(bpy.data.actions)
    print("\nANIMATIONS")
    if not actions:
        print("  (none)")
        return

    fps = bpy.context.scene.render.fps
    for action in actions:
        start, end = action.frame_range
        duration = (end - start) / fps if fps else 0
        print("  %-16s frames=%.0f..%.0f  %.2fs @ %dfps  curves=%d"
              % (action.name, start, end, duration, fps, len(action.fcurves)))

    print("\nANIMATION CHECKS")
    check(fps == rig_spec.ANIM_FPS, "authored at %d fps" % rig_spec.ANIM_FPS,
          "found %d" % fps)

    for action in actions:
        spec = rig_spec.CLIP_SPEC.get(action.name)
        if not spec:
            check(False, "clip '%s' is in the approved list" % action.name,
                  "not in docs 5.6 animation list")
            continue

        start, end = action.frame_range
        duration = (end - start) / fps if fps else 0
        lo, hi = spec["duration"]
        check(lo <= duration <= hi, "clip '%s' duration within %.1f-%.1fs" % (action.name, lo, hi),
              "found %.2fs" % duration)

        if spec["loop"]:
            # 首尾帧不一致的循环动画每圈都会跳一下，肉眼很难定位到是动画的问题。
            drift = []
            for fc in action.fcurves:
                a = fc.evaluate(start)
                b = fc.evaluate(end)
                if abs(a - b) > 1e-4:
                    drift.append("%s[%d] %.4f->%.4f" % (fc.data_path.split('"')[1]
                                                        if '"' in fc.data_path else fc.data_path,
                                                        fc.array_index, a, b))
            check(not drift, "clip '%s' loops seamlessly (first frame == last)" % action.name,
                  "%d curve(s) drift, e.g. %s" % (len(drift), drift[:3]))


def report_bounds(objs, kind):
    xs, ys, zs = [], [], []
    for o in objs:
        for corner in o.bound_box:
            wc = o.matrix_world @ Vector(corner)
            xs.append(wc.x); ys.append(wc.y); zs.append(wc.z)
    if not xs:
        return
    height = max(zs) - min(zs)
    print("\nBOUNDS (Blender space, Z is up)")
    print("  x [%.3f, %.3f]  y [%.3f, %.3f]  z [%.3f, %.3f]"
          % (min(xs), max(xs), min(ys), max(ys), min(zs), max(zs)))
    print("  height=%.3f  origin_at_feet=%s"
          % (height, "yes" if abs(min(zs)) < 0.02 else "NO (min z=%.3f)" % min(zs)))

    if kind == "pet":
        lo, hi = rig_spec.HEIGHT_RANGE
        check(lo <= height <= hi,
              "overall height within %.2f-%.2f (baseline %.1f)"
              % (lo, hi, rig_spec.TARGET_HEIGHT),
              "found %.3f" % height)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", required=True)
    ap.add_argument("--kind", default="pet", choices=sorted(rig_spec.PART_LIMITS),
                    help="按哪一类资源的预算校验，默认宠物")
    args = ap.parse_args(argv)

    print("=" * 68)
    print("INSPECT: %s  (kind=%s)" % (args.file, args.kind))
    print("=" * 68)
    load(args.file)

    armatures = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    meshes = [o for o in bpy.data.objects
              if o.type == "MESH" and o not in bone_shape_objects(armatures)]

    if not armatures:
        print("\nNo armature found -- this file is a static mesh.")
    for arm in armatures:
        bone_names = inspect_armature(arm)

    inspect_animations()

    if meshes:
        inspect_meshes(meshes, args.kind)
        inspect_textures(meshes, args.kind)
        inspect_uv_layout(meshes)
        report_bounds(meshes, args.kind)
    else:
        print("\nNo meshes in file (skeleton-only export).")

    print("\n" + "=" * 68)
    if failures:
        print("RESULT: %d CHECK(S) FAILED" % len(failures))
        for f in failures:
            print("  - %s" % f)
        sys.exit(1)
    print("RESULT: ALL CHECKS PASSED")


if __name__ == "__main__":
    main()
