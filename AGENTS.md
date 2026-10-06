<!-- fragmt:begin v1 -->
## fragmt – docs environment for this repo
These docs are maintained through fragmt (git-native drafting).
Rules for agents:
- NEVER edit docs on main directly – main is protected. Run `fragmt agent save <doc> --file <body>` (it drafts automatically) or `agent draft <doc>` first; merge when done.
- NEVER hand-edit `.docs/comments/*.json` sidecars – use `fragmt agent comment`.
- ALWAYS pass `--author "Your Name <you@example.invalid>"` so your work is attributable.
- State check: `fragmt agent status`. Doc bodies are plain markdown – read them directly.
- Verify a reviewed doc with `fragmt agent verify <doc> --as-actor "<producer>/<version>"` – the actor is your self-declaration, never a false `human:`.
- Doc-level comment threads can start from the CLI (`agent comment <doc> --body "…"`); anchored threads still need a text selection in the UI – reply and resolve via the CLI either way.
- Write paragraph prose unwrapped – one line per paragraph. Hard-wrapped text reflows wholesale on the first UI save, drowning that diff.
<!-- fragmt:end -->
