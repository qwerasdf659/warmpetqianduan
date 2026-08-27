"""毛色贴图：在 3D 空间里生成纹理，再烘焙到 UV。

为什么不能让图像模型直接画贴图：它不知道 UV 布局上哪一块是耳朵、哪一块是肚子，
画出来的图贴上去必然错位。docs/06 §5.8 那条「10 张皮肤贴图自动生成不了」
说的就是这件事。

烘焙绕开了整个问题：颜色和毛流都在**三维空间里**定义——分区色按顶点位置和法线算，
毛流是物体坐标驱动的噪声——再由烘焙器投影到 UV 上。UV 怎么排都不影响结果，
连接缝都是连续的，因为图案本来就是三维的。

产出两张 512²（§5.8 的身体贴图规格）：

| 文件 | 内容 |
| --- | --- |
| `*_basecolor.jpg` | 分区毛色 + 毛流 + 斑驳，**不含任何光照** |
| `*_normal.png` | 毛流起伏，实时光照下才有绒毛感 |

§5.8 那条「不要把光照烘进贴图」严格遵守：basecolor 只烘 DIFFUSE 的 COLOR 通道，
直接光和间接光全关。腹浅背深是动物本身的色素分布（反荫蔽），不是光照。
"""

import os

import bpy

# 贴图尺寸和调色板都在 rig_spec / docs/06 §5.2 色卡里，改那边要一并改这里
import rig_spec

# 色卡（docs/06 §5.2）加两个派生档：背部压深、腹部提亮。
# 真实动物几乎都是反荫蔽配色，这条明度梯度比任何细节都更能让模型「不像塑料」。
PALETTE = {
    "fur":      "#D9BE96",  # 主毛色，定稿值
    "fur_dark": "#A5875C",  # 背部，主毛色压深两档
    "belly":    "#E7D5BD",  # 腹部，比主毛色浅一档
    "muzzle":   "#F0E4D2",  # 吻部 / 眉点 / 尾尖，最浅的一档
    "pad":      "#D99A97",  # 耳内 / 爪垫，唯一的冷调点缀
    "blush":    "#E3A49B",  # 腮红，比爪垫浅一点
    "glint":    "#FFFDF8",  # 眼高光
    # 眼睛两层：眼球是虹膜色，正面一小片瞳孔。整体仍落在色卡 #2E2119 那个
    # 深色档附近，只是有了结构——单一深色的眼球在两百像素上就是两个洞。
    "iris":     "#71482A",
    "pupil":    "#150F0B",
    "nose":     "#2E2119",  # 鼻、嘴，色卡定稿值
}

# 分区色块（浅吻部、眉点、浅尾尖、粉爪垫）按物种各写一份，在 species.py 里——
# 位置得跟着各自的吻部和尾巴走，狗的吻部比猫前伸得多。
# 每条是 (色名, 中心, 半径, 羽化, 强度, 法线门)，色名索引上面的 PALETTE。
# 法线门用来限制只染朝某个方向的面：爪垫只在脚底，不能爬到脚背上。

COLOR_ATTR = "fur"

