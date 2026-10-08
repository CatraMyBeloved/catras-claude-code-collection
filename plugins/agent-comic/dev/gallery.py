"""Close-ups that follow the figure: one crop per time point, tiled with labels.
  python dev/gallery.py <scene> <t1,t2,...> <labels,...> [columns]"""
import json, sys
from PIL import Image, ImageDraw
from sheet import render, FONT, CW, CH
name, times, labels = sys.argv[1], sys.argv[2].split(','), sys.argv[3].split(',')
span = int(sys.argv[4]) if len(sys.argv) > 4 else 40  # columns around the figure
s = json.load(open('dev/out/frames.json'))[name]
tiles = []
for t, label in zip(times, labels):
    col0 = max(0, min(s['columns'] - span, s['x'][t] + 5 - span // 2))
    im = render(s['columns'], s['rows'], s['frames'][t]).crop((col0 * CW, 0, (col0 + span) * CW, s['rows'] * CH))
    tile = Image.new('RGB', (im.width, im.height + 24), (0, 0, 0))
    ImageDraw.Draw(tile).text((4, 3), f'{label}  t={t}', fill=(200, 200, 200), font=FONT)
    tile.paste(im, (0, 24))
    tiles.append(tile)
per = 3
w, h = tiles[0].size
out = Image.new('RGB', (w * per + 8 * (per - 1), (h + 8) * ((len(tiles) + per - 1) // per)), (60, 60, 60))
for k, tile in enumerate(tiles):
    out.paste(tile, ((k % per) * (w + 8), (k // per) * (h + 8)))
out.save(f'dev/out/{name}-gallery.png')
print(f'dev/out/{name}-gallery.png')
