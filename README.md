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

| Plugin | Description |
| --- | --- |
| [agent-comic](plugins/agent-comic) | A pixel comic above the prompt: Sonnet turns what the main agent is doing into animated scenes. |

## Development

```
claude plugin validate .
```

## License

[GPL-3.0](LICENSE). Copyright (c) 2026 Ole Stein.