# 毛流用照片派生的细节图（见 make_fur_detail.py），不用程序化噪声。
#
# 噪声这条路试过两轮才放弃：等向分形噪声振幅 0.13 渲出来像砂纸，压到 0.07
# 就完全看不见，中间没有「像毛」的档位——因为真实毛发的方向性和成缕结构
# 根本不是噪声的统计特征。
#
# 细节图按**物体坐标**做盒式投影，不走 UV。好处有两条：跨部件连续（耳朵和
# 头之间没有接缝），而且 UV 怎么排都不影响图案。平铺用 MIRROR，镜像边界
# 逐像素对齐，在毛发这种无规则纹理上看不出对称。
FUR_DETAIL = "assets-src/pet/tex/fur_detail.png"
# 投影尺度决定毛缕在贴图上有多宽，这个数是被贴图分辨率**逼出来的**，不是审美选择：
#
# 512² 摊到整只宠物约 2 m² 的表面，一个纹素折合现实里约 3 mm。比纹素更细的
# 结构存不进贴图——单采样时变成随机麻点，多采样时被平均成一片死板。
# 细节图上横向约 200 根毛，要让每根占到 3 个纹素以上，一片就得铺到 2 米宽。
#
# 所以 0.5：一片正好盖住整只宠物，既不重复也不出现平铺痕迹，毛缕落在 1 cm 量级，
# 读起来是成缕的绒毛而不是单根毛发。想看清单根毛得先把贴图提到 2K，
# 那和 §4.4 的包体预算冲突。
FUR_TILE = 0.5
# 明度起伏别给太重。毛缕的立体感要从法线贴图来——那是实时光照算出来的，
# 会随光照方向变化；画进 basecolor 的明暗是死的，光转过去了阴影还留在原地，
# 看上去就是木纹而不是毛。所以颜色只留一点色调变化，起伏交给法线。
FUR_AMOUNT = 0.15
MOTTLE_SCALE = 8.0      # 中尺度色斑，让大面积毛色不至于死板
MOTTLE_AMOUNT = 0.045
BUMP_STRENGTH = 1.0
# Distance 是高度的实际尺度（米）。细节图高通后的起伏只有 0.3 左右，
# 4 mm 换算下来坡度不到 7°，法线贴图几乎是一片纯蓝。毛缕宽约 1 cm，
# 高度给到 2 cm 量级才有能被光照读出来的坡度。
BUMP_DISTANCE = 0.02

BODY_ROUGHNESS = 0.9
# 眼睛和鼻子要有高光才「活」。§5.8 给毛发定的是 0.85–0.95，
# 那条针对毛面；湿鼻头和眼球本来就是全身唯一的反光点。
DETAIL_ROUGHNESS = 0.28


def _linear(c):
    """sRGB 十六进制是显示空间的值，顶点色和材质颜色都要线性值。"""
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def rgb(hex_str):
    h = hex_str.lstrip("#")
    return tuple(_linear(int(h[i:i + 2], 16) / 255.0) for i in (0, 2, 4))


def _mix(a, b, t):
    t = max(0.0, min(1.0, t))
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def _smoothstep(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3.0 - 2.0 * t)


def _blobs_in_blender(blobs, to_blender):
    out = []
    for color_key, center, radius, feather, strength, gate in blobs:
        out.append((rgb(PALETTE[color_key]), to_blender(center),
                    radius * rig_spec.RIG_SCALE, feather * rig_spec.RIG_SCALE,
                    strength, gate))
    return out


def _base_color(normal):
    """反荫蔽：按法线朝向在「腹浅 → 主毛色 → 背深」之间取色。

    用法线而不是高度，是因为它对四肢和头部同样成立——朝上的面一律压深，
    朝下的面一律提亮，不用为每个部位单独写规则。
    """
    t = (normal.z + 1.0) * 0.5
    if t < 0.5:
        return _mix(rgb(PALETTE["belly"]), rgb(PALETTE["fur"]), t / 0.5)
    return _mix(rgb(PALETTE["fur"]), rgb(PALETTE["fur_dark"]), (t - 0.5) / 0.5 * 0.8)


def _gate_weight(gate, normal):
    if gate is None:
        return 1.0
    if gate == "down":
        return max(0.0, -normal.z)
    if gate == "up":
        return max(0.0, normal.z)
    raise ValueError("unknown normal gate: %s" % gate)


def _detail_vertices(mesh):
    """找出属于五官（pet_detail 材质）的顶点。

    毛色规则不能套在眼球和鼻子上，否则眼睛会被涂成毛色。判据用面的材质槽而
    不是坐标：五官是 join 进身体的，材质分配逐面保留着，比按位置切一刀准。
    """
    slots = {i for i, m in enumerate(mesh.materials) if m and m.name == "pet_detail"}
    if not slots:
        return set()
    out = set()
    for poly in mesh.polygons:
        if poly.material_index in slots:
            out.update(poly.vertices)
    return out


def _feature_color(co, features):
    """五官顶点取「离得最近的那个中心」的颜色。

    中心就是各片几何自己的位置：瞳孔圆盘、虹膜圆盘、眼球、鼻、嘴各一个。
    形状由几何决定，这里只负责上色，所以不需要在着色器里算任何遮罩。
    """
    best = None
    best_d = None
    for color_key, center in features:
        d = (co - center).length
        if best_d is None or d < best_d:
            best, best_d = color_key, d
    return rgb(PALETTE[best])


