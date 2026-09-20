<!-- fragmt:begin v1 -->
## fragmt – docs environment for this repo
These docs are maintained through fragmt (git-native drafting).
Rules for agents:
- NEVER edit docs on main directly – main is protected. Run `fragmt agent draft <doc>` first; merge when done.
- NEVER hand-edit `.docs/comments/*.json` sidecars – use `fragmt agent comment`.
- On `comment` and `verify`, pass `--author "Your Name <you@example.invalid>"` so your work is attributable (`draft` takes none).
- State check: `fragmt agent status`. Doc bodies are plain markdown – read them directly.
- Verify a reviewed doc with `fragmt agent verify <doc> --as-actor "<producer>/<version>"` – the actor is your self-declaration, never a false `human:`.
- New anchored comment threads are a UI act (they need a text selection); reply and resolve via the CLI.
<!-- fragmt:end -->
