# catras-claude-code-collection

A Claude Code plugin marketplace with my mods and plugins.

## Install

```
/plugin marketplace add CatraMyBeloved/catras-claude-code-collection
/plugin install agent-comic@catras-claude-code-collection
/plugin install cache-keepalive@catras-claude-code-collection
```

The repo is private, so git must be authenticated (e.g. `gh auth login`). If the SSH attempt fails,
set `CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1`.

## Plugins

### [agent-comic](plugins/agent-comic)

A pixel comic in the band above the prompt: a little Claude acts out what the agent is doing.

- **Home hub**: each session opens at Claude's home: a hall with keepsakes from earlier sessions, a garden
  and a den. While nothing is happening he keeps himself busy at random, like a screensaver: he waters the
  flowers, watches a film on the couch, lies down in bed for a rest, or strolls past his keepsakes. On any
  new turn he drops everything and sprints through the door (there is one in every room) into the session's
  world; after a long idle he comes back home.
  Claude can add a keepsake (a trophy, a gem, a plant...) after a real milestone, with the mod's own
  tool (`hub_add`, deferred, so it costs no context until used); the hub keeps six. `/comic-hub` lists them.
- **Pet him**: the ♥ beside the band (click it in fullscreen mode, or press ctrl+x tab, then p), or `/comic-pet`: he lights up, and a headpat is sent as your message ("Here, have a headpat. You are doing amazing!"), which Claude answers.
- **One world per session**: the session's first turn sets up a place (a setting, a hat and four props) and
  every later turn plays in it, so the story can call back to earlier turns. The director owns it and changes it
  rarely, as part of a scene, when the work really shifts: he lifts a prop overhead and, with a puff, it becomes
  something new (up to 6 per session); a puff over his head brings a new hat (up to 4); or he summons a door and
  walks through it into new scenery (up to 2). Canned scenes never change it, and nothing is ever squashed away.
  After a long idle he goes home, and the next turn takes him back into the same world.
- **Needs you**: when a permission prompt or a question is waiting, he stops, turns to you and waves.
- **Progress**: the agent's task list shows as a trail along the ground, with a flag at the end.
- **Git**: a commit plants a little flag, a push lets a balloon go.
- **Sky**: the local hour (moon at night, low sun at dusk) and the session's weather (clouds after
  failures, rain after several), kept in the background.
- **Director**: `hybrid` (default) has the model set up the session's world and stage each turn's opening and
  wrap-up in it, and plays canned scenes in between; `full` stages everything with the model; `off` uses no tokens at all.
  Set it with `/config`, along with the model, pace and whether the comic stays up between turns.
- **Places**: other plugins can add places to Claude's world through `$.comic` (a garden, a pond, a minigame).
  Between turns, wooden signs in the hub's top corners lead to them (`a`/`d` once the band has focus); while
  Claude works the comic takes the band back. With no place installed nothing changes. How to build one:
  [EXTENDING.md](plugins/agent-comic/EXTENDING.md); a complete example is [pond-place](examples/pond-place).

Commands: `/comic` (on/off), `/comic-pet`, `/comic-hub`, `/comic-stats`, `/comic-feel <mood>`, `/comic-demo`.

### [cache-keepalive](plugins/cache-keepalive)

Keeps Claude Code's prompt cache warm while you think, so the next prompt reads the conversation from the
cache instead of paying to write it again.

- **Countdown**: the prompt footer shows how long the cache stays warm, e.g. `cache ▰▰▰▰▰▰▱▱ 41:12 (1h)`,
  in calm tones: sage green, sand yellow for the last 10 minutes, dusty rose for the last 3 (a 5-minute
  cache keeps the same proportions). The timer restarts with every request of the main conversation.
- **Keep-alive**: shortly before the cache expires (20s by default), and only while Claude is idle, it sends
  one message asking Claude for a minimal acknowledgement. That request re-reads the cache and restarts its
  lifetime. After 90 minutes without a prompt from you it lets the cache lapse.
- **Lifetime**: `auto` follows Claude Code's own rules: `FORCE_PROMPT_CACHING_5M`, then
  `CLAUDE_CODE_PROMPT_CACHE_TTL`, the `promptCacheTtl` setting and `ENABLE_PROMPT_CACHING_1H`; otherwise
  1 hour on a subscription within plan limits and 5 minutes on an API key, a cloud provider or usage credits.
  The mod cannot always tell when a subscription draws on credits; set the lifetime to `5m` in `/config` then.
- **Gauge**: `/keepalive` opens a pane with the bar, the expiry time, the cached prefix size, a timeline of
  hits, misses and keep-alives, and buttons to ping now (p) or pause (k).

Commands: `/keepalive` (gauge), `/keepalive status`, `/keepalive on|off`, `/keepalive now`.
Set the mode (`prompt` or `off`), lifetime, lead and idle cutoff with `/config`.

Why a message and not an invisible side request: a side request (`$.model.fork`) re-sends the conversation,
but Claude Code caches it as a separate entry, so it never kept the main conversation's cache warm in testing.

## Development

```
claude plugin validate .
claude plugin test plugins/cache-keepalive
claude plugin test examples/pond-place
```

`examples/` holds example plugins that are not in the marketplace; copy one as a starting point.

`CACHE_KEEPALIVE_HEADLESS=1` lets cache-keepalive run under `claude -p --plugin-dir plugins/cache-keepalive`,
for checking its cache behaviour without an interactive session.

## License

[GPL-3.0](LICENSE). Copyright (c) 2026 Ole Stein.