def paint_vertex_colors(parts, blobs, features, to_blender):
    """把分区毛色和五官颜色写成顶点色，作为烘焙时 Base Color 的底。

    顶点色在两千面的网格上足够表达分区渐变，高频细节交给毛流细节图。
    好处是分区规则用 Python 写、可读可改，不用在着色器里堆一串遮罩节点。
    """
    blobs = _blobs_in_blender(blobs, to_blender)
    features = [(color_key, to_blender(center)) for color_key, center in features]
    pad = rgb(PALETTE["pad"])

    for obj in parts:
        mesh = obj.data
        for existing in list(mesh.color_attributes):
            mesh.color_attributes.remove(existing)
        attr = mesh.color_attributes.new(
            name=COLOR_ATTR, type="FLOAT_COLOR", domain="POINT")
        detail = _detail_vertices(mesh)

        for i, vert in enumerate(mesh.vertices):
            co = obj.matrix_world @ vert.co

            if i in detail:
                col = _feature_color(co, features)
                attr.data[i].color = (col[0], col[1], col[2], 1.0)
                continue

            normal = (obj.matrix_world.to_3x3() @ vert.normal).normalized()
            col = _base_color(normal)

            for color, center, radius, feather, strength, gate in blobs:
                dist = (co - center).length
                w = _smoothstep(1.0 - (dist - radius) / feather)
                w *= strength * _gate_weight(gate, normal)
                if w > 0.0:
                    col = _mix(col, color, w)

            # 耳内朝里的那一面染藕粉。耳朵是锥体，内侧法线指向身体中线，
            # 拿法线判断比用坐标切一刀干净——不会在耳缘留下一条硬边。
            if obj.name == "part_ears" and abs(co.x) > 1e-4:
                inner = max(0.0, -normal.x * (1.0 if co.x > 0 else -1.0))
                col = _mix(col, pad, inner ** 1.5 * 0.85)

            attr.data[i].color = (col[0], col[1], col[2], 1.0)


def _new_image(name, is_data, fill):
    img = bpy.data.images.new(
        name, rig_spec.TEX_SIZE["pet"], rig_spec.TEX_SIZE["pet"],
        alpha=False, is_data=is_data)
    # UV 壳之外的空白会被压缩和 mipmap 拉进壳内。填成毛色（法线图填平面法线），
    # 渗进来也看不出；留黑就会在每条缝边描出一圈暗线。
    img.generated_color = fill
    return img


def _fur_tint(nt, detail_img):
    """毛流 + 斑驳，返回一个在 1.0 附近波动的标量和用于凹凸的高度。"""
    links = nt.links
    texco = nt.nodes.new("ShaderNodeTexCoord")

    mapping = nt.nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = (FUR_TILE, FUR_TILE, FUR_TILE)
    links.new(texco.outputs["Object"], mapping.inputs["Vector"])

    strand = nt.nodes.new("ShaderNodeTexImage")
    strand.image = detail_img
    # 盒式投影：按法线朝向从三个轴向里选一张贴，交界处按 blend 混合。
    # 不用 UV，所以细节图在部件之间是连续的。
    strand.projection = "BOX"
    strand.projection_blend = 0.25
    strand.extension = "MIRROR"
    strand.interpolation = "Cubic"
    links.new(mapping.outputs["Vector"], strand.inputs["Vector"])

    mottle = nt.nodes.new("ShaderNodeTexNoise")
    mottle.inputs["Scale"].default_value = MOTTLE_SCALE
    mottle.inputs["Detail"].default_value = 3.0
    links.new(texco.outputs["Object"], mottle.inputs["Vector"])

    def centered(src, amount):
        sub = nt.nodes.new("ShaderNodeMath")
        sub.operation = "SUBTRACT"
        sub.inputs[1].default_value = 0.5
        links.new(src, sub.inputs[0])
        mul = nt.nodes.new("ShaderNodeMath")
        mul.operation = "MULTIPLY"
        mul.inputs[1].default_value = amount
        links.new(sub.outputs[0], mul.inputs[0])
        return mul.outputs[0]

    total = nt.nodes.new("ShaderNodeMath")
    total.operation = "ADD"
    links.new(centered(strand.outputs["Color"], FUR_AMOUNT), total.inputs[0])
    links.new(centered(mottle.outputs["Fac"], MOTTLE_AMOUNT), total.inputs[1])

    tint = nt.nodes.new("ShaderNodeMath")
    tint.operation = "ADD"
    tint.inputs[1].default_value = 1.0
    links.new(total.outputs[0], tint.inputs[0])

    return tint.outputs[0], strand.outputs["Color"]


