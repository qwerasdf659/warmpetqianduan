"""按游戏里的相机与灯光渲染一张预览图。

改完模型不用每次都劳烦别人刷新浏览器再截图——用和 docs/06 §3.4 完全一致的
相机、主光、环境光渲染一张，看到的就是游戏里的样子。

用法：
  blender --background --factory-startup -noaudio --python-exit-code 1 \
      --python tools/render_preview.py -- --file assets-src/pet/pet_dog.glb \
      --out temp/preview.png
"""

import os
import sys
import math
import argparse

import bpy
from mathutils import Euler

# 全部照抄 docs/06 §3.4，改那边就要改这里
CAM = {"y": 1.75, "z": 5.4, "pitch": -9.0, "fov": 38.0}
KEY_LIGHT_EULER = (-52.0, -35.0, 0.0)
KEY_COLOR = (1.0, 0.973, 0.925)
BG_COLOR = (0.949, 0.894, 0.816, 1.0)  # #F2E4D0
GROUND_COLOR = (0.788, 0.682, 0.545, 1.0)  # #C9AE8B


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def setup_camera(width, height):
    scene = bpy.context.scene
    cam_data = bpy.data.cameras.new("Camera3D")
    cam_data.lens_unit = "FOV"
    # Blender 的 FOV 按较长边算，竖构图下较长边是高，正好对上 Cocos 的垂直 FOV
    cam_data.sensor_fit = "VERTICAL"
    cam_data.angle = math.radians(CAM["fov"])

    cam = bpy.data.objects.new("Camera3D", cam_data)
    bpy.context.collection.objects.link(cam)
    # Blender 相机默认看向 -Z，绕 X 转 90° 才是水平看向 -Y（= Cocos 的 -Z）
    cam.location = (0.0, -CAM["z"], CAM["y"])
    cam.rotation_euler = Euler((math.radians(90 + CAM["pitch"]), 0.0, 0.0), "XYZ")
    scene.camera = cam

    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.film_transparent = False


def setup_light():
    light_data = bpy.data.lights.new("KeyLight", type="SUN")
    # 太强会把 #D9BE96 这种浅毛色直接曝成白色，看不出真实配色
    light_data.energy = 2.2
    light_data.color = KEY_COLOR
    light = bpy.data.objects.new("KeyLight", light_data)
    bpy.context.collection.objects.link(light)
    # 游戏里主光是「从左上前方打」，欧拉角照抄，只做坐标系换算
    ex, ey, ez = KEY_LIGHT_EULER
    light.rotation_euler = Euler(
        (math.radians(90 + ex), math.radians(ez), math.radians(ey)), "XYZ")

    world = bpy.data.worlds.new("World")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = BG_COLOR
    # 环境光压低，暗面才不会被填平（§3.4 的两条光照要点之一）
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.35
    bpy.context.scene.world = world


def add_ground():
    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=2.3, depth=0.14)
    obj = bpy.context.active_object
    obj.location = (0.0, 0.0, -0.07)
    mat = bpy.data.materials.new("ground")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = GROUND_COLOR
    bsdf.inputs["Roughness"].default_value = 0.9
    obj.data.materials.append(mat)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--width", type=int, default=540)
    ap.add_argument("--height", type=int, default=720)
    ap.add_argument("--frame", type=int, default=0, help="播放到动画的第几帧")
    args = ap.parse_args(argv)

    reset()
    bpy.ops.import_scene.gltf(filepath=args.file)

    if args.frame:
        bpy.context.scene.frame_set(args.frame)

    setup_camera(args.width, args.height)
    setup_light()
    add_ground()

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = os.path.abspath(args.out)
    bpy.ops.render.render(write_still=True)

    print("RENDER_OK %s" % scene.render.filepath)


if __name__ == "__main__":
    main()
