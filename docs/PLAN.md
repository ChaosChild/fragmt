# v1 build plan

**v1 definition of done:** the author writes and maintains this project's own docs in the tool, daily, instead of a text editor. Dogfood is the acceptance test.

## Stack

- TypeScript, Node 22, single npm package (`fragmt`), folders: `core/ cli/ server/ ui/`
- UI: React + Vite
- Git: \~50-line `execFile` wrapper around system git (no libgit2/isomorphic-git)
- Frontmatter: gray-matter (strip before parse, reattach after)
- Editor: Tiptap + custom `data-c` mark + `tiptap-markdown` (`html: true`) + StarterKit + `@tiptap/extension-list`/`-table`/`-image`
- HTTP server: Hono
- License: MIT

Detailed, implementation-exact specs: [M0](milestones/M0-environment-prep.md) · [M1](milestones/M1-read-only.md) · [M2](milestones/M2-round-trip-editing.md) · [M3](milestones/M3-files-and-branches.md) · [M4](milestones/M4-comments.md) · [M5](milestones/M5-dogfood-hardening.md). Decisions behind them: tsx + Vitest, Biome, `docsRoot` configurable (default `.`), CI skeleton in M0 with the corpus test joining in M2.

## Build status

- **Shipped:** M0 + M1 read-only, plus open-source release prep — all squashed into the initial public commit. `npm ci && typecheck && lint && biome ci && test` green; 32 tests.
- **Realized versions:** TypeScript 7.0.2, Biome 2.5.7, Vite 8, React 19, Vitest 4, Node 22, @types/node 26.
- **Deliberate deviations from the stack notes above:**
  - `tsconfig.json` gained `esModuleInterop` — `gray-matter` is CJS; standard fix for default-importing it under `nodenext`.
  - `biome.json` scope-disables two CSS rules (`noDescendingSpecificity`, `noImportantStyles`) for `**/*.css` — both conflict with the approved hand-crafted design (the reduced-motion `!important` is a genuine a11y override).
- **Deferred:** `docs/app.html` doc cards show author/version/last-edit/snippet, but M1's `/api/tree` carries none and there's no git layer until M2. Cards render the visual with available data; a git-log metadata API is a v1.x addition.
- **Release prep (pre-M2):** README/CONTRIBUTING for the public repo; config renamed `.mddocs.json` → `.fragmt.json`; `.gitattributes` pins LF (the Windows line-ending risk below was breaking `biome ci` on every file in a Windows clone); `ui/dist` resolved against the module rather than `cwd`, so `serve` works outside the install dir; `tests/server.test.ts` added — the raw-URL traversal guard had no coverage, and testing it surfaced `%2e%2e` returning 404 instead of the spec'd 400 (no file ever leaked; guard now decodes once before checking).
- **Next:** M2 (round-trip editing) — the gate, and the riskiest milestone.

## M0 — Environment prep

**Goal:** dev loop + CI green before any product code exists.

- [x] Package scaffold at repo root (`fragmt`), tsconfig, Biome, CLI stub (`parseArgs`), smoke test
- [x] GitHub Actions: typecheck + lint + test

## M1 — Read-only

**Goal:** browse the repo's docs in the UI; nothing is written yet. **Proves:** repo adoption + the API boundary (UI never touches the filesystem).

- [x] Package scaffold: single package, `core/cli/server/ui` folders, build/dev scripts
- [x] `init`: adopt an existing repo/clone, write `.fragmt.json`
- [x] `serve`: Hono server on a free port, JSON API only
- [x] Folder-tree API (core + server route)
- [x] Folder-tree UI (nav component)
- [x] Rendered markdown viewing (doc-read API + UI)

## M2 — Round-trip editing

**Goal:** edit a real doc in Tiptap and save it as a commit. Deliberately before file ops — this is the riskiest part. **Proves:** the spike's round-trip result holds in a real browser, not just headless Node.

- [x] Tiptap editor wired up with the spike's extension set (StarterKit + list/table/image)
- [ ] Custom `data-c` comment mark ported into the editor
- [ ] gray-matter frontmatter strip on load / reattach on save
- [ ] `commitAs(user, change)` seam; user from local git config
- [ ] Save = write file through `commitAs`
- [ ] Promote the spike's round-trip corpus test into a permanent automated test (CI)

## M3 — Files & branches

**Goal:** full doc/folder lifecycle and branch-based drafting. **Proves:** the git layer handles real editing workflows, not just single-file saves.

- [ ] Create/rename/move/delete docs (each op = one commit via `commitAs`)
- [ ] Create/rename/move/delete folders (same)
- [ ] Branch dropdown: switch branches
- [ ] Branch dropdown: create branch
- [ ] Push/pull commands
- [ ] `sync()` = `pull --rebase` + push, triggered by: interval, window focus, pre-edit
- [ ] Conflict handling: abort + surface in UI (no merge UI)

## M4 — Comments

**Goal:** inline self-notes anchored to text, versioned alongside docs. **Proves:** the mark + sidecar design from ARCHITECTURE.md works end-to-end.

- [ ] Highlight-to-comment UI (selection → create thread)
- [ ] Sidecar storage: `.docs/comments/<doc-path>.json`, keyed by mark id
- [ ] Quote snapshot captured at comment creation
- [ ] Resolve / delete comment
- [ ] Orphan display: thread + quote snapshot when the span is gone

## M5 — Dogfood hardening

**Goal:** the definition of done, literally exercised. **Proves:** v1 is done.

- [ ] Run fragmt on this repo's own docs daily
- [ ] Fix whatever bites during daily use
- [x] README quickstart (install, `init`, `serve`)
- [x] `npm publish --dry-run` clean

## Cut from v1

| Item | Deferred to |
| --- | --- |
| MCP server | v1.1 (first thing after v1) |
| Search UI, doc ordering, conflict-resolution UI | v1.x, when they hurt |
| PR create/review in UI, auth/multi-user | v2 |
| Import (Notion/Confluence), agent-in-UI chat | roadmap |
| Table column alignment | accepted loss (spike) |

## Risks

- **tiptap-markdown is a small third-party dep and serialization is core** → corpus test runs in CI; serializer isolated behind one module.
- **Git edge states** (rebase conflicts, dirty tree) → `sync()` never force-pushes, commits before rebasing, conflicts abort + surface.
- **Out-of-tool edits orphan comment spans** → accepted; orphan display designed in (M4).
- **Windows paths / line-endings** → author dogfoods on Windows day one.
