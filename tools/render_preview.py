"""按游戏里的相机、灯光与**着色方式**渲染一张预览图。

改完模型不用每次都劳烦别人刷新浏览器再截图——看到的就是游戏里的样子。

## 默认是卡通着色，不是 PBR

宠物在游戏里的材质由 `PetStage.applyToonMaterial` 整个换成 `builtin-toon`，
模型自带的 PBR 参数一个都不生效。所以按 PBR 渲的预览图会在三件事上骗人，
每一件都已经误导过一轮判断：

1. **高光**。`tuneToon` 明确把 specular 设成 0，而 PBR 预览里眼球和鼻头
   各有一块白色镜面反射——迭代星形高光的位置时，那块反射会混进去。
2. **法线贴图**。`pet_toon` 只开了 `USE_BASE_COLOR_MAP`，法线贴图**根本没接**。
   PBR 预览里那层木纹质感在游戏里不存在。
3. **色阶和描边**。游戏里是三档平涂 + 反向壳描边，PBR 是连续渐变、没有描边。

所以这里不摆灯让 Blender 去算光照，而是**照抄 builtin-toon 的算式**：
半 Lambert 的 NL 两次 smoothstep 分出三档色调，乘上 BaseColor 贴图，
走 Emission 输出。参数逐个对齐 `PetStage.tuneToon`，改那边就要改这里。

`--shading pbr` 能切回原来的 PBR，看烘焙出来的贴图本身时有用。

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
from mathutils import Euler, Vector

# 全部照抄 docs/06 §3.4，改那边就要改这里
CAM = {"y": 1.75, "z": 5.4, "pitch": -9.0, "fov": 38.0}
KEY_LIGHT_EULER = (-52.0, -35.0, 0.0)
KEY_COLOR = (1.0, 0.973, 0.925)
BG_COLOR = (0.949, 0.894, 0.816, 1.0)  # #F2E4D0
GROUND_COLOR = (0.788, 0.682, 0.545, 1.0)  # #C9AE8B

# 逐项对齐 PetStage.tuneToon（assets/scripts/ui/PetStage.ts）。
# 颜色那边是 0-255 的 Color，这里换算成 0-1 的线性值由 _srgb 处理。
TOON = {
    "main":         "#FFFFFF",   # mainColor
    "shade_1":      "#D6C4AA",   # shadeColor1
    "shade_2":      "#B49E82",   # shadeColor2
    "base_step":    0.72,
    "base_feather": 0.06,
    "shade_step":   0.42,
    "shade_feather": 0.06,
    "outline":      "#4A3728",   # 描边色
    # 描边宽度是**模型空间单位**：shader 里 localPos += normal * lineWidth * 0.001。
    # PetStage 给的 lineWidth 是 30，所以外扩 0.030 个单位。
    "line_width":   30 * 0.001,
}


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
    return obj


def _srgb(hex_str):
    """十六进制 → 线性值。着色器里的颜色一律是线性的。"""
    def chan(c):
        c /= 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    h = hex_str.lstrip("#")
    return tuple(chan(int(h[i:i + 2], 16)) for i in (0, 2, 4))


def _light_dir():
    """主光照过来的方向（单位向量，指向光源）。

    太阳灯沿自己的局部 -Z 照射，所以「指向光源」是局部 +Z 转到世界空间。
    这里直接算，不去问 Blender 的灯——卡通着色不经过 Blender 的光照，
    NL 是我们自己点乘出来的。
    """
    ex, ey, ez = KEY_LIGHT_EULER
    euler = Euler((math.radians(90 + ex), math.radians(ez), math.radians(ey)), "XYZ")
    return euler.to_matrix() @ Vector((0.0, 0.0, 1.0))


def _plug(nt, socket, value):
    """value 可以是另一个节点的输出，也可以是个常量三元组。"""
    if isinstance(value, tuple):
        socket.default_value = value
    else:
        nt.links.new(value, socket)


def _lerp(nt, a, b, fac):
    """a + (b - a) * fac，用向量运算做。

    不用 Mix 节点：4.x 的 `ShaderNodeMix` 把三种数据类型的插槽塞在一个节点里，
    `inputs["Factor"]` 是重名的，只能按索引取，而索引在小版本之间动过。
    """
    diff = nt.nodes.new("ShaderNodeVectorMath")
    diff.operation = "SUBTRACT"
    _plug(nt, diff.inputs[0], b)
    _plug(nt, diff.inputs[1], a)

    scaled = nt.nodes.new("ShaderNodeVectorMath")
    scaled.operation = "SCALE"
    nt.links.new(diff.outputs["Vector"], scaled.inputs[0])
    nt.links.new(fac, scaled.inputs["Scale"])

    total = nt.nodes.new("ShaderNodeVectorMath")
    total.operation = "ADD"
    _plug(nt, total.inputs[0], a)
    nt.links.new(scaled.outputs["Vector"], total.inputs[1])
    return total.outputs["Vector"]


def _smoothstep(nt, value, center, feather):
    step = nt.nodes.new("ShaderNodeMapRange")
    step.interpolation_type = "SMOOTHSTEP"
    step.inputs["From Min"].default_value = center - feather
    step.inputs["From Max"].default_value = center + feather
    nt.links.new(value, step.inputs["Value"])
    return step.outputs["Result"]


def _base_color_image(mat):
    """找出材质里接在 Base Color 上的那张贴图。

    卡通着色只用得上它一张——法线贴图在 `pet_toon` 里没有接口，
    照着 PBR 预览去调毛流的凹凸强度是白费功夫。
    """
    if not mat or not mat.use_nodes:
        return None
    for node in mat.node_tree.nodes:
        if node.type != "BSDF_PRINCIPLED":
            continue
        link = next((l for l in mat.node_tree.links
                     if l.to_socket == node.inputs["Base Color"]), None)
        if link and link.from_node.type == "TEX_IMAGE":
            return link.from_node.image
    return None


def make_toon_material(mat):
    """照 builtin-toon 的算式重建材质：三档平涂 × BaseColor 贴图 → Emission。"""
    img = _base_color_image(mat)
    nt = mat.node_tree
    nt.nodes.clear()
    links = nt.links

    out = nt.nodes.new("ShaderNodeOutputMaterial")
    emit = nt.nodes.new("ShaderNodeEmission")
    emit.inputs["Strength"].default_value = 1.0
    links.new(emit.outputs["Emission"], out.inputs["Surface"])

    # 半 Lambert 的 NL：0.5 * dot(N, L) + 0.5。用它而不是 max(dot, 0)，
    # 背光面才不会一片死黑——这是 builtin-toon 的做法。
    dot = nt.nodes.new("ShaderNodeVectorMath")
    dot.operation = "DOT_PRODUCT"
    links.new(nt.nodes.new("ShaderNodeNewGeometry").outputs["Normal"], dot.inputs[0])
    dot.inputs[1].default_value = _light_dir()[:]

    nl = nt.nodes.new("ShaderNodeMath")
    nl.operation = "MULTIPLY_ADD"
    nl.inputs[1].default_value = 0.5
    nl.inputs[2].default_value = 0.5
    links.new(dot.outputs["Value"], nl.inputs[0])

    shade = _lerp(nt, _srgb(TOON["shade_2"]), _srgb(TOON["shade_1"]),
                  _smoothstep(nt, nl.outputs["Value"],
                              TOON["shade_step"], TOON["shade_feather"]))
    tone = _lerp(nt, shade, _srgb(TOON["main"]),
                 _smoothstep(nt, nl.outputs["Value"],
                             TOON["base_step"], TOON["base_feather"]))

    if img is None:
        links.new(tone, emit.inputs["Color"])
        return

    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    mul = nt.nodes.new("ShaderNodeVectorMath")
    mul.operation = "MULTIPLY"
    links.new(tex.outputs["Color"], mul.inputs[0])
    links.new(tone, mul.inputs[1])
    links.new(mul.outputs["Vector"], emit.inputs["Color"])


def add_outline(obj, mat):
    """反向壳描边：复制一层网格、沿法线外扩、翻转法线、开背面剔除。

    和引擎那个 pass 是同一个原理（`localPos += normal * lineWidth * 0.001`）。
    翻转法线之后，壳朝向镜头的那一半成了背面被剔掉，只剩背后那一半；
    它整体被本体挡住，唯独在剪影外露出一圈，那就是描边。

    外扩是**直接改顶点**，不用 Displace 修改器。修改器是渲染时才求值的，
    翻转法线写在前面就会让它照着翻过的法线往里缩——壳比本体还小，
    描边一根都看不见。顺序错误在包围盒上是 0.03 的差，肉眼分辨不出来。
    """
    shell = obj.copy()
    shell.data = obj.data.copy()
    shell.name = obj.name + "_outline"
    # 骨架修改器要去掉：壳不参与蒙皮，静止姿态下和本体是重合的
    shell.modifiers.clear()
    bpy.context.collection.objects.link(shell)

    # 外扩要用**逐角法线**，不是 `vert.normal`。引擎读的是 glTF 的 NORMAL 属性，
    # 而带自定义法线的网格（眼球那块被拍平了）导出时会按属性拆点，
    # 每个点带一个自定义法线；`vert.normal` 是几何平均值，和引擎看到的不是同一个东西。
    # 用错了预览就会给眼球画出一圈引擎里并不存在的描边。
    normal_of = {}
    for poly in shell.data.polygons:
        for li in poly.loop_indices:
            normal_of.setdefault(shell.data.loops[li].vertex_index,
                                 shell.data.corner_normals[li].vector.copy())

    width = TOON["line_width"]
    for vert in shell.data.vertices:
        vert.co += normal_of.get(vert.index, vert.normal) * width
    shell.data.flip_normals()

    shell.data.materials.clear()
    shell.data.materials.append(mat)
    return shell


def make_outline_material():
    mat = bpy.data.materials.new("outline")
    mat.use_nodes = True
    mat.use_backface_culling = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    emit = nt.nodes.new("ShaderNodeEmission")
    emit.inputs["Color"].default_value = _srgb(TOON["outline"]) + (1.0,)
    nt.links.new(emit.outputs["Emission"], out.inputs["Surface"])
    return mat


def _bone_shape_meshes():
    """glTF 导入器给每根骨骼造的显示用网格（`Icosphere`）。

    它们不在场景集合里，所以本体不会被渲染——但描边壳是新建对象、要显式
    link 进集合的，一不小心就把一个 2 单位大的球的描边壳挂进了画面：
    表现为半只猫被一件深色斗篷盖住，而且它离「描边」这个概念太远，
    完全想不到是同一段代码干的。
    """
    return {b.custom_shape for arm in bpy.data.objects if arm.type == "ARMATURE"
            for b in arm.pose.bones if b.custom_shape}


def apply_toon(skip):
    """把场景里所有网格换成卡通着色，并各加一层描边壳。"""
    skip = set(skip) | _bone_shape_meshes()
    meshes = [o for o in bpy.data.objects
              if o.type == "MESH" and o not in skip and o.name in bpy.context.scene.objects]
    for mat in {m for o in meshes for m in o.data.materials if m}:
        make_toon_material(mat)
    line_mat = make_outline_material()
    for obj in meshes:
        add_outline(obj, line_mat)
    return len(meshes)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--width", type=int, default=540)
    ap.add_argument("--height", type=int, default=720)
    ap.add_argument("--frame", type=int, default=0, help="播放到动画的第几帧")
    ap.add_argument("--shading", default="toon", choices=("toon", "pbr"),
                    help="toon=照抄 builtin-toon（默认，和游戏一致）"
                         "；pbr=模型自带材质，看烘焙出来的贴图本身时用")
    args = ap.parse_args(argv)

    reset()
    bpy.ops.import_scene.gltf(filepath=args.file)

    if args.frame:
        bpy.context.scene.frame_set(args.frame)

    setup_camera(args.width, args.height)
    setup_light()
    ground = add_ground()
    # 地台留在 PBR 下：它只是个舞台道具，不是要验收的资产，
    # 而且有点明暗过渡才能看出宠物站在一个面上。
    if args.shading == "toon":
        apply_toon(skip={ground})

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"

    # 必须是 Standard，不能用 Blender 默认的 AgX。
    #
    # AgX 会把高光平滑地滚降回来，Cocos 是直接截断。结果是**过曝在预览图里
    # 看不见、在游戏里是一片死白**——照着 AgX 的预览调模型，等于照着一个
    # 会自动救高光的目标调，调完搬进引擎全废。
    # 这个坑让「毛流、反荫蔽、分区色」在游戏里全被削平了一轮才发现。
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = os.path.abspath(args.out)
    bpy.ops.render.render(write_still=True)

    print("RENDER_OK %s" % scene.render.filepath)
    print("  shading : %s" % args.shading)


if __name__ == "__main__":
    main()
