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

Detailed, implementation-exact specs: [M0](milestones/M0-environment-prep.md) · [M1](milestones/M1-read-only.md) · [M2](milestones/M2-round-trip-editing.md) · [M2-2](milestones/M2-2-editing-controls.md) · [M3](milestones/M3-files-and-branches.md) · [M4](milestones/M4-comments.md) · [M5](milestones/M5-dogfood-hardening.md). Decisions behind them: tsx + Vitest, Biome, `docsRoot` configurable (default `.`), CI skeleton in M0 with the corpus test joining in M2.

## Build status

- **Shipped:** M0 + M1 read-only, plus open-source release prep — all squashed into the initial public commit. `npm ci && typecheck && lint && biome ci && test` green; 32 tests.
- **Shipped:** M2 round-trip editing — Tiptap editor, save-as-commit through `commitAs`, stale-hash 409 guard, byte-for-byte frontmatter reattach, and the permanent corpus gate (`tests/roundtrip.test.ts`, built on the app's own extension array). 51 tests.
- **Shipped:** M2-2 editing controls — contextual formatting surfaces only (selection/right-click bubble for marks, turn into, table structure, image edit; `/` slash menu for inserting blocks; empty-doc placeholder hint). Zero persistent chrome; the DESIGN editor clause amended in the same change. Escape order now popover → slash → selection → edit-cancel. 64 tests.
- **Shipped:** M3 files & branches — full doc/folder lifecycle (one `commitAs` commit per op, R100 renames via fs mutations because `git mv`/`git rm` break the seam's unconditional `git add`), branch commands + `sync()` (pull --rebase + push, conflict aborts the rebase and leaves HEAD untouched; no-remote/no-upstream are no-ops), the HTTP surface for all of it, and the UI: branch dropdown with a dirty-buffer save-or-discard guard, sync LED + three triggers, file ops in fixed places. 91 tests.
- **Shipped:** M4 inline comments — threads in `.docs/comments/<doc-path>.json` sidecars through the shared containment guard, one `commitAs` commit per mutation; comment HTTP surface (Hono mid-pattern `*` doesn't span slashes — one fall-through middleware splits the tail); read mode is now a non-editable Tiptap editor (one rendering path, react-markdown retired from the doc body, comment creation never flips the mode — review decision); bubble Comment action (comment-only in read mode); the rail with orphans, resolved toggle, and the LED/theme move; icons standardised on lucide-react. 111 tests.
- **Realized versions:** TypeScript 7.0.2, Biome 2.5.7, Vite 8, React 19, Vitest 4, Node 22, @types/node 26; Tiptap 3.x, tiptap-markdown 0.9.x, happy-dom (M2, per the spike-validated majors).
- **Deliberate deviations from the stack notes above:**
  - `tsconfig.json` gained `esModuleInterop` — `gray-matter` is CJS; standard fix for default-importing it under `nodenext`.
  - `biome.json` scope-disables two CSS rules (`noDescendingSpecificity`, `noImportantStyles`) for `**/*.css` — both conflict with the approved hand-crafted design (the reduced-motion `!important` is a genuine a11y override).
- **Deliberate deviations from the M2 spec (all proven by the acceptance run):**
  - gray-matter's parse cache drops its non-enumerable `matter` field on the cached copy — a read-then-write of the same doc would silently lose frontmatter. All parses now pass an options object to bypass the cache.
  - `writeDoc` resolves the git identity *before* writing (missing identity leaves the working tree clean) and returns the hash of the normalized body (the raw payload's hash could mismatch disk).
  - `TightTaskList` extension: tiptap-markdown's tight-lists default omits task lists, which serialize loose — one checkbox flip would rewrite every line of a task list. The spike missed this; the corpus gate pins tight serialization.
  - Canonical body shape (LF, no leading newlines, one trailing newline) on both read and write, fence-to-body gap preserved from the file: gray-matter's content includes the blank line after the frontmatter fence and the editor drops it on parse, so without this every first save rewrote the fence boundary.
  - `npm run typecheck` now also covers `ui/` (new `ui/tsconfig.json` + `vite-env.d.ts`) — M2's first user of the UI tree under `tsc`.
  - Known first-save behavior: the editor's serializer is canonical — hand-wrapped paragraphs collapse to one line, `~` gets escaped (`\~`), blank lines are inserted after headings. Steady-state saves are minimal-diff (verified: five checkbox ticks → five changed lines).
- **Deferred:** `docs/app.html` doc cards show author/version/last-edit/snippet, but M1's `/api/tree` carries none and there's no git layer until M2. Cards render the visual with available data; a git-log metadata API is a v1.x addition.
- **Next:** M3 (files & branches) — `commitAs` and `writeDoc` are the seams every file op flows through.

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
- [x] Custom `data-c` comment mark ported into the editor
- [x] gray-matter frontmatter strip on load / reattach on save
- [x] `commitAs(user, change)` seam; user from local git config
- [x] Save = write file through `commitAs`
- [x] Promote the spike's round-trip corpus test into a permanent automated test (CI)

## M2-2 — Editing controls

**Goal:** every basic formatting action reachable by mouse — block types, table structure, images — with zero persistent chrome. **Proves:** "Notion-style WYSIWYG" holds for users who don't know markdown. Direction and scope locked in a Lavish annotation round; amends the DESIGN editor clause (the M2 "no floating toolbars" decision reversed in writing).

- [x] Bubble on text selection / image click / **right-click** (bare cursor): marks + link, turn into (Text, H1–H3, Quote, Code block), table ops (add/delete row & column, toggle header, delete table), image edit/delete
- [x] Slash menu (`@tiptap/suggestion`): insert headings, quote, code block, lists, task list, divider, 3×3 table with header, image via URL + alt form — ↑↓/Enter/Escape
- [x] Empty-doc placeholder hint pointing at `/` and right-click
- [x] Escape order contract: popover → slash menu → bubble → selection → cancel
- [x] Cancel confirmation: discarding unsaved changes asks first (banner, both Escape and Cancel button)
- [x] Accessibility floor: ≥32px targets, focus rings, aria labels, keyboard reach
- [x] `editorExtensions` becomes a factory (slash callbacks optional) — corpus gate still judges the same set
- [x] Tests: slash item execution, bare-cursor turn-into, comment-mark preservation, bubble predicate (13 new; 64 total)

## M3 — Files & branches

**Goal:** full doc/folder lifecycle and branch-based drafting. **Proves:** the git layer handles real editing workflows, not just single-file saves.

- [x] Create/rename/move/delete docs (each op = one commit via `commitAs`)
- [x] Create/rename/move/delete folders (same)
- [x] Branch dropdown: switch branches
- [x] Branch dropdown: create branch
- [x] Push/pull commands
- [x] `sync()` = `pull --rebase` + push, triggered by: interval, window focus, pre-edit
- [x] Conflict handling: abort + surface in UI (no merge UI)

## M4 — Comments

**Goal:** inline self-notes anchored to text, versioned alongside docs. **Proves:** the mark + sidecar design from ARCHITECTURE.md works end-to-end.

- [x] <span data-c="99ae9594-b26e-43a9-a8e9-74e8f6cd598d">Highlight-to-comment UI (selection → create thread)</span>
- [x] Sidecar storage: `.docs/comments/<doc-path>.json`, keyed by mark id
- [x] Quote snapshot captured at comment creation
- [x] Resolve / delete comment
- [x] Orphan display: thread + quote snapshot when the span is gone

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
