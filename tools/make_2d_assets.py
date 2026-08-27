"""把生成的原始图规格化成能进工程的 2D 资源。

生成模型给不出符合规范的成品：尺寸不对、没有 alpha、边距不统一。
这个脚本负责最后一公里，规则全部来自 docs/06 第六节。

依赖 Pillow：python -m pip install Pillow

用法：
  python tools/make_2d_assets.py icons  <原始2x2网格图> <输出目录>
  python tools/make_2d_assets.py bg     <原始背景图>   <输出路径>
"""

import os
import sys

from PIL import Image

# 抠像背景色。图标本身是单色的，所以抠完直接把 RGB 全部刷成图标色，
# 边缘的紫色残留一次性消掉，不用调容差。
KEY_COLOR = (255, 0, 255)
ICON_COLOR = (0x4A, 0x37, 0x28)  # #4A3728，docs/06 §6.2

ICON_SIZE = 128
ICON_SAFE = 10  # 四边各留 10px，图形主体控制在 108×108 内
BG_SIZE = 1024  # 正方形且为 2 的幂，PVRTC 的硬性要求（§4.3）

# 2×2 网格的读取顺序，对应 docs/06 §6.2 的四个 itemKey
ICON_ORDER = ["icon_feed", "icon_bath", "icon_pet", "icon_play"]


def key_out(tile):
    """按到抠像色的距离生成 alpha，边缘做线性过渡避免锯齿。"""
    tile = tile.convert("RGB")
    w, h = tile.size
    px = tile.load()

    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    op = out.load()

    near, far = 90.0, 190.0  # 距离小于 near 判为背景，大于 far 判为图形
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            d = ((r - KEY_COLOR[0]) ** 2 + (g - KEY_COLOR[1]) ** 2 + (b - KEY_COLOR[2]) ** 2) ** 0.5
            if d <= near:
                a = 0
            elif d >= far:
                a = 255
            else:
                a = int(255 * (d - near) / (far - near))
            op[x, y] = (ICON_COLOR[0], ICON_COLOR[1], ICON_COLOR[2], a)
    return out


def fit_icon(rgba):
    """裁到图形外接框，等比缩放进安全区，再居中放到标准画布上。

    先裁再缩放，四个图标的视觉重量才会一致——直接整格缩放的话，
    原图里留白多的那个会显得小一圈（§6.1 要求视觉面积接近）。
    """
    bbox = rgba.getbbox()
    if not bbox:
        raise RuntimeError("抠像后是空的，检查 KEY_COLOR 或容差")
    cropped = rgba.crop(bbox)

    inner = ICON_SIZE - ICON_SAFE * 2
    w, h = cropped.size
    scale = min(inner / w, inner / h)
    resized = cropped.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)

    canvas = Image.new("RGBA", (ICON_SIZE, ICON_SIZE), (0, 0, 0, 0))
    canvas.paste(resized, ((ICON_SIZE - resized.width) // 2, (ICON_SIZE - resized.height) // 2))
    return canvas


def build_icons(src_path, out_dir):
    grid = Image.open(src_path)
    w, h = grid.size
    cw, ch = w // 2, h // 2
    os.makedirs(out_dir, exist_ok=True)

    written = []
    for i, name in enumerate(ICON_ORDER):
        col, row = i % 2, i // 2
        tile = grid.crop((col * cw, row * ch, (col + 1) * cw, (row + 1) * ch))
        icon = fit_icon(key_out(tile))

        path = os.path.join(out_dir, name + ".png")
        icon.save(path, "PNG")
        written.append((name, path, icon.size))

        # @2x 备用，界面按 48×48 显示，高分屏上 128 够用，256 留给将来
        icon2x = icon.resize((ICON_SIZE * 2, ICON_SIZE * 2), Image.LANCZOS)
        icon2x.save(os.path.join(out_dir, name + "@2x.png"), "PNG")

    return written


def build_bg(src_path, out_path):
    """背景存 JPEG。

    它是一张柔和虚化的底图，没有 alpha、没有硬边，JPEG 的块效应看不出来，
    体积却只有 PNG 的七分之一。主包预算是 4 MB（§4.4），一张背景占掉 1 MB
    没有道理。文档 8.1 的命名示例里背景本来就是 .jpg。
    """
    img = Image.open(src_path).convert("RGB")
    if img.size != (BG_SIZE, BG_SIZE):
        img = img.resize((BG_SIZE, BG_SIZE), Image.LANCZOS)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    img.save(out_path, "JPEG", quality=88, optimize=True, subsampling=1)
    return out_path, img.size


def main():
    if len(sys.argv) < 4:
        print(__doc__)
        sys.exit(2)

    mode, src, dst = sys.argv[1], sys.argv[2], sys.argv[3]
    if mode == "icons":
        for name, path, size in build_icons(src, dst):
            print("  %-12s %dx%d  %s" % (name, size[0], size[1], path))
    elif mode == "bg":
        path, size = build_bg(src, dst)
        print("  背景 %dx%d  %s" % (size[0], size[1], path))
    else:
        print("未知模式: %s" % mode)
        sys.exit(2)


if __name__ == "__main__":
    main()
