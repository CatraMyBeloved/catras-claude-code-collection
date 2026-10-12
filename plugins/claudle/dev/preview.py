"""Draws <out>/frames.json from preview.ts as PNG contact sheets, the way a dark terminal shows them.

  python dev/preview.py <out dir>
Uses the cell renderer of the agent-comic mod (dev/sheet.py).
"""
import json, os, sys
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.expanduser('~/.claude/mods/agent-comic/dev'))
from sheet import render, FONT  # noqa: E402

out = sys.argv[1] if len(sys.argv) > 1 else 'dev/out'
clips = json.load(open(f'{out}/frames.json'))
LABEL = 22

def sheet(names, path, every=None):
    rows = []
    for name in names:
        c = clips[name]
        frames = c['frames'] if every is None else c['frames'][:every]
        ims = [render(c['columns'], c['rows'], f) for f in frames]
        rows.append((name, ims))
    w = max(sum(im.size[0] + 8 for im in ims) for _, ims in rows)
    h = sum(ims[0].size[1] + LABEL for _, ims in rows)
    img = Image.new('RGB', (w, h), (0, 0, 0))
    d = ImageDraw.Draw(img)
    y = 0
    for name, ims in rows:
        d.text((4, y + 2), name, fill=(150, 150, 150), font=FONT)
        x = 0
        for im in ims:
            img.paste(im, (x, y + LABEL))
            x += im.size[0] + 8
        y += ims[0].size[1] + LABEL
    img.save(path)
    print(path)

wide = [n for n in clips if n.endswith('-96')]
narrow = [n for n in clips if n.endswith('-56')]
icons = [n for n in clips if n.startswith('icon-')]
sheet(wide, f'{out}/header-wide.png', every=2)
sheet(narrow, f'{out}/header-narrow.png', every=3)
sheet(icons, f'{out}/icons.png')
