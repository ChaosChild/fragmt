# fragmt

[![CI](https://github.com/ChaosChild/fragmt/actions/workflows/ci.yml/badge.svg)](https://github.com/ChaosChild/fragmt/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A5%2022-brightgreen.svg)](package.json)
[![Status](https://img.shields.io/badge/status-early%20%C2%B7%20editing--works-orange.svg)](docs/PLAN.md)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

A git-native documentation environment for small dev teams, start-ups, and solo
developers — an affordable alternative to Notion, AppFlowy, and other expensive
documentation tools. **Your GitHub repo is the storage**: docs stay plain
markdown, readable on GitHub, diffable, reviewable via PRs, and directly usable
by AI coding agents.

**What this is not:** an open-source Notion clone (only the editing UX is
Notion-style), and not a CMS. The emphasis is documentation. Nearest relative:
Wiki.js — differentiated by being **agentic-ready from the ground up** (CLI, MCP
server, and agent-in-the-UI are first-class citizens of one core library).

## Why

Documentation tools make you choose between a nice editor and owning your
content. Notion and Confluence give you the editor and keep the content in their
database — export is lossy, diffs don't exist, and your AI coding agent can't
read any of it without an API integration. Plain markdown in git gives you
ownership, review, and agent-readability, but the editing experience is a text
editor.

fragmt refuses the trade. The files on disk are ordinary markdown in your own
repo — nothing proprietary, nothing to migrate off, no database. The editor on
top is Notion-style. Delete fragmt tomorrow and you still have a folder of
markdown and its full git history.

| | Notion / Confluence | Raw markdown + editor | fragmt |
| --- | --- | --- | --- |
| Storage | vendor database | your repo | your repo |
| Editing | WYSIWYG | text editor | WYSIWYG |
| Diff / review | none | `git diff` / PRs | `git diff` / PRs |
| Agent-readable | via API | yes | yes, first-class |
| Cost at 5 seats | per-seat, monthly | free | free |

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

**Early — editing works.** Not published to npm yet; run it from source.

| Milestone | State |
| --- | --- |
| M0 — environment prep | shipped |
| M1 — read-only (init, serve, tree + doc API, UI shell) | shipped |
| M2 — round-trip editing (Tiptap, save = commit) | shipped |
| M2-2 — editing controls (bubble, slash, right-click) | shipped |
| M3 — files & branches | shipped |
| M4 — inline comments | specced |
| M5 — dogfood hardening | specced |

Today you can browse a repo's docs in the UI, edit them in a Notion-style
WYSIWYG editor, and save — each save is a git commit under your local git
identity, with frontmatter preserved byte-for-byte and a stale-base-hash guard
against concurrent edits. Formatting is mouse-reachable — a selection or
right-click bubble for headings, quotes, links, and table structure, a `/`
menu for inserting blocks and images — no markdown knowledge required. Docs
and folders have a full lifecycle (create, rename/move, delete — one commit
each); branches can be created and switched in the UI for drafting, and the
server keeps the local clone synced with its remote (pull --rebase + push,
never force) on an interval, on focus, and before editing. v1 is done when the author writes this project's own
docs in the tool daily instead of in a text editor. Full detail, including
what was deliberately cut, is in the [build plan](docs/PLAN.md).

## Quickstart

Requires **Node 22+** and a git clone containing markdown.

```sh
git clone https://github.com/ChaosChild/fragmt.git
cd fragmt
npm ci
npm run build

# adopt this repo's own docs, then browse them
npx tsx src/cli/index.ts init
npx tsx src/cli/index.ts serve --port 4400
```

`init` prints what it adopted:

```
Initialized fragmt
  docs root: .
  14 markdown files
```

`serve` prints the URL to open. Point fragmt at your own docs by running the
same two commands from inside any git clone — the tool always operates on the
repo it is run in.

## CLI

```
fragmt init [--root <path>]
fragmt serve [--port <n>]
fragmt --help
```

| Command | Notes |
| --- | --- |
| `init` | Must run inside a git clone. Writes `.fragmt.json` at the repo root and reports how many markdown files were adopted. Never overwrites an existing config — a second run prints `already initialized` and exits 0. |
| `init --root docs` | Scope fragmt to a subfolder instead of the whole repo. The path must be a directory inside the repo. |
| `serve` | Requires `init` to have run. Binds a free port chosen by the OS and prints the URL. |
| `serve --port 4400` | Pin the port. |

## Configuration

`.fragmt.json` lives at the git repo root and is the whole configuration
surface:

```json
{
	"docsRoot": ".",
	"order": {}
}
```

- **`docsRoot`** — path, relative to the repo root, that fragmt treats as the
  documentation tree. `"."` means the entire repo.
- **`order`** — reserved for explicit doc ordering (v1.x). Always `{}` for now.

Parsing is strict: a malformed or incomplete config fails loudly with the file
path rather than falling back to a silent default.

## HTTP API

The UI never touches the filesystem — it talks to the server over this API
only, which also makes it the seam for the planned MCP server.

| Method | Route | Returns |
| --- | --- | --- |
| `GET` | `/api/tree` | The folder tree rooted at `docsRoot` |
| `GET` | `/api/docs/<path>` | One doc, frontmatter split from body, plus `hash` |
| `PUT` | `/api/docs/<path>` | Save: commit the body, return `{ sha, hash }` |

```jsonc
// GET /api/tree
{
  "name": ".", "path": "", "type": "dir",
  "children": [
    { "name": "docs", "path": "docs", "type": "dir", "children": [
      { "name": "PLAN.md", "path": "docs/PLAN.md", "type": "doc" }
    ]},
    { "name": "README.md", "path": "README.md", "type": "doc" }
  ]
}

// GET /api/docs/docs/PLAN.md
{ "path": "docs/PLAN.md", "frontmatter": { "title": "..." }, "markdown": "# ...", "hash": "…" }

// PUT /api/docs/docs/PLAN.md
// request: { "markdown": "# ...", "baseHash": "<hash from GET>" }
// response: { "sha": "40-hex commit sha", "hash": "…" }   // new baseHash
```

Tree rules: dot-folders, `node_modules`, and `dist` are skipped; directories
with no markdown anywhere beneath them are pruned; directories sort before
documents, both alphabetically and case-insensitively.

Errors are typed rather than generic. A path that escapes `docsRoot` or does
not end in `.md` is a **400**, including percent-encoded forms such as
`..%2f` — the traversal guard inspects the raw request line before framework
normalization can collapse the segments. A well-formed path with no file behind
it is a **404**. Saves carry a `baseHash` (the sha256 of the body as loaded):
if the file changed on disk in between — another tool, another save, git —
the save is a **409** and the file is left untouched. A missing git identity
(`user.name`/`user.email` unset anywhere git looks) is also a **409** — fragmt
never invents a commit author.

## Project layout

```
src/core/     filesystem, config, git — no HTTP, no process I/O
src/server/   Hono routes: parse request → call core → serialize
src/cli/      argv parsing and process exit codes
ui/           React + Vite; talks to the server only over /api
tests/        Vitest, against real temp dirs (no fs mocks)
docs/         requirements, architecture, design, milestone specs
spikes/       throwaway experiments; excluded from lint and typecheck
```

Built on TypeScript, Node 22, [Hono](https://hono.dev), React 19 + Vite,
[Tiptap 3](https://tiptap.dev) + [tiptap-markdown](https://github.com/aguingand/tiptap-markdown)
for the editor, and
[gray-matter](https://github.com/jonschlinkert/gray-matter) for frontmatter.
Git is a thin `execFile` wrapper around system git — no libgit2, no
isomorphic-git. Tiptap was chosen over BlockNote because it survived the
[round-trip spike](docs/SPIKE.md).

## Development

```sh
npm run dev:server   # API on :4400
npm run dev:ui       # UI on :5173, proxies /api
npm run typecheck
npm test
npx biome ci .
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full loop and conventions.

## Documentation

- [Product requirements](docs/REQUIREMENTS.md) — who it's for and what v1 owes them
- [Architecture](docs/ARCHITECTURE.md) — storage model, comment anchoring, git layer
- [Design principles](docs/DESIGN.md) — UI tokens, reading column, sidebar spec
- [v1 build plan](docs/PLAN.md) — milestones, risks, and what was cut
- [Backlog](docs/BACKLOG.md) — deferred issues and enhancements from dogfooding
- [Milestone specs](docs/milestones/) — implementation-exact, M0 through M5
- [Editor spike](docs/SPIKE.md) — markdown round-trip fidelity; why Tiptap won

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The build plan is public and
milestone-shaped, so the most useful contribution right now is feedback on the
specs before the code exists. Open an issue before a large PR — scope is
deliberately tight, and the "Cut from v1" table in the plan is load-bearing.

## License

MIT — see [LICENSE](LICENSE). Copyright (c) 2026 Andrei Migatchev and
[contributors](https://github.com/ChaosChild/fragmt/graphs/contributors).
