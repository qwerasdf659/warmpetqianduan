"""按 docs/06 第七节的配饰规范建占位配饰，导出 GLB。

配饰是刚体挂载，不带骨骼。关键约束是原点和朝向：
原点放在与挂点的接触面中心，+Y 朝外（远离身体），+Z 朝前。
按这个建，导入后直接挂上就位置正确，前端不需要逐件调偏移。

用法：
  blender --background --factory-startup -noaudio --python-exit-code 1 \
      --python tools/build_accessory.py -- --out assets-src/accessory --item acc_cap
"""

import os
import sys
import argparse

import bpy
import bmesh

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rig_spec  # noqa: E402

# 与 build_skeleton 一致：文档用 Cocos 坐标（Y 上、Z 前），Blender 是 Z 上、-Y 前。
def to_blender(p):
    x, y, z = p
    return (x, -z, y)


ITEMS = {
    "acc_cap": {"slot": "hat", "color": (0.325, 0.478, 0.647, 1.0)},   # #5379A5
    "acc_scarf": {"slot": "neck", "color": (0.847, 0.369, 0.314, 1.0)},  # #D85E50
}


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = "METRIC"
    bpy.context.scene.unit_settings.scale_length = 1.0


def make_material(name, color):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = 0.9
    bsdf.inputs["Metallic"].default_value = 0.0
    return mat


def cut_below(obj, axis_index, threshold):
    """切掉某个轴向阈值以下的部分，用来把整球削成半球。"""
    mesh = obj.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    doomed = [v for v in bm.verts if v.co[axis_index] < threshold]
    bmesh.ops.delete(bm, geom=doomed, context="VERTS")
    bm.to_mesh(mesh)
    bm.free()


def build_cap():
    """棒球帽：半球帽身 + 前伸帽檐。帽身底面贴在 socket_hat 上，所以底面在 y=0。"""
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=6, radius=1.0)
    dome = bpy.context.active_object
    dome.scale = (0.24, 0.24, 0.20)
    bpy.ops.object.transform_apply(scale=True)
    cut_below(dome, 2, -0.001)

    bpy.ops.mesh.primitive_cube_add(size=1.0)
    brim = bpy.context.active_object
    brim.scale = (0.30, 0.26, 0.035)
    brim.location = to_blender((0.0, 0.03, 0.22))
    bpy.ops.object.transform_apply(location=True, scale=True)

    bpy.ops.object.select_all(action="DESELECT")
    dome.select_set(True)
    brim.select_set(True)
    bpy.context.view_layer.objects.active = dome
    bpy.ops.object.join()
    obj = bpy.context.active_object

    # 图元自带的 UV 各自铺满 0-1，join 之后球和盒子的 UV 完全叠在一起。
    # 现在没贴图看不出问题，等 §7 要求的 256² 配饰贴图一上就会互相覆盖。
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.02)
    bpy.ops.object.mode_set(mode="OBJECT")
    return obj


BUILDERS = {"acc_cap": build_cap}


def export_glb(path):
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_skins=False,
        export_animations=False,
        export_apply=True,
    )


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--item", required=True, choices=sorted(BUILDERS))
    args = ap.parse_args(argv)

    reset_scene()
    obj = BUILDERS[args.item]()
    obj.name = args.item
    obj.data.name = args.item
    obj.data.materials.clear()
    obj.data.materials.append(make_material(args.item, ITEMS[args.item]["color"]))

    obj.data.calc_loop_triangles()
    tris = len(obj.data.loop_triangles)
    budget = rig_spec.TRI_BUDGET["accessory"]
    if tris > budget:
        raise RuntimeError("%s has %d tris, budget is %d" % (args.item, tris, budget))

    os.makedirs(args.out, exist_ok=True)
    path = os.path.join(args.out, args.item + ".glb")
    export_glb(path)

    print("BUILD_OK")
    print("  item     : %s (slot=%s)" % (args.item, ITEMS[args.item]["slot"]))
    print("  tris     : %d / %d" % (tris, budget))
    print("  exported : %s" % path)


if __name__ == "__main__":
    main()
