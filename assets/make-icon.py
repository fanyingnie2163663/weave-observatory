from PIL import Image, ImageDraw, ImageFont

S = 1024
PAPER = (241, 234, 217, 255)
SEAL = (178, 58, 38, 255)

img = Image.new("RGBA", (S, S), PAPER)
d = ImageDraw.Draw(img, "RGBA")

for x in range(0, S + 1, 64):
    d.line([(x, 0), (x, S)], fill=(28, 25, 20, 9), width=1)
for y in range(0, S + 1, 64):
    d.line([(0, y), (S, y)], fill=(28, 25, 20, 9), width=1)

for i, x in enumerate([S * (k + 1) / 6 for k in range(5)]):
    d.line([(x, 44), (x, S - 44)], fill=(28, 25, 20, 22), width=7)
for i, y in enumerate([S * (k + 1) / 6 for k in range(5)]):
    d.line([(44, y), (S - 44, y)], fill=(28, 25, 20, 22), width=7)

d.rectangle([36, 36, S - 36, S - 36], outline=(28, 25, 20, 60), width=4)

size = 600
b = ((S - size) // 2, (S - size) // 2, (S + size) // 2, (S + size) // 2)
d.rounded_rectangle(b, radius=26, fill=SEAL)
d.rounded_rectangle([b[0] + 16, b[1] + 16, b[2] - 16, b[3] - 16],
                    radius=14, outline=(241, 234, 217, 80), width=3)

f = ImageFont.truetype("C:/Windows/Fonts/msyhbd.ttc", int(size * 0.70))
d.text((S / 2, S / 2 + size * 0.015), "织", font=f, fill=PAPER, anchor="mm")

img.convert("RGB").save("F:/视觉优化/assets/icon.png")
img.resize((512, 512), Image.LANCZOS).convert("RGB").save("F:/视觉优化/assets/icon-512.png")
img.resize((180, 180), Image.LANCZOS).convert("RGB").save("F:/视觉优化/assets/icon-180.png")
print("ok")
