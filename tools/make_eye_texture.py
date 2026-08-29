"""生成眼睛贴花：深眼廓 + 虹膜渐变 + 瞳孔 + 星形高光。

## 为什么眼睛要单独一张贴花，而毛色不行

`pet_texture.py` 开头那条「图像模型不知道 UV 上哪块是耳朵」对身体成立，
对眼睛不成立——**眼球是一个球，中心和半径都是我们自己填的数**
（`species.py` 的 `eye` / `eye_r`），沿光轴做平面投影，图上哪个像素落在
球面哪一点是完全确定的。所以这是全身唯一能精确贴图的地方。

而眼睛恰好是最需要贴图的地方。§5.2 的参考图那双眼睛里有四层结构：
深眼廓、虹膜渐变、瞳孔、白色星形高光。用几何做过两轮都失败了
（见 `species._face` 的注释：三层套嵌的球像年轮，凸出的圆盘像贴了个镜片），
而且 3000 面的预算给不起。

## 图案是程序化画的，不是图像模型生成的

星形高光要的是**干净的五角星**，边缘锐利、颜色纯白。图像模型给的是带噪点、
带渐变、还自带光照的一小团白。这类几何图案画出来比生成出来更准，也可复现——
改一个数就能重出，不用重新抽卡。

产物 `eye_detail.png` 是**构建输入**，要进 git；改了参数才需要重跑。

用法：
  blender --background --factory-startup -noaudio --python-exit-code 1 \
      --python tools/make_eye_texture.py -- \
      --out assets-src/pet/tex/eye_detail.png
"""

import os
import sys
import math
import argparse

import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pet_texture  # noqa: E402  色卡只有一份，在那边

# 256 够用。这张图会被烘进 512² 的身体贴图，而眼球在那张图上的 UV 岛
# 大约 130 px 见方（两只眼睛占全身表面约 14%），比贴花本身还小——
# 再画大只是把细节交给烘焙去平均掉。
SIZE = 256
# 超采样倍数。星形的尖角和眼廓的环边都是硬边，直接按 256 画会是锯齿；
# 4× 画完盒式降采样，抗锯齿和面积覆盖率一次解决。
SS = 4

# 归一化坐标：图的 [-1, 1] 对应眼球的 [-R, +R]，(0,0) 是光轴穿出球面那一点。
# 所以下面每个半径都是「占眼球半径的几成」，换物种、改眼睛大小都不用动。
# 眼廓环的内边界。这一圈是眼睛里唯一的深色，要读得出是描边。
#
# 别画厚。卡通着色本身会把球面掠射的那一圈压暗，和画上去的眼廓叠在一起——
# 0.78 那版两者加起来是一道又厚又软的暗环，参考图里是一条细而利的线。
RIM_INNER = 0.86
# 瞳孔在参考图里**几乎看不出来**——虹膜是一片均匀的暖棕。
# 0.65 那版把眼睛中心压成一块黑斑，星星移开之后那块黑就露出来了。
PUPIL_R = 0.30
PUPIL_MIX = 0.15
LID_SHADOW = 0.12       # 上眼睑投影。只要一点点，重了整只眼睛就压黑了

# 星形要**偏在左上**，不能钉在正中间。
#
# 这一条是把参考图放大量出来的：星星本身的大小我们一直是对的
# （参考图里星占眼睛直径 47%，我们 44%），错的是位置——
# 钉在正中间时，剩下的虹膜只是星星周围一圈边，整只眼睛读成「星形瞳孔」；
# 偏到左上之后右下留出一大片棕色，才读成「眼睛上的一点反光」。
#
# 两只眼睛**不镜像**：贴花的横轴取世界水平方向（pet_texture._axis_euler），
# 所以这一个偏移量在左右眼上都是往屏幕左边偏，和参考图一致。
# 大小按**可见范围**量，不是按投影圆量。眼球有一截埋在头里，露出来的那块
# 比整个投影圆小一圈，所以 0.40 在图上量着接近参考图的 47%，实际到脸上是 60%。
STAR_CENTER = (-0.20, 0.18)
STAR_OUTER = 0.33
STAR_INNER = 0.15
STAR_POINTS = 5

# 副高光：右下角一个小白点，参考图里有。
#
# 上一版把它做成 45% 白度的柔和斑，烘进 512² 之后眼球那块只有 130 px，
# 平均下来不是高光而是一小片污渍。**要纯白、要小、要硬边**——
# 半透明的柔和斑在这个分辨率下必然变脏。
DOT_CENTER = (0.24, -0.30)
DOT_R = 0.075


def srgb(hex_str):
    """十六进制 → 0-1 的 **sRGB** 值，不做线性化。

    和 `pet_texture.rgb()` 相反：那个要给顶点色和材质颜色，必须是线性值；
    这里的产物是一个 PNG 文件，存的就是显示空间的值。
    """
    h = hex_str.lstrip("#")
    return np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)])


def _grid(n):
    """像素中心的归一化坐标。行 0 在**下**，和 Blender 的像素顺序一致。"""
    t = (np.arange(n) + 0.5) / n * 2.0 - 1.0
    return np.meshgrid(t, t)


