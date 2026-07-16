from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "public" / "og-canopy-first-night.png"
OUTPUT = ROOT / "public" / "wiki-canopy-survival.png"
SIZE = (1200, 900)


def cover(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    scale = max(size[0] / image.width, size[1] / image.height)
    resized = image.resize(
        (round(image.width * scale), round(image.height * scale)),
        Image.Resampling.LANCZOS,
    )
    left = (resized.width - size[0]) // 2
    top = (resized.height - size[1]) // 2
    return resized.crop((left, top, left + size[0], top + size[1]))


source = Image.open(SOURCE).convert("RGB")
background = cover(source, SIZE).filter(ImageFilter.GaussianBlur(24))
background = ImageEnhance.Brightness(background).enhance(0.42)

foreground_height = 630
foreground = source.resize(
    (SIZE[0], foreground_height),
    Image.Resampling.LANCZOS,
)
canvas = background.copy()
canvas.paste(foreground, (0, (SIZE[1] - foreground_height) // 2))

overlay = Image.new("RGBA", SIZE, (0, 0, 0, 0))
pixels = overlay.load()
for y in range(SIZE[1]):
    edge = min(y, SIZE[1] - 1 - y)
    alpha = int(205 * max(0.0, 1.0 - edge / 190.0))
    for x in range(SIZE[0]):
        pixels[x, y] = (2, 10, 6, alpha)
canvas = Image.alpha_composite(canvas.convert("RGBA"), overlay)

draw = ImageDraw.Draw(canvas)
latin_font = ImageFont.truetype(r"C:\Windows\Fonts\georgiab.ttf", 86)
cn_font = ImageFont.truetype(r"C:\Windows\Fonts\msyhbd.ttc", 42)
small_font = ImageFont.truetype(r"C:\Windows\Fonts\msyh.ttc", 22)

draw.text((58, 42), "CANOPY", font=latin_font, fill=(245, 242, 223, 255))
draw.text((60, 748), "生存档案 · 完整游戏 WIKI", font=cn_font, fill=(213, 244, 122, 255))
draw.text(
    (62, 816),
    "物品 · 配方 · 建造 · 生态 · 任务 · 存档",
    font=small_font,
    fill=(204, 216, 199, 255),
)

canvas.convert("RGB").save(OUTPUT, optimize=True, quality=92)
print(f"Wiki poster written to {OUTPUT} ({SIZE[0]}x{SIZE[1]})")