def build_bake_shader(mat, detail_img):
    """烘焙用的着色器：顶点色 × 毛流，凹凸接到 Normal 上供法线烘焙取用。"""
    nt = mat.node_tree
    nt.nodes.clear()
    links = nt.links

    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Roughness"].default_value = BODY_ROUGHNESS
    bsdf.inputs["Metallic"].default_value = 0.0
    links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    vcol = nt.nodes.new("ShaderNodeVertexColor")
    vcol.layer_name = COLOR_ATTR

    tint, height = _fur_tint(nt, detail_img)

    scale = nt.nodes.new("ShaderNodeVectorMath")
    scale.operation = "SCALE"
    links.new(vcol.outputs["Color"], scale.inputs[0])
    links.new(tint, scale.inputs["Scale"])
    links.new(scale.outputs["Vector"], bsdf.inputs["Base Color"])

    # 法线烘焙取的是着色法线，Bump 节点的效果会一起被烘进去——
    # 这是把程序化凹凸变成一张切线空间法线贴图的唯一办法。
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = BUMP_STRENGTH
    bump.inputs["Distance"].default_value = BUMP_DISTANCE
    links.new(height, bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])


def _target_node(mat, img):
    """烘焙写进「材质里处于激活状态的那个图像节点」，每个参与烘焙的材质都要有一个。"""
    nt = mat.node_tree
    node = next((n for n in nt.nodes
                 if n.type == "TEX_IMAGE" and n.label == "bake_target"), None)
    if node is None:
        node = nt.nodes.new("ShaderNodeTexImage")
        node.label = "bake_target"
    node.image = img
    nt.nodes.active = node
    return node


def _bake(parts, mats, img, bake_type, pass_filter=None):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    # 颜色和法线都不需要光照收敛，但**需要抗锯齿**：每个纹素多采几个点，
    # 才能把细节图里比纹素更细的成分平均掉，而不是留成一片麻点。
    scene.cycles.samples = 16
    scene.cycles.use_denoising = False
    scene.render.bake.margin = 8
    # 不清空画布，保留创建时填的底色。开清空会把 UV 壳之外刷成纯黑，
    # 压缩和 mipmap 会把那圈黑渗进壳内，模型上就出现一条条暗缝。
    scene.render.bake.use_clear = False
    scene.render.bake.use_selected_to_active = False

    for mat in mats:
        _target_node(mat, img)

    bpy.ops.object.select_all(action="DESELECT")
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]

    kwargs = {"type": bake_type}
    if pass_filter:
        kwargs["pass_filter"] = pass_filter
        scene.render.bake.use_pass_direct = False
        scene.render.bake.use_pass_indirect = False
        scene.render.bake.use_pass_color = True
    bpy.ops.object.bake(**kwargs)


def _save(img, path, file_format, quality=None):
    """必须传绝对路径。

    Blender 把相对路径按「相对于 .blend 文件」解析，而无头脚本里没有 .blend——
    `save()` 不报错，文件却不知道落在哪。这个坑我们踩过：GLB 体积正常增长
    （导出器退回用内存里的像素），磁盘上却一张贴图都没有。
    """
    path = os.path.abspath(path)
    img.filepath_raw = path
    img.file_format = file_format
    if quality is not None:
        bpy.context.scene.render.image_settings.quality = quality
    img.save()
    if not os.path.exists(path):
        raise RuntimeError("image save produced no file: %s" % path)
    return path


