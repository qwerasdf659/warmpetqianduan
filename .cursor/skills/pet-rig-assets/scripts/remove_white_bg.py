#!/usr/bin/env python3
"""Make the plain background of a generated pet base image transparent.

Flood-fills the background inward from the four image corners, so near-white
areas INSIDE the character (cream belly, paws) are kept. A naive
"every near-white pixel -> transparent" would punch holes in those areas; the
solid outline around the character stops the flood, so corner flood-fill only
clears the true background.

Usage:
    python scripts/remove_white_bg.py input.png output.png [--thresh 40]

Requires: Pillow  (pip install pillow)

--thresh is the color tolerance for "same as the corner background". Raise it if
a pale halo remains around the character; lower it if the edges get eaten.
"""
import argparse

from PIL import Image, ImageChops, ImageDraw

# Magenta: assumed absent from the warm milk-tea palette, used as a fill marker.
SENTINEL = (255, 0, 255)


def remove_white_bg(src: str, dst: str, thresh: int = 40) -> None:
    img = Image.open(src).convert("RGB")
    w, h = img.size

    # Seed from all four corners so a background that is not perfectly uniform
    # still gets fully cleared.
    for seed in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)):
        ImageDraw.floodfill(img, seed, SENTINEL, thresh=thresh)

    # Build alpha from the sentinel marker: transparent where filled, else opaque.
    r, g, b = img.split()
    sentinel_mask = ImageChops.multiply(
        ImageChops.multiply(
            r.point(lambda v: 255 if v == SENTINEL[0] else 0),
            g.point(lambda v: 255 if v == SENTINEL[1] else 0),
        ),
        b.point(lambda v: 255 if v == SENTINEL[2] else 0),
    )
    alpha = sentinel_mask.point(lambda v: 0 if v else 255)

    # Paste onto a fully transparent canvas so cleared pixels carry no color
    # (avoids a magenta halo when the PNG is later filtered / mipmapped).
    out = Image.new("RGBA", img.size, (0, 0, 0, 0))
    out.paste(img, (0, 0), alpha)
    out.save(dst)
    print(f"OK -> {dst}")


def main() -> None:
    ap = argparse.ArgumentParser(description="Flood-fill a plain background to transparent.")
    ap.add_argument("input")
    ap.add_argument("output")
    ap.add_argument("--thresh", type=int, default=40)
    args = ap.parse_args()
    remove_white_bg(args.input, args.output, args.thresh)


if __name__ == "__main__":
    main()
