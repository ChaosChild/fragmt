<!-- fragmt:begin v1 -->
## fragmt — docs environment for this repo
These docs are maintained through fragmt (git-native drafting).
Rules for agents:
- NEVER edit docs on main directly — main is protected. Run `fragmt agent draft <doc>` first; merge when done.
- NEVER hand-edit `.docs/comments/*.json` sidecars — use `fragmt agent comment`.
- ALWAYS pass `--author "Your Name <you@example.invalid>"` so your work is attributable.
- State check: `fragmt agent status`. Doc bodies are plain markdown — read them directly.
- New anchored comment threads are a UI act (they need a text selection); reply and resolve via the CLI.
<!-- fragmt:end -->