def build_final_material(mat, base_img, normal_img, roughness):
    """导出用的材质：BaseColor 贴图 + 法线贴图，参数照 §5.8。

    两个材质球共用同一对贴图。它们的 UV 壳互不重叠，所以一张图能同时装下
    毛色和五官，不用为眼睛和鼻子单开一张——那会多一张贴图和一次采样。
    """
    nt = mat.node_tree
    nt.nodes.clear()
    links = nt.links

    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = 0.0
    links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    base = nt.nodes.new("ShaderNodeTexImage")
    base.image = base_img
    links.new(base.outputs["Color"], bsdf.inputs["Base Color"])

    nrm_tex = nt.nodes.new("ShaderNodeTexImage")
    nrm_tex.image = normal_img
    nrm = nt.nodes.new("ShaderNodeNormalMap")
    links.new(nrm_tex.outputs["Color"], nrm.inputs["Color"])
    links.new(nrm.outputs["Normal"], bsdf.inputs["Normal"])


def strip_bake_target(mat):
    """烘焙节点留在材质里，glTF 导出器会把它当成一张没接线的多余贴图带出去。"""
    nt = mat.node_tree
    for node in [n for n in nt.nodes if n.label == "bake_target"]:
        nt.nodes.remove(node)


def bake(parts, body_mat, other_mats, to_blender, out_dir, name, blobs, features):
    """整套流程：染顶点色 → 烘 basecolor → 烘 normal → 换成带贴图的材质。

    返回两张贴图的路径。
    """
    detail_path = os.path.abspath(FUR_DETAIL)
    if not os.path.exists(detail_path):
        raise RuntimeError(
            "missing fur detail map: %s -- run tools/make_fur_detail.py first" % detail_path)
    detail_img = bpy.data.images.load(detail_path)
    detail_img.colorspace_settings.name = "Non-Color"

    paint_vertex_colors(parts, blobs, features, to_blender)
    build_bake_shader(body_mat, detail_img)
    mats = [body_mat] + list(other_mats)

    base_img = _new_image(name + "_basecolor", False, rgb(PALETTE["fur"]) + (1.0,))
    _bake(parts, mats, base_img, "DIFFUSE", pass_filter={"COLOR"})

    norm_img = _new_image(name + "_normal", True, (0.5, 0.5, 1.0, 1.0))
    _bake(parts, mats, norm_img, "NORMAL")

    os.makedirs(out_dir, exist_ok=True)
    # 两张都走 JPEG。basecolor 没有 alpha 也没有硬边，无损存粹属浪费。
    #
    # 法线贴图存 JPEG 通常是坏做法，这里例外，因为它只承载**微观毛缕起伏**：
    # 512² PNG 是 478 KB（内容全是高频噪声，PNG 压不动），JPEG q94 是 1/5，
    # 而 §4.4 的主包只剩不到 2 MB。实测两版渲染出来看不出差别。
    # 将来如果法线贴图要承载缝线、鼻纹这类**结构性**细节，得回头换成 PNG。
    base_path = _save(base_img, os.path.join(out_dir, name + "_basecolor.jpg"),
                      "JPEG", quality=92)
    normal_path = _save(norm_img, os.path.join(out_dir, name + "_normal.jpg"),
                        "JPEG", quality=94)

    for mat in mats:
        strip_bake_target(mat)
    # 顶点色的使命到烘焙为止。留着会被 glTF 导出器当成 COLOR_0 带进文件，
    # 引擎那边一旦启用顶点色就会和贴图相乘，颜色平白暗一层。
    for obj in parts:
        for attr in list(obj.data.color_attributes):
            obj.data.color_attributes.remove(attr)

    # 从磁盘重新载入：glTF 导出器认得「有原始文件」的图像，能把字节直接搬进
    # GLB，不会重新编码一遍。内存里那两张是 GENERATED，导出器只能自己转 PNG。
    final_base = bpy.data.images.load(base_path)
    final_normal = bpy.data.images.load(normal_path)
    # 法线贴图存的是方向，不是颜色。按 sRGB 解读会把凹凸方向算错。
    final_normal.colorspace_settings.name = "Non-Color"

    build_final_material(body_mat, final_base, final_normal, BODY_ROUGHNESS)
    for mat in other_mats:
        build_final_material(mat, final_base, final_normal, DETAIL_ROUGHNESS)

    return base_path, normal_path
