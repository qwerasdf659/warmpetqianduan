"""批量去除部件图的外部白色背景，变成透明 RGBA。

用从四角洪水填充（flood fill）：只清与边框相连的白色，
角色内部的白色（眼睛高光、奶油毛发）连不到边框，不会被误清。

用法：
    python remove_bg.py <目录或png文件...> [--thresh N]

  - 传目录：处理目录下所有 *.png
  - 传文件：处理这些文件
  - --thresh：白色判定阈值（默认 60；白边残留就调大，如 80）

原地覆盖，请先备份原图。依赖：Pillow。
"""
import os
import sys
import glob
from PIL import Image, ImageDraw


def remove_white_bg(path: str, thresh: int = 60) -> Image.Image:
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    for seed in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]:
        ImageDraw.floodfill(im, seed, (0, 0, 0, 0), thresh=thresh)
    im.save(path)
    return im


def collect_files(args):
    files = []
    for a in args:
        if os.path.isdir(a):
            files += sorted(glob.glob(os.path.join(a, "*.png")))
        else:
            files.append(a)
    return files


def main():
    argv = sys.argv[1:]
    thresh = 60
    if "--thresh" in argv:
        i = argv.index("--thresh")
        thresh = int(argv[i + 1])
        argv = argv[:i] + argv[i + 2:]

    files = collect_files(argv)
    if not files:
        print("用法: python remove_bg.py <目录或png文件...> [--thresh N]")
        sys.exit(1)

    for f in files:
        im = remove_white_bg(f, thresh)
        # getbbox 报不透明区域范围，便于确认没把整张清空
        print(f"{os.path.basename(f)} -> {im.mode}  content_bbox={im.getbbox()}")
    print("done")


if __name__ == "__main__":
    main()