def _side(px, py, a, b):
    return (b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0])


def _star_mask(px, py, center, outer, inner, points, phase=math.pi / 2):
    """星形用「中心 + 相邻两顶点」的三角扇覆盖来判内外。

    比解析的 SDF 好在不用推公式，也不会在尖角处出现符号错误：顶点按角度递增
    生成，每个三角形都是逆时针，三条边同号即在内部。尖角的锯齿由超采样解决。
    """
    verts = []
    for i in range(points * 2):
        ang = phase + i * math.pi / points
        r = outer if i % 2 == 0 else inner
        verts.append((center[0] + r * math.cos(ang),
                      center[1] + r * math.sin(ang)))

    inside = np.zeros(px.shape, dtype=bool)
    for i in range(len(verts)):
        a, b = verts[i], verts[(i + 1) % len(verts)]
        tri = ((_side(px, py, center, a) >= 0.0)
               & (_side(px, py, a, b) >= 0.0)
               & (_side(px, py, b, center) >= 0.0))
        inside |= tri
    return inside


def _mix(base, color, mask):
    """mask 是布尔或 0-1 权重，形状 (n, n)；base 形状 (n, n, 3)。"""
    w = np.asarray(mask, dtype=np.float64)[..., None]
    return base * (1.0 - w) + np.asarray(color)[None, None, :] * w


def draw(n):
    px, py = _grid(n)
    r = np.hypot(px, py)

    pal = pet_texture.PALETTE
    iris_lo = srgb(pal["iris"])        # 虹膜下缘，暖一档
    iris_hi = srgb(pal["iris_deep"])   # 虹膜上缘，深一档
    rim = srgb(pal["eye_rim"])
    pupil = srgb(pal["pupil"])
    glint = srgb(pal["glint"])

    # 虹膜：上深下浅。真实眼球上半被眼睑挡光，这条梯度比任何细节都更能
    # 让一个圆盘读成一个球——没有它就是两颗均匀的棕色纽扣。
    t = np.clip((py + 1.0) * 0.5, 0.0, 1.0)[..., None]
    rgb = iris_hi[None, None, :] * t + iris_lo[None, None, :] * (1.0 - t)

    # 上眼睑投影：只压上缘，越靠上越重。
    shade = np.clip((py - 0.15) / 0.85, 0.0, 1.0) * LID_SHADOW
    rgb = rgb * (1.0 - shade[..., None])

    rgb = _mix(rgb, pupil, (r < PUPIL_R) * PUPIL_MIX)

    # 眼廓在最外一圈。参考图里那是一条 2D 的黑描边；3D 里眼球和脸的交线
    # 本身已经是高对比边界，所以这里只补一档暗色让边缘不发飘。
    rgb = _mix(rgb, rim, r >= RIM_INNER)

    # 两个高光放最后：必须是纯白，压在眼廓和瞳孔之上都不能被冲淡。
    rgb = _mix(rgb, glint,
               np.hypot(px - DOT_CENTER[0], py - DOT_CENTER[1]) < DOT_R)
    rgb = _mix(rgb, glint,
               _star_mask(px, py, STAR_CENTER, STAR_OUTER, STAR_INNER, STAR_POINTS))

    # alpha 就是「这个纹素属不属于眼球正面」。烘焙时用它当贴花的混合权重，
    # 圆外交还给顶点色，所以圆外的 RGB 是什么都无所谓。
    alpha = (r <= 1.0).astype(np.float64)
    return np.concatenate([rgb, alpha[..., None]], axis=2)


def downsample(hi, factor):
    n = hi.shape[0] // factor
    blocks = hi.reshape(n, factor, n, factor, 4)
    return blocks.mean(axis=(1, 3))


def save(rgba, path):
    img = bpy.data.images.new("eye_detail", SIZE, SIZE, alpha=True, is_data=True)
    # is_data 让色彩空间是 Non-Color，存 PNG 时按原值写出，不做任何变换。
    # 我们画的本来就是 sRGB 值，走一遍「线性 → sRGB」会整体提亮一大截。
    # 使用端（pet_texture）载入后再显式标成 sRGB，那边才需要线性值。
    img.pixels.foreach_set(rgba.astype(np.float32).ravel())
    path = os.path.abspath(path)
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    if not os.path.exists(path):
        raise RuntimeError("image save produced no file: %s" % path)
    return path


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    args = ap.parse_args(argv)

    rgba = downsample(draw(SIZE * SS), SS)
    path = save(rgba, args.out)

    print("EYE_TEXTURE_OK %s" % path)
    print("  size      : %dx%d (supersampled %dx)" % (SIZE, SIZE, SS))
    print("  star      : %d points, outer %.2f R, at (%.2f, %.2f)"
          % (STAR_POINTS, STAR_OUTER, STAR_CENTER[0], STAR_CENTER[1]))
    print("  coverage  : alpha=1 on %.1f%% of the map (the eyeball disc)"
          % (rgba[..., 3].mean() * 100.0))


if __name__ == "__main__":
    main()
