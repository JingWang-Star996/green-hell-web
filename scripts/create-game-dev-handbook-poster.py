from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "public" / "game-dev-handbook-poster.png"
WIDTH, HEIGHT = 1200, 900


def font(candidates: list[str], size: int) -> ImageFont.FreeTypeFont:
    for candidate in candidates:
        path = Path(candidate)
        if path.exists():
            return ImageFont.truetype(str(path), size)
    return ImageFont.load_default()


cn_heavy = font([r"C:\Windows\Fonts\msyhbd.ttc", r"C:\Windows\Fonts\simhei.ttf"], 76)
cn_title = font([r"C:\Windows\Fonts\msyhbd.ttc", r"C:\Windows\Fonts\simhei.ttf"], 46)
cn_body = font([r"C:\Windows\Fonts\msyh.ttc", r"C:\Windows\Fonts\simsun.ttc"], 25)
latin = font([r"C:\Windows\Fonts\georgiab.ttf", r"C:\Windows\Fonts\georgia.ttf"], 42)
mono = font([r"C:\Windows\Fonts\consolab.ttf", r"C:\Windows\Fonts\consola.ttf"], 19)

canvas = Image.new("RGB", (WIDTH, HEIGHT), "#08110e")
draw = ImageDraw.Draw(canvas)

# Programmatic topographic field: original geometry, no external artwork.
for index in range(11):
    inset = 46 + index * 34
    tone = (31 + index * 2, 66 + index * 3, 51 + index * 2)
    draw.rounded_rectangle(
        (inset, inset - 70, WIDTH - inset + 120, HEIGHT - inset + 160),
        radius=96 + index * 8,
        outline=tone,
        width=2,
    )

for x in range(48, WIDTH, 48):
    draw.line((x, 0, x, HEIGHT), fill=(20, 41, 33), width=1)
for y in range(36, HEIGHT, 48):
    draw.line((0, y, WIDTH, y), fill=(20, 41, 33), width=1)

glow = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
glow_draw = ImageDraw.Draw(glow)
glow_draw.ellipse((760, -120, 1340, 460), fill=(174, 230, 93, 70))
glow = glow.filter(ImageFilter.GaussianBlur(90))
canvas = Image.alpha_composite(canvas.convert("RGBA"), glow)
draw = ImageDraw.Draw(canvas)

lime = (207, 244, 115, 255)
amber = (255, 183, 103, 255)
text = (243, 245, 235, 255)
muted = (176, 193, 181, 255)
line = (62, 93, 77, 255)

draw.rounded_rectangle((54, 52, 282, 93), radius=18, outline=line, width=2, fill=(10, 24, 18, 220))
draw.ellipse((72, 67, 83, 78), fill=lime)
draw.text((94, 61), "FIELD-PROVEN METHODS", font=mono, fill=muted)

draw.text((58, 165), "GAME", font=latin, fill=amber)
draw.text((56, 229), "游戏创作宝典", font=cn_heavy, fill=text)
draw.text((60, 337), "从设计因果到生产发布", font=cn_title, fill=lime)

draw.line((60, 426, 1140, 426), fill=line, width=2)

labels = [
    ("01", "设计与循环"),
    ("02", "系统与世界"),
    ("03", "工程与存档"),
    ("04", "测试与证据"),
    ("05", "团队与 Agent"),
    ("06", "构建与发布"),
]
for index, (number, label) in enumerate(labels):
    column = index % 3
    row = index // 3
    left = 62 + column * 360
    top = 482 + row * 120
    draw.text((left, top), number, font=mono, fill=amber)
    draw.text((left, top + 34), label, font=cn_body, fill=text)
    draw.line((left, top + 78, left + 286, top + 78), fill=line, width=1)

draw.text((60, 760), "CANOPY 实战失败 · 重制 · 发布经验沉淀", font=cn_body, fill=muted)
draw.text((60, 814), "原则 · 阶段门 · 反模式 · 检查清单 · 模板 · 术语库", font=cn_body, fill=lime)
draw.text((1070, 806), "G0—G9", font=mono, fill=amber)

canvas.convert("RGB").save(OUTPUT, optimize=True)
print(f"Game creation handbook poster written to {OUTPUT} ({WIDTH}x{HEIGHT})")
