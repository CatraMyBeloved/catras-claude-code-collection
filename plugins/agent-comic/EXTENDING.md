# Extending agent-comic: places

agent-comic is the base of a small world. Between turns Claude is at home in the **hub**.
Other plugins can add **places** to that world: a garden, a pond to fish in, a minigame,
anything that draws into the band above the prompt. Wooden signs in the band's top corners
lead from stop to stop; `a` and `d` follow them once the band has the keyboard (ctrl+x tab,
or a click in the fullscreen terminal).

While Claude works, the comic plays the turn as always, wherever Claude was. Once the turn's
closing scene is over, the band goes back to the place he was at.

**With no place installed, nothing changes.** The comic doesn't depend on any place, and the
ring is just the hub.

A complete, tested example is **pond-place**: Claude fishes at a little pond. It lives beside this
plugin ([examples/pond-place](../../examples/pond-place) in the marketplace repo). Copy it as a starting point.

## How it fits together

```
 ring of stops:   Hub ──▸ garden ──▸ pond ──▸ (back to Hub)
                   ▲ sorted by id, so signs never jump

 between turns:   the stop in `here` draws the band
                  the hub is the comic itself; any other stop is a place plugin
 during a turn:   the comic draws the band, whatever `here` says
```

A place plugin does five things:

1. **Sign on** at each `session.start`: `$.comic.addPlace({ id, name })`. `id` is your plugin's
   name and `name` is the word on the signs (up to 16 characters).
2. **Draw only when it is your turn.** Draw the `AbovePrompt` band only while the comic's
   `here` is your id, its `state` is `'idle'`, and `e.props.isWorking` is false. Otherwise
   return `next(e)` so the comic, or the next plugin, draws.
3. **Say you are alive** once a second while you draw: `$.comic.alive({ id, name })`. If a place
   is silent for more than 5 seconds, Claude goes home to the hub, so the band is never left
   empty by a place that failed or was uninstalled.
4. **Draw your signs and follow them.** `$.comic.route()` gives the stops to the left and right
   (null means no sign). On a press, call `$.comic.step({ dir: -1 | 1 })`.
5. **Let Claude walk in** from the side he came from: the comic's `cameFrom` state is `-1`
   (from the left edge), `1` (from the right) or `null`.

## Quick start

`.claude-plugin/plugin.json`. Listing agent-comic under `dependencies` types `$.comic` and
the comic's state for you:

```json
{
  "name": "my-place",
  "version": "0.1.0",
  "description": "A place in the agent-comic world",
  "dependencies": ["agent-comic"]
}
```

`hooks/hooks.json`: `{ "modules": ["./register.tsx"] }`

`hooks/register.tsx`, the minimum:

```tsx
import type { Register } from 'claude-code'

const PLACE = { id: 'my-place', name: 'My place' }
let isDrawing = false

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      await $.comic.addPlace(PLACE)
    } catch {
      // agent-comic is not installed or is off: decide whether to draw on your own
    }
    $.clock.every(1000, async () => {
      if (isDrawing) await $.comic.alive(PLACE).catch(() => undefined)
    })
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // reading the comic's state here redraws the band whenever it changes
    const here = (await $.state.get({ plugin: 'agent-comic', key: 'here' })).value
    const state = (await $.state.get({ plugin: 'agent-comic', key: 'state' })).value
    isDrawing = here === PLACE.id && state === 'idle' && !e.props.isWorking && e.surface === 'terminal'
    if (!isDrawing) return next(e)
    const { Text } = $.ui.resolve(e)
    return <Text>Claude is somewhere new.</Text>
  })
}
```

## The interface

The contract is `types/index.d.ts` in this plugin. Every call goes through the hook chain, so
each one returns a promise.

