# fragmt

[![npm](https://img.shields.io/npm/v/fragmt.svg)](https://www.npmjs.com/package/fragmt)
[![CI](https://github.com/ChaosChild/fragmt/actions/workflows/ci.yml/badge.svg)](https://github.com/ChaosChild/fragmt/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A5%2022-brightgreen.svg)](package.json)

**Notion-style editing over the plain markdown already in your git repo.**

Your repo is the storage. Docs stay ordinary markdown – readable on GitHub,
diffable, reviewable through PRs, and directly usable by AI coding agents.
Every save is a git commit under your own identity. Delete fragmt tomorrow and
you still have a folder of markdown and its full history.

![fragmt editing a markdown document](docs/screenshot-lightmode.png)

```sh
npx fragmt init     # inside any git clone containing markdown
npx fragmt serve    # opens the editor
```

Requires Node 22+.

---

## Why

Documentation tools make you choose between a good editor and owning your
content.

Notion and Confluence give you the editor and keep the content in their
database – export is lossy, history lives in their pane instead of your
toolchain, and your coding agent can't read any of it without an API
integration. Plain markdown in git gives you ownership, review and
agent-readability, but the editing experience is a text editor.

fragmt refuses the trade.

|  | Notion / Confluence | Markdown + text editor | **fragmt** |
| --- | --- | --- | --- |
| Storage | vendor database | your repo | **your repo** |
| Editing | WYSIWYG | text editor | **WYSIWYG** |
| Diff and review | their version history | `git diff` / PRs | **`git diff` / PRs** |
| Agent-readable | via API | yes | **yes, first-class** |
| Cost at 5 seats | per seat, monthly | free | **free** |
| Self-host seat limit | capped or licensed | – | **none** |

**What it is not:** an open-source Notion clone – only the editing UX is
Notion-style – and not a CMS. The emphasis is documentation. Nearest relative is
Wiki.js, differentiated by being agentic-ready from the ground up: the agent
surface is the CLI itself, riding the same core library as the UI.

## What you get

- **Notion-style WYSIWYG** over plain markdown. Selection and right-click
  bubbles for headings, quotes, links and tables; a `/` menu for blocks and
  images. No markdown knowledge required.
- **Save is a commit.** Frontmatter preserved byte-for-byte, a stale-base-hash
  guard against concurrent edits, and your real git identity on every commit.
- **Main is protected**, whether the branch actually is or not. Editing a doc on
  main starts a draft branch automatically; a global **Merge** button lands it.
- **Merge conflicts resolve in the tool** – per-hunk ours/theirs or a free-edit
  box, structural merging for comment sidecars, one concluding commit.
- **Draft changes are visible** – on a draft branch, an amber bar marks every
  block the draft's commits touched, computed from `git diff` against main.
- **Inline comments** anchored to text as marks in the markdown itself, threads
  versioned in JSON sidecars. No comment backend.
- **Ctrl/Cmd+K search** across titles and bodies, and a side-by-side preview
  pane for reading one doc against another.
- **Full file lifecycle** – create, rename, move, delete, drag and drop, a
  recycle bin, `.gitignore` respected, `@` references between docs.
- **Agents are first-class users** – see [Agents](#agents).

## Install

```sh
npx fragmt init      # scaffold: writes .fragmt.json, adopts existing markdown
npx fragmt serve     # start the editor, prints the URL
```

Or globally: `npm i -g fragmt`, then `fragmt init` and `fragmt serve`.

`init` must run inside a git clone. It never overwrites an existing config – a
second run prints `already initialized` and exits 0. Scope it to a subfolder
with `fragmt init --root docs`. Or give the docs a repo of their own, nested
inside a code repo – see [Docs in a code repo](#docs-in-a-code-repo).

> **Platforms:** tested on Windows. Linux and macOS verification is in progress
> – reports from those platforms are welcome.

## Docs in a code repo

When the docs belong to a code repository, mixing docs commits into code
history gets old fast: separate PRs, tangled diffs, agents wading through it
all. fragmt can give the docs folder a git repo of its own, nested inside the
working tree:

```sh
fragmt init --folder docs --new   # docs/ becomes its own git repo
fragmt serve                      # run from docs/ – the outer repo is untouched
```

The folder is created if missing, and markdown already sitting there rides the
nested repo's initial commit – the outer repo's own history is left alone.
After creation, `init` offers to wire up an origin: paste a fresh GitHub or
GitLab URL and fragmt pushes the docs repo and stages it as a **submodule** in
the outer repo, so the host renders `docs/` as a linked folder and teammates
get everything with `git clone --recursive`. Skip the prompt and fragmt writes
a `.gitignore` entry instead and prints the exact commands for later – a
re-run of `init` offers the wiring again.

An `AGENTS.md` lands at **both** roots: the outer one tells coding agents the
docs live in the nested repo; the inner one carries the usual fragmt rules.
Running `serve` or `agent` from the outer root simply points you at the
folder.

## OKF mode

fragmt can maintain the doc bundle as an
[open-knowledge-format](https://github.com/GoogleCloudPlatform/open-knowledge-format)
(OKF v0.2) knowledge base: typed concept docs, a generated `index.md` per
directory, and the doc-to-doc reference graph kept as derived frontmatter.
Docs stay plain markdown – OKF is a file convention any tooling (and any
agent) can read directly.

```sh
fragmt init --okf      # enable on a fresh OR existing repo
fragmt validate        # print conformance findings, one per line
fragmt validate --fix  # apply the mechanical repairs in one commit
```

`init --okf` adopts, never rewrites: existing files are validated and the
findings printed, the `index.md` set and the reference fields are committed,
and `validate --fix` finishes adoption in a single pass. It composes with
`--folder --new` for a nested docs repo.

In OKF mode fragmt maintains:

- **Conformant defaults** – new docs are born with a `type: concept` and
  `status: draft` frontmatter block; any non-empty type is conformant.
- **Generated `index.md`** – per directory holding docs: concepts grouped
  under `# <Type>` sections with absolute links, regenerated on membership
  changes (create, move, rename, delete, merge) – never on content saves.
- **`references` / `referenced-by`** – frontmatter fields derived from body
  links, recomputed on every save. Body links stay canonical; the fields are
  a cache.
- **Trust stamping** – every save rewrites `generated: { by, at }`: `by` is
  the committing identity as `human:<email-local-part>`, or an agent's
  self-declared `--as-actor` string (default `fragmt-agent/unspecified` –
  a machine never claims a human's review). `verified` is an append-only
  event log with three affordances, each appending `{ by, at }` in the same
  commit as its act: resolving a comment thread, the doc head's Verify
  button, and Save as Verified beside Save.
- **Trust badges** – derived, never stored: doc cards and the doc head show
  the §5.3 tier (unverified / machine-confirmed / human-reviewed) from the
  `verified` actors, and a stale chip once `now >= stale_after`. An absent
  status renders nothing – stable is silence, never implied.
- **Metadata editor** – the doc head edits `type`, `description`, `tags`,
  `status`, and `stale_after` as fields, never raw YAML: one commit per
  save, existing YAML spliced line-wise (unknown keys byte-preserved).
  `status` is enum-only – `draft` / `stable` / `deprecated`, enforced at
  the API seam; the UI's select is convenience.
- **References pane** – the right pane's References mode lists the open
  doc's outgoing and incoming references; rows navigate the main pane while
  the pane stays open beside it.
- **Reserved names** – `index.md` and `log.md` never hold concepts; creates
  and renames targeting them are refused.

`validate --fix` prepends missing frontmatter, adds missing types, and
repopulates the derived fields in one commit – existing YAML is never
re-serialized. While non-conformant docs remain, the sidebar shows a banner
listing them by path and clause.

## CLI

```
fragmt init [--root <path>] [--folder <name>] [--new] [--okf]
fragmt serve [--port <n>] [--auth]
fragmt validate [--fix]
fragmt agent [status]
fragmt agent comment <doc> [--thread <id>] [--body <text>] [--resolve] [--author <who>] [--as-actor "<producer>/<version>"] [--full]
fragmt agent draft <doc> [--merge] [--as-actor "<producer>/<version>"]
fragmt --help
```

`serve --auth` turns the editor into a small multi-user server: GitHub
sign-in, your repo's collaborator permissions as access control, Docker
samples included – see [HOSTING](docs/HOSTING.md). Commit authors are
recognized by their GitHub avatar – automatically for signed-in users, and
via a two-line authors map in `.fragmt.json` for everyone else.

## Agents

AI coding agents are first-class users, and the contract is the `fragmt agent`
CLI – token-lean output, aggregates inline, next-step hints, exit codes 0/1/2,
no interactive prompts.

| Verb | What it does |
| --- | --- |
| `fragmt agent status` | Branch, protected-main mark, draft map, merge state |
| `fragmt agent comment docs/x.md` | List threads; `--thread <id>` for detail, `--full` for untruncated bodies |
| `fragmt agent comment docs/x.md --thread <id> --body "…"` | Reply on a thread (one commit) |
| `fragmt agent comment docs/x.md --thread <id> --resolve` | Resolve a thread |
| `fragmt agent draft docs/x.md` | Start or reuse the doc's draft branch |
| `fragmt agent draft docs/x.md --merge` | Merge the draft into main |

Doc bodies are plain markdown, so agents read and diff them directly; the CLI
matters for drafts, comments and merge state. Mutations accept `--author`
(`Name <address>`) so an agent's commits carry its own identity – list the name
under `agents` in `.fragmt.json` and the UI marks its comments with a chip.
In OKF mode, agents also self-declare the `generated` stamp's actor with
`--as-actor "<producer>/<version>"` (default `fragmt-agent/unspecified`) –
verbatim, never a false `human:` claim. `draft --merge` stamps the doc on
the draft branch before merging; `comment --resolve` appends the actor's
`verified` event beside the sidecar write.

`fragmt init` also writes a delimited `<!-- fragmt:begin -->…<!-- fragmt:end -->`
block into `AGENTS.md`, teaching any agent the drafting rules. Nothing outside
the markers is touched.

## Configuration

`.fragmt.json` at the repo root is the whole configuration surface:

```json
{
  "docsRoot": ".",
  "order": {},
  "authors": { "you@example.com": "YourGitHubUsername" },
  "agents": ["ZCode"]
}
```

| Key | Meaning |
| --- | --- |
| `docsRoot` | Path, relative to the repo root, that fragmt treats as the doc tree. `"."` is the whole repo. |
| `order` | Reserved for explicit doc ordering (v1.x). Always `{}` for now. |
| `authors` | Optional map of commit emails to GitHub usernames, for avatars. |
| `agents` | Optional list of agent display names; their comments get an `agent` chip. |
| `okf` | Optional. `true` maintains the bundle as OKF – set by `fragmt init --okf`. Absent means legacy behavior. |

Parsing is strict – a malformed config fails loudly with the file path rather
than falling back to a silent default.

## Status

**Beta.** The full v1 feature set works. What stands between this and 1.0 is
dogfood hardening – a long-running effort that closes when it closes, not on a
schedule.

## Documentation

Reference docs live in [`docs/`](docs/): [architecture](docs/ARCHITECTURE.md)
and [design principles](docs/DESIGN.md).

The design decisions, the build log and the wrong turns – including why Tiptap
won the editor spike and what was deliberately cut from v1 – are written up at
**[migatchev.co.za/projects/fragmt](https://migatchev.co.za/projects/fragmt)**.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Scope is deliberately tight, so open an
issue before a large PR. The most useful contribution right now is dogfooding
and issue reports – especially on Linux and macOS.

Built with TypeScript, Node 22, [Hono](https://hono.dev), React 19 + Vite,
[Tiptap 3](https://tiptap.dev), and a thin `execFile` wrapper around system git.

## License

MIT – see [LICENSE](LICENSE). Copyright © 2026 Andrei Migatchev and
[contributors](https://github.com/ChaosChild/fragmt/graphs/contributors).
