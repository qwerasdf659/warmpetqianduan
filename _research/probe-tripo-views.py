"""把 FBX 渲成正交三视图,一眼看清比例和姿态。只读,不改文件。"""

import os
import sys
import math

import bpy
from mathutils import Vector


def frame_all(cam_obj, ortho_axis, lo, hi):
    center = Vector([(lo[i] + hi[i]) * 0.5 for i in range(3)])
    size = [hi[i] - lo[i] for i in range(3)]
    dist = max(size) * 2.0
    cam = cam_obj.data
    cam.type = "ORTHO"
    cam.ortho_scale = max(size) * 1.2

    if ortho_axis == "front":     # 看向 -Y
        cam_obj.location = center + Vector((0, -dist, 0))
        cam_obj.rotation_euler = (math.radians(90), 0, 0)
    elif ortho_axis == "side":    # 看向 -X
        cam_obj.location = center + Vector((dist, 0, 0))
        cam_obj.rotation_euler = (math.radians(90), 0, math.radians(90))
    else:                          # top 看向 -Z
        cam_obj.location = center + Vector((0, 0, dist))
        cam_obj.rotation_euler = (0, 0, 0)


def main():
    path = sys.argv[sys.argv.index("--") + 1]
    out = sys.argv[sys.argv.index("--") + 2]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=os.path.abspath(path))

    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    verts = [o.matrix_world @ v.co for o in meshes for v in o.data.vertices]
    lo = [min(p[i] for p in verts) for i in range(3)]
    hi = [max(p[i] for p in verts) for i in range(3)]

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.film_transparent = False
    world = bpy.data.worlds.new("W")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[1].default_value = 1.0
    scene.world = world

    cam_data = bpy.data.cameras.new("C")
    cam = bpy.data.objects.new("C", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam

    scene.render.resolution_x = 360
    scene.render.resolution_y = 480
    for view in ("front", "side"):
        frame_all(cam, view, lo, hi)
        scene.render.filepath = os.path.abspath(out.replace(".png", "_%s.png" % view))
        bpy.ops.render.render(write_still=True)
        print("VIEW_OK %s" % scene.render.filepath)


main()
