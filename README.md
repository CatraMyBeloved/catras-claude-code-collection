# catras-claude-code-collection

A Claude Code plugin marketplace with my mods and plugins.

## Install

```
/plugin marketplace add CatraMyBeloved/catras-claude-code-collection
/plugin install agent-comic@catras-claude-code-collection
```

The repo is private, so git must be authenticated (e.g. `gh auth login`). If the SSH attempt fails,
set `CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1`.

## Plugins

### [agent-comic](plugins/agent-comic)

A pixel comic in the band above the prompt: a little Claude acts out what the agent is doing.

- **Home hub**: each session opens at Claude's home: a hall with keepsakes from earlier sessions, a garden
  and a den. While nothing is happening he keeps himself busy at random, like a screensaver: he waters the
  flowers, watches a film on the couch, lies down in bed for a rest, or strolls past his keepsakes. On any
  new turn he drops everything and sprints through the door (there is one in every room) into the turn's
  world; after a long idle he comes back home.
  Claude can add a keepsake (a trophy, a gem, a plant...) after a real milestone, with the mod's own
  tool (`hub_add`, deferred, so it costs no context until used); the hub keeps six. `/comic-hub` lists them.
- **Pet him**: click the ♥ beside the band (or `/comic-pet`): he lights up, and a headpat is sent as your message ("Here, have a headpat. You are doing amazing!"), which Claude answers.
- **Needs you**: when a permission prompt or a question is waiting, he stops, turns to you and waves.
- **Progress**: the agent's task list shows as a trail along the ground, with a flag at the end.
- **Git**: a commit plants a little flag, a push lets a balloon go.
- **Sky**: the local hour (moon at night, low sun at dusk) and the session's weather (clouds after
  failures, rain after several), kept in the background.
- **Director**: `hybrid` (default) has the model stage each turn's opening and wrap-up, and plays canned
  scenes in between; `full` stages everything with the model; `off` uses no tokens at all.
  Set it with `/config`, along with the model, pace and whether the comic stays up between turns.

Commands: `/comic` (on/off), `/comic-pet`, `/comic-hub`, `/comic-stats`, `/comic-feel <mood>`, `/comic-demo`.

## Development

```
claude plugin validate .
```

## License

[GPL-3.0](LICENSE). Copyright (c) 2026 Ole Stein.
