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
Wiki.js — differentiated by being **agentic-ready from the ground up**: the
agent surface is the CLI itself (`fragmt agent`), riding the same core library
as the UI.

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

**Early — editing works.** The npm publish that makes `npx fragmt` real is
the current milestone — until the first tag lands, run it
[from source](#development).

| Milestone | State |
| --- | --- |
| M0 — environment prep | shipped |
| M1 — read-only (init, serve, tree + doc API, UI shell) | shipped |
| M2 — round-trip editing (Tiptap, save = commit) | shipped |
| M2-2 — editing controls (bubble, slash, right-click) | shipped |
| M3 — files & branches | shipped |
| M4 — inline comments | shipped |
| M4-2 — dogfood polish (cards, headers, protected main, merge) | shipped |
| M4-3 — backlog remediation (header file actions, titles, drag & drop, links, gitignore) | shipped |
| M4-4 — backlog 2 + agent surface (merge resolution in-UI, `fragmt agent` CLI, AGENTS.md) | shipped |
| M5 — distributables & install (npm publish, GitHub Releases, npx-first) | in progress — machinery merged, first tag pending |
| M6 — dogfood hardening | specced |

Today you can browse a repo's docs in the UI, edit them in a Notion-style
WYSIWYG editor, and save — each save is a git commit under your local git
identity, with frontmatter preserved byte-for-byte and a stale-base-hash guard
against concurrent edits. Formatting is mouse-reachable — a selection or
right-click bubble for headings, quotes, links, and table structure, a `/`
menu for inserting blocks and images — no markdown knowledge required. Docs
and folders have a full lifecycle (create, rename/move, delete — one commit
each); branches can be created and switched in the UI for drafting, and the
server keeps the local clone synced with its remote (pull --rebase + push,
never force) on an interval, on focus, and before editing. Inline comments
anchor to text as marks in the markdown itself, with threads versioned in
JSON sidecars — comment from read mode or edit mode, replies and resolve in
the right-margin rail, orphans detected against the live document.

**Main is protected** — whether the branch actually is or not. Editing (or
commenting on, or creating) a doc on main automatically starts a draft
branch (`drafts/<doc>`, no prompt) and the write lands there; the sidebar
marks drafted docs with chips and ghost cards, the doc head shows author,
version, branch, and sync state, and a global **Merge** button lands a
finished draft on main and deletes its branch (conflicts abort cleanly).
Deletions are reversible from the sidebar's recycle bin, `@` references
insert navigable doc links, and comment actions are one git commit each.

**Docs carry human titles.** The name in the content header is the
frontmatter `title:` when present, else the filename — and the same rule
feeds the sidebar cards and the `@` menu. Renaming edits the title in one
commit; the file itself is never renamed, so existing links keep working.
Move and delete sit beside rename as header icons, and the whole file
lifecycle is also draggable — rows onto folders (move), onto the tree
background (move to the root), onto the bin (delete, with a confirm). The
sidebar resizes, keeps nested cards readable at any depth, and respects
`.gitignore` — ignored folders never appear on any tree-derived surface,
while force-added tracked files still do. Links inside docs all go
somewhere sane: in-app navigation with `#heading` anchors, folder links,
non-markdown files served raw in a new tab, and a quiet note for dead
ones. Dead draft branches delete from the dropdown (`-d`, asking twice
before `-D` on unmerged), an optional `authors` map in `.fragmt.json`
resolves avatars for real email addresses, and failures surface as a
banner in the content pane — never silence.

**Merge conflicts resolve in the tool.** When a draft's merge into main
conflicts, the merge stands and the UI becomes a resolution view: per-hunk
ours/theirs choices (or a free-edit box) for docs, a structural merge with
one-click overrides for comment sidecars, and a single conclude-merge commit
when everything is staged. While a merge stands, every other write is
refused — the resolution owns the repo. Conflicts in files fragmt can't
resolve (non-docs) abort cleanly with an honest message instead.

**Agents are first-class users.** `fragmt agent` is an AXI-style CLI surface
for AI coding agents: `status` reads branch/draft/merge state, `comment`
lists and replies on threads (sidecars are never hand-edited), `draft`
starts and merges — with token-lean output and next-step hints. Mutations
take `--author "Your Name <you@example.invalid>"` so an agent's commits and
comments carry its identity, and an optional `agents` list in
`.fragmt.json` marks those authors with a chip in the UI. `fragmt init`
also writes a delimited fragmt block into `AGENTS.md` (created if absent,
appended if the file exists) teaching any agent the drafting rules.
v1 is done when the author writes this project's own
docs in the tool daily instead of in a text editor. Full detail, including
what was deliberately cut, is in the [build plan](docs/PLAN.md).

## Quickstart

Requires **Node 22+** and a git clone containing markdown. Run both commands
from inside the repo whose docs you want to edit:

```sh
npx fragmt init
npx fragmt serve
```

A global install works the same: `npm i -g fragmt`, then `fragmt init` and
`fragmt serve`.

`init` prints what it adopted:

```
Initialized fragmt
  docs root: .
  22 markdown files
```

`serve` prints the URL to open. The tool always operates on the repo it is
run in — point it at your own docs by running the same two commands from
inside any git clone.

> **Platforms:** v0.x is tested on Windows; Linux and macOS verification is
> the next milestone's opening act. Reports from those platforms are welcome.

To run from source instead, see [Development](#development).

## CLI

```
fragmt init [--root <path>]
fragmt serve [--port <n>]
fragmt agent [status]
fragmt agent comment <doc> [--thread <id>] [--body <text>] [--resolve] [--author <who>] [--full]
fragmt agent draft <doc> [--merge]
fragmt --help
```

| Command | Notes |
| --- | --- |
| `init` | Must run inside a git clone. Writes `.fragmt.json` at the repo root and reports how many markdown files were adopted. Never overwrites an existing config — a second run prints `already initialized` and exits 0. Also writes the fragmt block into `AGENTS.md` (see [Agents](#agents)). |
| `init --root docs` | Scope fragmt to a subfolder instead of the whole repo. The path must be a directory inside the repo. |
| `serve` | Requires `init` to have run. Binds a free port chosen by the OS and prints the URL. |
| `serve --port 4400` | Pin the port. |

The `agent` verbs are the machine surface — see [Agents](#agents).

## Agents

AI coding agents are first-class users. The contract is the `fragmt agent`
CLI (AXI-style: token-lean output, aggregates inline, `help[]` next-step
hints, errors on stdout, exit codes 0/1/2, no interactive prompts) — not the
HTTP API, which stays the UI's private transport.

| Verb | What it does |
| --- | --- |
| `fragmt agent status` | Branch, protected-main mark, draft map, merge state. |
| `fragmt agent comment docs/x.md` | Lists threads (`id, author, resolved, replies`); `--thread <id>` shows detail with `--full` for untruncated bodies. |
| `fragmt agent comment docs/x.md --thread <id> --body "…" --author "Z <z@ex.invalid>"` | Adds a reply as that author (one commit, sidecar updated atomically). |
| `fragmt agent comment docs/x.md --thread <id> --resolve` | Resolves a thread. |
| `fragmt agent draft docs/x.md` | Starts (or reuses) the doc's draft branch. |
| `fragmt agent draft docs/x.md --merge` | Merges the draft into main. |

Doc bodies are plain markdown — agents read and diff them directly; the CLI
matters for drafts, comments, and merge state. New anchored comment threads
stay a UI act (they need a text selection). Mutations accept `--author`
(git-style `Name <address>`; a bare name gets a deterministic noreply
address) so an agent's commits and comment replies carry its identity
instead of the operator's — add the agent's display name to the `agents`
list in `.fragmt.json` and the UI marks its comments with an `agent` chip.

`fragmt init` writes the rules into `AGENTS.md` — the file is created if
absent, or a delimited `<!-- fragmt:begin -->…<!-- fragmt:end -->` block is
appended to an existing one; nothing outside the markers is ever touched,
and re-running `init` refreshes the block.

## Configuration

`.fragmt.json` lives at the git repo root and is the whole configuration
surface:

```json
{
	"docsRoot": ".",
	"order": {},
	"authors": {
		"you@example.com": "YourGitHubUsername"
	},
	"agents": ["ZCode"]
}
```

- **`docsRoot`** — path, relative to the repo root, that fragmt treats as the
  documentation tree. `"."` means the entire repo.
- **`order`** — reserved for explicit doc ordering (v1.x). Always `{}` for now.
- **`authors`** — optional map of commit emails to GitHub usernames; avatars
  resolve through it before the keyless `@users.noreply.github.com` heuristic.
  Invalid entries are ignored; the whole key is optional.
- **`agents`** — optional list of agent display names; comments authored by
  these names render with an `agent` chip in the UI. Invalid entries are
  ignored.

Parsing is strict: a malformed or incomplete config fails loudly with the file
path rather than falling back to a silent default.

## HTTP API

The UI never touches the filesystem — it talks to the server over this API
only. (The agent surface is the CLI, not this API — see
[Agents](#agents).)

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

Tree rules: dot-folders, `node_modules`, and `dist` are skipped; anything a
`.gitignore` excludes disappears too (one `git ls-files` allow-list per
refresh — tracked files always win over ignore rules); directories with no
markdown anywhere beneath them are pruned, unless they hold a `.gitkeep`
(a folder created for docs about to be written stays visible); directories
sort before documents, both alphabetically and case-insensitively.

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

From source (the contributor path) — after this, `npx fragmt …` works like
the installed one:

```sh
git clone https://github.com/ChaosChild/fragmt.git && cd fragmt
npm ci && npm run build
npx fragmt init && npx fragmt serve
```

The dev loop:

```sh
npm run dev:server   # API on :4400 (no watch — branch ops in the managed repo would restart a watcher mid-request)
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
