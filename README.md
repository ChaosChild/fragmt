# fragmt

A git-native documentation environment for small dev teams, start-ups, and solo
developers — an affordable alternative to Notion, AppFlowy, and other expensive
documentation tools. **Your GitHub repo is the storage**: docs stay plain
markdown, readable on GitHub, diffable, reviewable via PRs, and directly usable
by AI coding agents.

**What this is not:** an open-source Notion clone (only the editing UX is
Notion-style), and not a CMS. The emphasis is documentation. Nearest relative:
Wiki.js — differentiated by being **agentic-ready from the ground up** (CLI, MCP
server, and agent-in-the-UI are first-class citizens of one core library).

## How it works

- `fragmt init` runs inside a git clone, adopts the existing markdown, and
  writes `.fragmt.json`.
- `fragmt serve` starts a local web UI over those files.
- Notion-style WYSIWYG editing over plain markdown; save = git commit; drafts =
  branches; review = PRs.
- Inline comments anchored as editor marks, threads stored in versioned sidecar
  files — no comment backend.
- v2: same binary hosted for teams; GitHub OAuth for identity; GitHub
  collaborator permissions as access control.

## Status

**Early — read-only.** Not published to npm yet; run it from source.

| Milestone | State |
| --- | --- |
| M0 — environment prep | shipped |
| M1 — read-only (init, serve, tree + doc API, UI shell) | shipped |
| M2 — round-trip editing | next, and the riskiest milestone |
| M3–M5 — files & branches, comments, dogfood hardening | specced |

Today you can browse a repo's docs in the UI. You cannot edit them yet — that's
M2. v1 is done when the author writes this project's own docs in the tool daily
instead of in a text editor.

## Try it

Requires Node 22+.

```sh
git clone https://github.com/ChaosChild/fragmt.git
cd fragmt
npm ci
npm run build

# adopt this repo's own docs, then browse them
npx tsx src/cli/index.ts init
npx tsx src/cli/index.ts serve --port 4400
```

Then open the printed URL. Point it at your own docs by running the same two
commands from inside any git clone that contains markdown — add `init --root
docs` to scope it to a subfolder.

## Documentation

- [Product requirements](docs/REQUIREMENTS.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Design principles](docs/DESIGN.md)
- [v1 build plan](docs/PLAN.md) — and the per-milestone specs under
  [`docs/milestones/`](docs/milestones/)
- [Editor spike](docs/SPIKE.md) — markdown round-trip fidelity; Tiptap chosen
  over BlockNote

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The build plan is public and
milestone-shaped, so the most useful contribution right now is feedback on the
specs before the code exists.

## License

MIT — see [LICENSE](LICENSE). Copyright (c) 2026 Andrei Migatchev and
[contributors](https://github.com/ChaosChild/fragmt/graphs/contributors).
