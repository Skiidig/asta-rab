#!/usr/bin/env python3
"""
Buat varian tampilan dari aset sumber terbaru di
`src/assets/branding/rev/`:

- `rev/astaworks.png`       : wordmark + tagline (sumber asli pengguna).
- `rev/astaworks-arrow.png` : arrow transparan untuk area ringkas.

Output di `src/assets/branding/`:
- astaworks-full.png / astaworks-full-light.png
- astaworks-wordmark.png / astaworks-wordmark-light.png
- astaworks-arrow.png

`light` = teks/aksen gelap diubah krem untuk tema gelap; aksen biru dipertahankan.
Desain tidak diubah dan tidak di-invert. Ruang transparan dipangkas agar logo
tampil utuh tanpa object-cover.

Pemakaian: python scripts/make-logo-variants.py
Membutuhkan Pillow (hanya untuk perawatan aset, bukan runtime).
"""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
BRAND = ROOT / "src" / "assets" / "branding"
REV = BRAND / "rev"
SOURCE = REV / "astaworks.png"
ARROW_SOURCE = REV / "astaworks-arrow.png"
CREAM = (230, 232, 237)
ALPHA_THRESHOLD = 20
PADDING = 10


def content_crop(image: Image.Image, top: int | None = None, bottom: int | None = None):
    alpha = image.getchannel("A")
    pixels = alpha.load()
    xs = []
    ys = []
    for y in range(image.height):
        if top is not None and y < top:
            continue
        if bottom is not None and y > bottom:
            continue
        for x in range(image.width):
            if pixels[x, y] > ALPHA_THRESHOLD:
                xs.append(x)
                ys.append(y)
    if not xs:
        raise SystemExit("Aset tidak memiliki piksel yang terlihat.")
    box = (
        max(0, min(xs) - PADDING),
        max(0, min(ys) - PADDING),
        min(image.width, max(xs) + PADDING + 1),
        min(image.height, max(ys) + PADDING + 1),
    )
    return image.crop(box)


def light_variant(image: Image.Image) -> Image.Image:
    result = image.copy()
    source = image.load()
    target = result.load()
    for y in range(image.height):
        for x in range(image.width):
            r, g, b, a = source[x, y]
            if a == 0:
                continue
            is_blue = b > r + 40 and b > g + 20
            if not is_blue:
                target[x, y] = (*CREAM, a)
    return result


def save(image: Image.Image, name: str) -> None:
    target = BRAND / name
    image.save(target, optimize=True)
    print(f"{name}: {image.width}x{image.height}")


source = Image.open(SOURCE).convert("RGBA")
alpha = source.getchannel("A")

# Baris wordmark berakhir sebelum tagline; cari celah kosong pertama.
occupied = [y for y in range(source.height) if any(alpha.getpixel((x, y)) > ALPHA_THRESHOLD for x in range(0, source.width, 2))]
gaps = []
previous = None
for y in occupied:
    if previous is not None and y > previous + 1:
        gaps.append((previous, y))
    previous = y
if not gaps:
    raise SystemExit("Tidak menemukan pemisah wordmark/tagline.")

wordmark_end, tagline_start = max(gaps, key=lambda pair: pair[1] - pair[0])

full = content_crop(source)
wordmark = content_crop(source, bottom=wordmark_end)
arrow = content_crop(Image.open(ARROW_SOURCE).convert("RGBA"))

save(full, "astaworks-full.png")
save(light_variant(full), "astaworks-full-light.png")
save(wordmark, "astaworks-wordmark.png")
save(light_variant(wordmark), "astaworks-wordmark-light.png")
save(arrow, "astaworks-arrow.png")