| `$.comic.…` | What it does |
|---|---|
| `version()` | `1`. It only grows when something is added; nothing that's here changes. |
| `addPlace({ id, name })` | Puts the place on the ring, or renames it. Safe to call again. |
| `removePlace({ id })` | Takes it off the ring. If Claude was there, he goes home to the hub. |
| `places()` | The ring in order: the hub (`id: null`) first, then the places by id. |
| `route()` | `{ left, right }`: the stops beside where Claude is now, `null` where there's no sign. |
| `go({ id })` | Goes to a place, or home with `id: null`. An unknown id is ignored. |
| `step({ dir })` | Follows the sign on that side (`-1` left, `1` right), if there is one. |
| `alive({ id, name })` | "Still drawing." Also puts the place back on the ring if the comic reloaded and lost it. |
| `kit()` | The comic's art: Claude's frames, hats, sign colours, palette (see below). |

State to read with `$.state.get({ plugin: 'agent-comic', key })`. A read while drawing
subscribes, so the band redraws when the value changes:

| key | values |
|---|---|
| `state` | `'working'` a turn runs · `'wrapping'` its closing scene (or a /comic-demo, /comic-feel) plays · `'idle'` the band is free · `'hidden'` nothing shows between turns (the comic is off, or "Show when idle" is) |
| `here` | `null` (or unset) for the hub, else a place's id |
| `cameFrom` | `-1`, `1` or `null`: the edge Claude came in from |
| `places` | the ring, as `places()` returns it |

The signs between stops follow a fixed rule. With the hub alone there are none. With one place,
the hub has a sign on the right and the place a sign on the left. With more, every stop has
both, wrapping around the ring.

## Drawing so it looks like one world

- **Size:** the comic draws a `Raster` of `min(10, e.props.maxRows - 1)` rows (it shows
  nothing below 6) and `e.props.bodyColumns - 5` columns, then a 4-column side column of
  hotkey buttons. Use the same, and the band won't jump when Claude walks between places.
- **Art:** `await $.comic.kit()` once at session start. `claude.stand / blink / happy / asleep /
  wave` and the 4-frame `claude.walk` are 11×7 pixels, facing right (mirror each row to face
  left), coloured by `claude.palette`. Hats sit `sit` rows over his head. `sign` has the
  wooden signs' colours and `palette` the comic's whole palette.
- **Pixels:** a cell is two pixels tall (half blocks). pond-place's `hooks/paint.ts` is a small
  painter that encodes a Raster's `cells` in the same format the comic uses. Copy it.
- **Animation:** draw the tree once, then repaint with `$.ui.blit({ requestId, key, cells })`
  on a timer, as the comic does, about every 50 to 100 ms.
- **Keys:** the comic uses `p` (pat), `a` and `d` (signs). Use `a`/`d` for your signs too, so
  walking around feels the same everywhere.

## Rules of the road

- Never draw while `state` isn't `'idle'`, or while `e.props.isWorking`. The working comic
  always gets the band.
- Always `return next(e)` when you don't draw, so plugins beneath you get their turn.
- Don't write the comic's state. Change things through `$.comic` calls.
- Keep working when the comic is missing: every `$.comic` call can throw then, so wrap them.
- Your place's id is your plugin's name. Two plugins with the same id replace each other.

## Testing a place

`claude plugin test` loads your plugin with inline plugins beside it. pond-place's
`hooks/pond.test.ts` loads a small stand-in named `agent-comic`: it provides `$.comic` and
sets `here` and `state` with a command, so you can check that your place draws exactly when it
should, sends `alive`, and steps on its signs.

## Sharing

Put your place in a marketplace repo like any plugin. People install it next to agent-comic:

```
/plugin install my-place --marketplace <owner>/<repo>
```

## Not extendable yet

Places are the first extension point. Things a plugin can't add yet, and the likely next steps:

- **Props, hats and settings inside the comic's own scenes**: registering art and a hint for
  the director as data.
- **Behaviours**: named combinations of existing beats, then keyframe animations.
- **Reactions**: mapping your own tools to what Claude acts out while he works.

If you need one of these, open an issue on the marketplace repo.
