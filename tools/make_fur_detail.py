"""把一张毛发照片压成可平铺的细节图（毛流灰度图）。

为什么需要这一步：程序化噪声怎么调都不像毛。等向的分形噪声只有两种结果——
振幅大了像砂纸，小了像塑料，中间没有「像毛」的档位。真实毛发的微观结构
（长短不齐的发梢、成缕的分组、方向一致但粗细各异）是照片里才有的统计特征。

但照片不能直接用：

1. **它带着自己的光照。** 拍摄时的明暗渐变、暗角，贴到模型上就是两套光照打架，
   违反 docs/06 §5.8「不要把光照烘进贴图」。这里用高通滤波把低频整个减掉，
   只留下发丝级别的高频起伏。
2. **它不一定能平铺。** 高通用的是周期性的 FFT 卷积，输出天然首尾相接；
   使用端再配 `MIRROR` 平铺，接缝彻底消失。
3. **色彩没有用。** 分区毛色由顶点色决定（`pet_texture.PALETTE`），
   照片只贡献结构，所以压成单通道灰度。

产物 `fur_detail.png` 是**构建输入**，要进 git；跑一次就行，换照片才需要重跑。

用法：
  blender --background --factory-startup -noaudio --python-exit-code 1 \
      --python tools/make_fur_detail.py -- \
      --src assets-src/pet/tex/fur_source.png \
      --out assets-src/pet/tex/fur_detail.png
"""

import os
import sys
import argparse

import bpy
import numpy as np

# 512 足够：细节图是平铺使用的，模型上会重复十几次，再大也看不出区别。
SIZE = 512
# 高通的截止尺度，单位是输出图的像素。比这更粗的成分（含拍摄光照）全部丢掉。
CUTOFF_PX = 24.0
# 输出的标准差。细节图在使用端会被乘上一个振幅系数，这里只保证对比度可预期，
# 换一张照片不会让模型上的毛突然变重或变轻。
TARGET_STD = 0.16


def load_luma(path):
    img = bpy.data.images.load(os.path.abspath(path))
    img.scale(SIZE, SIZE)
    buf = np.empty(SIZE * SIZE * 4, dtype=np.float32)
    img.pixels.foreach_get(buf)
    rgba = buf.reshape(SIZE, SIZE, 4)
    return (rgba[..., 0] * 0.2126 + rgba[..., 1] * 0.7152
            + rgba[..., 2] * 0.0722).astype(np.float64)


def high_pass(luma, cutoff_px):
    """减掉低频。用 FFT 是因为它的卷积是循环卷积，输出自带可平铺性。"""
    sigma = cutoff_px / 2.0
    ky = np.fft.fftfreq(luma.shape[0])[:, None]
    kx = np.fft.fftfreq(luma.shape[1])[None, :]
    gauss = np.exp(-2.0 * (np.pi * sigma) ** 2 * (kx ** 2 + ky ** 2))
    low = np.real(np.fft.ifft2(np.fft.fft2(luma) * gauss))
    return luma - low


def normalize(detail):
    std = detail.std()
    if std < 1e-6:
        raise RuntimeError("source image has no detail to extract")
    scaled = detail / std * TARGET_STD + 0.5
    return np.clip(scaled, 0.0, 1.0)


def save_gray(values, path):
    out = bpy.data.images.new("fur_detail", SIZE, SIZE, alpha=False, is_data=True)
    rgba = np.empty((SIZE, SIZE, 4), dtype=np.float32)
    for c in range(3):
        rgba[..., c] = values
    rgba[..., 3] = 1.0
    out.pixels.foreach_set(rgba.ravel())
    # 相对路径在无头脚本里会被当成「相对于 .blend」解析，文件不知道落在哪
    path = os.path.abspath(path)
    out.filepath_raw = path
    out.file_format = "PNG"
    out.save()
    if not os.path.exists(path):
        raise RuntimeError("image save produced no file: %s" % path)
    return path


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args(argv)

    luma = load_luma(args.src)
    detail = normalize(high_pass(luma, CUTOFF_PX))
    path = save_gray(detail, args.out)

    print("FUR_DETAIL_OK %s" % path)
    print("  size    : %dx%d" % (SIZE, SIZE))
    print("  cutoff  : %.0f px (low frequencies incl. lighting removed)" % CUTOFF_PX)
    print("  range   : %.3f .. %.3f  std=%.3f" % (detail.min(), detail.max(), detail.std()))


if __name__ == "__main__":
    main()
