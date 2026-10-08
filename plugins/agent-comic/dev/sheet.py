"""Turns dev/out/frames.json into PNGs the way a dark terminal would show them.

  python dev/sheet.py            -> dev/out/<scene>.png contact sheets (+ frames/ singles)
  python dev/sheet.py --singles  -> also every frame as its own PNG
"""
import base64, json, os, struct, sys
from PIL import Image, ImageDraw, ImageFont

CW, CH = 10, 20                 # one cell, 1:2 like a terminal; a half block is a 10x10 square
BG = (30, 31, 40)               # a dark terminal background
DEFAULT = 0x01000000
FONT = None
for path in ('C:/Windows/Fonts/CascadiaMono.ttf', 'C:/Windows/Fonts/consola.ttf'):
    if os.path.exists(path):
        FONT = ImageFont.truetype(path, 17)
        break
FONT = FONT or ImageFont.load_default()

def rgb(c, default):
    return default if c == DEFAULT else ((c >> 16) & 255, (c >> 8) & 255, c & 255)

def render(columns, rows, b64):
    raw = base64.b64decode(b64)
    words = struct.unpack('<%dI' % (len(raw) // 4), raw)
    im = Image.new('RGB', (columns * CW, rows * CH), BG)
    d = ImageDraw.Draw(im)
    for i in range(columns * rows):
        cp, fg, bg = words[i * 3:i * 3 + 3]
        x, y = (i % columns) * CW, (i // columns) * CH
        fgc, bgc = rgb(fg, (220, 220, 220)), rgb(bg, BG)
        d.rectangle([x, y, x + CW - 1, y + CH - 1], fill=bgc)
        if cp == 0x2580: d.rectangle([x, y, x + CW - 1, y + CH // 2 - 1], fill=fgc)
        elif cp == 0x2584: d.rectangle([x, y + CH // 2, x + CW - 1, y + CH - 1], fill=fgc)
        elif cp == 0x2588: d.rectangle([x, y, x + CW - 1, y + CH - 1], fill=fgc)
        elif cp != 0x20: d.text((x, y + 1), chr(cp), fill=fgc, font=FONT)
    return im

def main():
    singles = '--singles' in sys.argv
    data = json.load(open('dev/out/frames.json'))
    for name, s in data.items():
        frames = [(int(t), render(s['columns'], s['rows'], b)) for t, b in s['frames'].items()]
        frames.sort(key=lambda f: f[0])
        w, h = frames[0][1].size
        label = 22
        sheet = Image.new('RGB', (w, len(frames) * (h + label)), (0, 0, 0))
        d = ImageDraw.Draw(sheet)
        for k, (t, im) in enumerate(frames):
            d.text((4, k * (h + label) + 3), f'{name}  t={t}ms', fill=(150, 150, 150), font=FONT)
            sheet.paste(im, (0, k * (h + label) + label))
            if singles:
                os.makedirs(f'dev/out/frames/{name}', exist_ok=True)
                im.save(f'dev/out/frames/{name}/{t:06d}.png')
        sheet.save(f'dev/out/{name}.png')
        print(f'dev/out/{name}.png  ({len(frames)} frames)')

if __name__ == "__main__":
    main()
