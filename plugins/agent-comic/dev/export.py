"""Turns <out>/frames.json from export.ts into GIFs, frame strips and a README.

  python dev/export.py <out dir>
"""
import json, os, sys
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(__file__))
from sheet import render, FONT  # noqa: E402

out = sys.argv[1] if len(sys.argv) > 1 else 'dev/out/export'
clips = json.load(open(f'{out}/frames.json'))
LABEL = 26

for kind in ('emotions', 'actions', 'features'):
    os.makedirs(f'{out}/{kind}', exist_ok=True)

readme = ['# Agent comic renders', '',
          'Every emotion and action of the agent-comic mod, rendered by its own stage code '
          '(dev/export.ts, dev/export.py in the mod folder). GIFs play at the live 20 fps; '
          'the strips show one frame every 0.5 s.', '']
sections = {'emotion': ['## Emotions', '', '| emotion | what it shows | animation |', '|---|---|---|'],
            'action': ['## Actions', '', '| action | what it shows | animation |', '|---|---|---|'],
            'feature': ['## Features', '', '| feature | what it shows | animation |', '|---|---|---|']}

for name, c in clips.items():
    folder = {'emotion': 'emotions', 'action': 'actions', 'feature': 'features'}[c['kind']]
    frames = [render(c['columns'], c['rows'], f) for f in c['frames']]
    w, h = frames[0].size
    titled = []
    for im in frames:
        canvas = Image.new('RGB', (w, h + LABEL), (0, 0, 0))
        ImageDraw.Draw(canvas).text((6, 4), f'{name}: {c["shows"]}'[: w // 9], fill=(210, 210, 210), font=FONT)
        canvas.paste(im, (0, LABEL))
        titled.append(canvas)
    titled[0].save(f'{out}/{folder}/{name}.gif', save_all=True, append_images=titled[1:], duration=50, loop=0, optimize=True)

    # a strip: one frame every 0.5 s, side by side in rows of four
    picks = titled[::10]
    per = 4
    strip = Image.new('RGB', (per * w + (per - 1) * 6, ((len(picks) + per - 1) // per) * (h + LABEL + 6)), (60, 60, 60))
    for k, im in enumerate(picks):
        strip.paste(im, ((k % per) * (w + 6), (k // per) * (h + LABEL + 6)))
    strip.save(f'{out}/{folder}/{name}-strip.png')

    sections[c['kind']].append(f'| {name} | {c["shows"]} | ![{name}]({folder}/{name}.gif) |')
    print(f'{folder}/{name}.gif  ({len(frames)} frames)')

open(f'{out}/README.md', 'w', encoding='utf-8').write('\n'.join(readme + sections['emotion'] + [''] + sections['action']) + '\n')
os.remove(f'{out}/frames.json')
print(f'{out}/README.md')
