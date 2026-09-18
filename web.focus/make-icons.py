#!/usr/bin/env python3
"""Draw the Home Screen icons.

iOS will not read an SVG `apple-touch-icon`. Given one it silently falls back
to a screenshot of the page, which is why the installed app used to show a
picture of the terminal instead of a mark. So the icons have to be PNG, and a
PNG has to come from somewhere — this is that somewhere, checked in so the
icons can be regenerated rather than being three binaries nobody can edit.

No Pillow on the box, and none wanted: a PNG is a zlib stream of filtered
scanlines plus three chunks, which is short enough to write out by hand.

What it draws is one still frame of the `space` scene, in that theme's own
colours (`js/themes.js`, class Space): a starfield, the ringed planet, and the
accent bar the mark already had. A Home Screen icon cannot animate — iOS has
no moving app icons — so the scene is fixed at one frame on purpose, and the
seed is fixed too so a regeneration is byte-identical.

    python3 make-icons.py
"""

import math
import random
import struct
import zlib

# js/themes.js, class Space, plus the page's own tokens from styles.css.
BG = (0x0a, 0x0e, 0x17)  # --bg-primary
ACCENT = (0x63, 0x66, 0xf1)  # --accent
FAR = (120, 128, 155)  # Space.FAR
NEAR = (215, 220, 240)  # Space.NEAR
PLANET = (205, 145, 95)  # Space.PLANET

SIZES = (180, 192, 512)
SEED = 1073  # the task that asked for the scene on the Home Screen


def blend(under, over, alpha):
    """`over` at `alpha` on top of `under`, both opaque RGB."""
    return tuple(round(u + (o - u) * alpha) for u, o in zip(under, over))


def disc(px, size, cx, cy, r, colour, alpha=1.0):
    """A filled circle, antialiased by sampling the edge cell's coverage."""
    for y in range(max(0, int(cy - r - 1)), min(size, int(cy + r + 2))):
        for x in range(max(0, int(cx - r - 1)), min(size, int(cx + r + 2))):
            d = math.hypot(x + 0.5 - cx, y + 0.5 - cy)
            cover = min(1.0, max(0.0, r + 0.5 - d))
            if cover > 0:
                px[y][x] = blend(px[y][x], colour, cover * alpha)


def ring(px, size, cx, cy, rx, ry, thick, colour, alpha=1.0):
    """The planet's ring: an ellipse outline, same edge sampling as `disc`."""
    for y in range(max(0, int(cy - ry - thick - 1)), min(size, int(cy + ry + thick + 2))):
        for x in range(max(0, int(cx - rx - thick - 1)), min(size, int(cx + rx + thick + 2))):
            nx = (x + 0.5 - cx) / rx
            ny = (y + 0.5 - cy) / ry
            d = abs(math.hypot(nx, ny) - 1.0) * rx
            cover = min(1.0, max(0.0, thick - d))
            if cover > 0:
                px[y][x] = blend(px[y][x], colour, cover * alpha)


def bar(px, size, x0, y0, x1, y1, r, colour):
    """The accent bar the old mark was, as a rounded capsule."""
    for y in range(max(0, int(y0 - 1)), min(size, int(y1 + 2))):
        for x in range(max(0, int(x0 - 1)), min(size, int(x1 + 2))):
            px_, py = x + 0.5, y + 0.5
            qx = min(max(px_, x0 + r), x1 - r)
            qy = min(max(py, y0 + r), y1 - r)
            cover = min(1.0, max(0.0, r + 0.5 - math.hypot(px_ - qx, py - qy)))
            if cover > 0:
                px[y][x] = blend(px[y][x], colour, cover)


def scene(size):
    """One frame of `space`, drawn at whatever size the icon wants."""
    s = size / 180.0  # every measurement below is in 180px units
    px = [[BG] * size for _ in range(size)]
    rng = random.Random(SEED)

    # The starfield. Space.starfield sows one star per 22 cells and twinkles
    # them; a still frame keeps the places and freezes the phase, so the three
    # sizes differ only in resolution, never in layout.
    for _ in range(int((size * size) / 900)):
        x = rng.uniform(0, size)
        y = rng.uniform(0, size)
        mag = rng.random()
        if mag > 0.93:
            disc(px, size, x, y, 2.0 * s, NEAR)
        elif mag > 0.6:
            disc(px, size, x, y, 1.3 * s, NEAR, 0.85)
        else:
            disc(px, size, x, y, 1.0 * s, FAR, 0.7)

    # The ringed planet, up and to the right, the way PLANET_ART sits. iOS
    # masks the icon to a rounded superellipse, so the ring has to stay well
    # inside the square or its tips get shaved off on the Home Screen.
    cx, cy, r = 106.0 * s, 68.0 * s, 24.0 * s
    ring(px, size, cx, cy, r * 1.8, r * 0.60, 2.4 * s, PLANET, 0.75)
    disc(px, size, cx, cy, r, PLANET)
    # A crescent of shadow, so the disc reads as a sphere and not a dot.
    disc(px, size, cx - r * 0.30, cy - r * 0.26, r * 1.02, BG, 0.22)
    # Drawn again so the near half of the ring passes in front of the disc.
    ring(px, size, cx, cy, r * 1.85, r * 0.62, 2.6 * s, PLANET, 0.75)

    # The mark itself: the accent bar, where it has always been.
    bar(px, size, 34.0 * s, 132.0 * s, 146.0 * s, 150.0 * s, 9.0 * s, ACCENT)
    return px


def png(px, size):
    """RGB8 PNG: IHDR, one zlib'd IDAT of filter-0 scanlines, IEND."""
    raw = b"".join(b"\x00" + bytes(v for p in row for v in p) for row in px)

    def chunk(kind, data):
        return (struct.pack(">I", len(data)) + kind + data
                + struct.pack(">I", zlib.crc32(kind + data) & 0xffffffff))

    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9))
            + chunk(b"IEND", b""))


def main():
    for size in SIZES:
        name = f"icon-{size}.png"
        with open(name, "wb") as out:
            out.write(png(scene(size), size))
        print(f"{name}")


if __name__ == "__main__":
    main()
