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

Detailed, implementation-exact specs: [M0](milestones/M0-environment-prep.md) · [M1](milestones/M1-read-only.md) · [M2](milestones/M2-round-trip-editing.md) · [M2-2](milestones/M2-2-editing-controls.md) · [M3](milestones/M3-files-and-branches.md) · [M4](milestones/M4-comments.md) · [M4-2](milestones/M4-2-drafting-model.md) · [M4-3](milestones/M4-3-backlog-remediation.md) · [M4-4](milestones/M4-4-backlog-agent-surface.md) · [M5](milestones/M5-distributables-install.md) · [M6](milestones/M6-dogfood-hardening.md) · [Search & link slideout](milestones/search-and-link-slideout.md) – the first backlog round, after which milestones were retired (see the closing note). Decisions behind them: tsx + Vitest, Biome, `docsRoot` configurable (default `.`), CI skeleton in M0 with the corpus test joining in M2.

## Build status

- **Shipped:** M0 + M1 read-only, plus open-source release prep – all squashed into the initial public commit. `npm ci && typecheck && lint && biome ci && test` green; 32 tests.
- **Shipped:** M2 round-trip editing – Tiptap editor, save-as-commit through `commitAs`, stale-hash 409 guard, byte-for-byte frontmatter reattach, and the permanent corpus gate (`tests/roundtrip.test.ts`, built on the app's own extension array). 51 tests.
- **Shipped:** M2-2 editing controls – contextual formatting surfaces only (selection/right-click bubble for marks, turn into, table structure, image edit; `/` slash menu for inserting blocks; empty-doc placeholder hint). Zero persistent chrome; the DESIGN editor clause amended in the same change. Escape order now popover → slash → selection → edit-cancel. 64 tests.
- **Shipped:** M3 files & branches – full doc/folder lifecycle (one `commitAs` commit per op, R100 renames via fs mutations because `git mv`/`git rm` break the seam's unconditional `git add`), branch commands + `sync()` (pull --rebase + push, conflict aborts the rebase and leaves HEAD untouched; no-remote/no-upstream are no-ops), the HTTP surface for all of it, and the UI: branch dropdown with a dirty-buffer save-or-discard guard, sync LED + three triggers, file ops in fixed places. 91 tests.
- **Shipped:** M4 inline comments – threads in `.docs/comments/<doc-path>.json` sidecars through the shared containment guard, one `commitAs` commit per mutation; comment HTTP surface (Hono mid-pattern `*` doesn't span slashes – one fall-through middleware splits the tail); read mode is now a non-editable Tiptap editor (one rendering path, react-markdown retired from the doc body, comment creation never flips the mode – review decision); bubble Comment action (comment-only in read mode); the rail with orphans, resolved toggle, and the LED/theme move; icons standardised on lucide-react. 111 tests.
- **Shipped:** M4-2 dogfood polish – the drafting model: a `/api/meta` endpoint fed by three git-log walks (per-doc author/date/version/snippet, a cross-branch draft map, the deleted list) powers mock-true doc cards (draft chips, ghost cards), the email-style doc head (GitHub-avatar heuristic, actions moved in), the recycle bin with restore, and the two-row sidebar head; protected main (`POST /api/draft` – every doc-body write on main auto-drafts `drafts/<slug>`, no prompt) with the global Merge button (`checkout main && merge`, abort+surface on conflict, `branch -d` after); comment reopen plus one-commit-per-action create/delete (span strip server-side, M4 anchoring contract amended); `@` references with minimal in-app link navigation. Spec: [M4-2](milestones/M4-2-drafting-model.md); six reviewed subagent batches. 150 tests.
- **Realized versions:** TypeScript 7.0.2, Biome 2.5.7, Vite 8, React 19, Vitest 4, Node 22, @types/node 26; Tiptap 3.x, tiptap-markdown 0.9.x, happy-dom (M2, per the spike-validated majors).
- **Deliberate deviations from the stack notes above:**
  - `tsconfig.json` gained `esModuleInterop` – `gray-matter` is CJS; standard fix for default-importing it under `nodenext`.
  - `biome.json` scope-disables two CSS rules (`noDescendingSpecificity`, `noImportantStyles`) for `**/*.css` – both conflict with the approved hand-crafted design (the reduced-motion `!important` is a genuine a11y override).
- **Deliberate deviations from the M2 spec (all proven by the acceptance run):**
  - gray-matter's parse cache drops its non-enumerable `matter` field on the cached copy – a read-then-write of the same doc would silently lose frontmatter. All parses now pass an options object to bypass the cache.
  - `writeDoc` resolves the git identity *before* writing (missing identity leaves the working tree clean) and returns the hash of the normalized body (the raw payload's hash could mismatch disk).
  - `TightTaskList` extension: tiptap-markdown's tight-lists default omits task lists, which serialize loose – one checkbox flip would rewrite every line of a task list. The spike missed this; the corpus gate pins tight serialization.
  - Canonical body shape (LF, no leading newlines, one trailing newline) on both read and write, fence-to-body gap preserved from the file: gray-matter's content includes the blank line after the frontmatter fence and the editor drops it on parse, so without this every first save rewrote the fence boundary.
  - `npm run typecheck` now also covers `ui/` (new `ui/tsconfig.json` + `vite-env.d.ts`) – M2's first user of the UI tree under `tsc`.
  - Known first-save behavior: the editor's serializer is canonical – hand-wrapped paragraphs collapse to one line, `~` gets escaped (`\~`), blank lines are inserted after headings. Steady-state saves are minimal-diff (verified: five checkbox ticks → five changed lines).
- **Deferred:** `docs/app.html` doc cards show author/version/last-edit/snippet, but M1's `/api/tree` carries none and there's no git layer until M2. Cards render the visual with available data; a git-log metadata API is a v1.x addition.
- **Shipped:** M4-3 backlog remediation – the post-M4-2 dogfooding items in seven subagent batches: edit-flip scroll/menu-cap/on-draft-badge quick fixes; the `authors` config map resolving real emails to GitHub avatars; branch deletion (`-d`, confirm `-D` for unmerged); sidebar geometry (16px guide-line indent, min row width with scroll-not-clip, indicators after the name, resizable, always-visible bin); file actions on the breadcrumb name under a frontmatter-`title` model (the filename never changes – links are the currency) with the corner-icon machinery deleted; navbar drag & drop (rows → folders, → "/" root, → bin); link completion (heading slugs + anchors incl. `doc.md#frag`, folder links incl. empty ones, `GET /api/raw/*` for non-md, dead-link note); and `.gitignore` respected across every tree-derived surface via one `ls-files` allow-list (tracked wins). Spec: [M4-3](milestones/M4-3-backlog-remediation.md). 216 tests (sync suite's pre-existing Windows timeout flake fixed with honest 20s limits).
- **Shipped:** M4-4 backlog remediation 2 + the agent surface – collision-aware drag & drop and move-picker targets (client tree consult); the merge-conflict resolution engine (stand-conflicted merge, `parseConflicts` hunk editor with ours/theirs/edit, structural `mergeSidecars` under the approved survival rules, conclude-merge `git commit --no-edit`, a one-middleware write-guard while `MERGE_HEAD` stands, honest abort fallback for non-doc conflicts); and the agent surface: `fragmt agent status · comment · draft` (AXI-style TOON output, `help[]` hints, exit codes 0/1/2) with `--author` identity, the delimited AGENTS.md block on `init` (create/append/refresh, nothing outside the markers), the `agents` config list + UI agent chip. MCP dropped from the plan – the CLI is the agent contract, HTTP stays UI-private. /api/meta performance stays deferred with measurements recorded in BACKLOG.md. Spec: [M4-4](milestones/M4-4-backlog-agent-surface.md); five reviewed subagent batches + docs. 287 tests.
- **Shipped:** M5 distributables & install – `fragmt@0.5.0` published to npm 2026-08-21 (provenance-attested, GitHub Release with auto notes); `release.yml` publishes on tag push. The live pipeline taught three npm gotchas, all recorded in the spec: `NODE_AUTH_TOKEN` (not a bare `NPM_TOKEN` env var), `publishConfig.access=public` required for a first `--provenance` publish, and 2FA-or-bypass-token required for creating/publishing (the bypass checkbox on the granular token; account mode does not lift it – trusted publishing migration dated January 2027). The tarball smoke test also caught the CLI's direct-invocation guard breaking under symlinked node installs (nvm4w junctions) – fixed with a realpath comparison. Spec: [M5](milestones/M5-distributables-install.md); 294 tests.
- **Shipped:** search + link slideout – the first backlog-driven round (issues #14 + #15, branch `feat/search-slideout` → v0.6.0). Search: `searchDocs` server-side flat scan (title + body, case-insensitive substring, title-first ordering, ~110-char snippets, cap 50, no index – measure first) behind `GET /api/search?q=`; Ctrl/Cmd+K centered modal (works mid-edit, focus trap + restore, 250ms debounce ≥2 chars, ↑↓ wrap + hover-sync, Enter/click opens through the navigation queue, Shift+Enter/Shift+click previews in the slideout), ⌕ in the brand row. Slideout: the permanent comment rail became a two-mode side pane (55/45 default, 7px drag divider clamped 40–60% persisted via `fragmt.slideoutShare` – the sidebar-geometry pattern in %) – Comments mode preserves the rail, Preview mode is a read-only second EditorPane whose doc links open inside it (dead links get a quiet note); edit-mode link clicks always preview (the buffer never navigates away), Shift+click + the hover-↗ zone (last 18px) preview, promote-to-editor routes through the queue; opening auto-collapses the sidebar once (manual re-expand sticks, close restores only the automatic collapse) and a collapsed topbar (» brand · BranchMenu · Merge · ＋ · ⌕ · LED – same components, second location) keeps the fixed actions reachable; the Escape chain is now modal → popover → slash/@ → bubble → selection → slideout → edit-cancel. Spec: [search & link slideout](milestones/search-and-link-slideout.md). 322 tests (294 → 322).
- **Next:** nothing scheduled – the plan closed with that round (2026-08-26): milestones retired, the backlog issues are the engine (index in [BACKLOG.md](BACKLOG.md)), M6 dogfooding runs long. See the closing note below.

## M0 – Environment prep

**Goal:** dev loop + CI green before any product code exists.

- [x] Package scaffold at repo root (`fragmt`), tsconfig, Biome, CLI stub (`parseArgs`), smoke test
- [x] GitHub Actions: typecheck + lint + test

## M1 – Read-only

**Goal:** browse the repo's docs in the UI; nothing is written yet. **Proves:** repo adoption + the API boundary (UI never touches the filesystem).

- [x] Package scaffold: single package, `core/cli/server/ui` folders, build/dev scripts
- [x] `init`: adopt an existing repo/clone, write `.fragmt.json`
- [x] `serve`: Hono server on a free port, JSON API only
- [x] Folder-tree API (core + server route)
- [x] Folder-tree UI (nav component)
- [x] Rendered markdown viewing (doc-read API + UI)

## M2 – Round-trip editing

**Goal:** edit a real doc in Tiptap and save it as a commit. Deliberately before file ops – this is the riskiest part. **Proves:** the spike's round-trip result holds in a real browser, not just headless Node.

- [x] Tiptap editor wired up with the spike's extension set (StarterKit + list/table/image)
- [x] Custom `data-c` comment mark ported into the editor
- [x] gray-matter frontmatter strip on load / reattach on save
- [x] `commitAs(user, change)` seam; user from local git config
- [x] Save = write file through `commitAs`
- [x] Promote the spike's round-trip corpus test into a permanent automated test (CI)

## M2-2 – Editing controls

**Goal:** every basic formatting action reachable by mouse – block types, table structure, images – with zero persistent chrome. **Proves:** "Notion-style WYSIWYG" holds for users who don't know markdown. Direction and scope locked in a Lavish annotation round; amends the DESIGN editor clause (the M2 "no floating toolbars" decision reversed in writing).

- [x] Bubble on text selection / image click / **right-click** (bare cursor): marks + link, turn into (Text, H1–H3, Quote, Code block), table ops (add/delete row & column, toggle header, delete table), image edit/delete
- [x] Slash menu (`@tiptap/suggestion`): insert headings, quote, code block, lists, task list, divider, 3×3 table with header, image via URL + alt form – ↑↓/Enter/Escape
- [x] Empty-doc placeholder hint pointing at `/` and right-click
- [x] Escape order contract: popover → slash menu → bubble → selection → cancel
- [x] Cancel confirmation: discarding unsaved changes asks first (banner, both Escape and Cancel button)
- [x] Accessibility floor: ≥32px targets, focus rings, aria labels, keyboard reach
- [x] `editorExtensions` becomes a factory (slash callbacks optional) – corpus gate still judges the same set
- [x] Tests: slash item execution, bare-cursor turn-into, comment-mark preservation, bubble predicate (13 new; 64 total)

## M3 – Files & branches

**Goal:** full doc/folder lifecycle and branch-based drafting. **Proves:** the git layer handles real editing workflows, not just single-file saves.

- [x] Create/rename/move/delete docs (each op = one commit via `commitAs`)
- [x] Create/rename/move/delete folders (same)
- [x] Branch dropdown: switch branches
- [x] Branch dropdown: create branch
- [x] Push/pull commands
- [x] `sync()` = `pull --rebase` + push, triggered by: interval, window focus, pre-edit
- [x] Conflict handling: abort + surface in UI (no merge UI)

## M4 – Comments

**Goal:** inline self-notes anchored to text, versioned alongside docs. **Proves:** the mark + sidecar design from ARCHITECTURE.md works end-to-end.

- [x] <span data-c="99ae9594-b26e-43a9-a8e9-74e8f6cd598d">Highlight-to-comment UI (selection → create a comment thread)</span>
- [x] Sidecar storage: `.docs/comments/<doc-path>.json`, keyed by mark id
- [x] Quote snapshot captured at comment creation
- [x] Resolve / delete comment
- [x] Orphan display: thread + quote snapshot when the span is gone

## M4-2 – Dogfood polish: cards, headers, and the drafting model

**Goal:** close the gap between the built UI and the v1-final mock for navigation and doc headers, and finish the drafting model – protected main, visible drafts, operator-driven merge. **Proves:** daily dogfooding becomes natural: drafts are visible where you browse, merging is your call, and the lifecycle has no dead ends. Implementation spec: [M4-2](milestones/M4-2-drafting-model.md) (decisions locked in two Lavish rounds, 2026-08-18; the backlog scope section was removed once shipped).

- [x] Doc cards to the mock: author, last-edited, snippet, version, draft indicator (needs the git-log metadata API deferred since M1)
- [x] Draft visibility: docs new/edited/deleted on a branch show as draft cards in the navbar
- [x] Doc header to the mock: author · "editing vX · branch" · unsaved indicator; Cancel/Save gain icons
- [x] Reopen resolved comments (server currently pins `resolved: true`)
- [x] "@" reference command in documents and comment bodies (menu like `/`; a doc reference is a navigable link – ties to the link-navigation backlog item)
- [x] "+" action becomes a dropdown: new document (default) or new folder
- [x] Protected main: editing a doc on main auto-creates a draft branch (auto-named, no prompt) and moves the doc to draft
- [x] "Merge" action on a draft – multi-file branches merge to main when the operator decides; PR creation stays with the operator (GitHub)
- [x] Restore deleted documents (and their comment sidecars) from git history
- [x] One commit per logical comment action (create/delete = single commits; M4's anchoring contract amended in the same change)
- [x] Sidebar head layout (from the design-pass backlog item): two-row head – brand + "+" / branch selector + global Merge; kebab hover-revealed on rows

**Sequencing note:** the merge button settles the "when does a draft become a PR" question – the operator merges in the UI when a draft is complete; opening a PR on GitHub remains a separate, manual act (v2 may fold it in).

## M4-3 – Backlog remediation

**Goal:** clear the post-M4-2 dogfooding backlog – file actions to the content header (corner icons deleted), sidebar geometry + drag & drop, branch deletion, author identity, link-navigation completion, `.gitignore` in the tree. **Proves:** the friction found while dogfooding M4-2 is gone; nothing in the navbar is broken. Implementation spec: [M4-3](milestones/M4-3-backlog-remediation.md) (decisions locked in a Lavish round, 2026-08-19; agentic work excluded – that becomes M4-4).

- [x] Quick fixes: edit-flip scroll stays at top, `@`/slash menu height cap, "on draft" badge in the doc header
- [x] Authors map in `.fragmt.json` (email → GitHub username) feeding avatars; noreply heuristic stays zero-config
- [x] Branch deletion: `DELETE /api/branches/:name` (`-d`, confirm `-D` for unmerged) + trash in the dropdown
- [x] Sidebar geometry: 16px guide-line indent, row min-width (scroll, not clip), indicators after the name, resizable sidebar, always-visible recycle bin
- [x] Content-header file actions: rename (frontmatter `title` – the filename never changes), move (picker incl. "/"), delete (confirm); corner-icon machinery removed
- [x] Drag & drop: rows → folders (move), rows → "/" root (move), rows → bin (delete); self-drop guarded
- [x] Link navigation completion: heading slugs + anchors (incl. `doc.md#frag`), folder links (empty folders just expand), non-md files via `GET /api/raw/*` in a new tab, dead links get an inline note
- [x] `.gitignore` respected across every tree-derived surface (one `ls-files` allow-list per refresh; tracked wins)

## M4-4 – Backlog remediation 2 + the agent surface

**Goal:** clear the remaining backlog – collision-aware drag & drop, the full merge-conflict resolution engine (stand-conflicted merge, per-hunk editor, structural sidecar merge), and the agent surface: AXI-conformant `fragmt agent` CLI verbs with `--author` identity, an AGENTS.md block on `init`, the agent chip in the UI. **Proves:** the drag-over highlight never promises a refused drop; a conflicting merge resolves entirely in the tool; an agent reads state, replies, and merges via the CLI under its own identity. Implementation spec: [M4-4](milestones/M4-4-backlog-agent-surface.md) (decisions locked in three Lavish rounds, 2026-08-20; /api/meta performance stays deferred with measured evidence recorded in BACKLOG.md; MCP dropped – the CLI is the agent contract).

- [x] Collision-aware targets: `targetOccupied` tree consult – no promised-refused drops, picker filters colliding destinations
- [x] Merge resolution core: `parseConflicts`, `mergeSidecars` (approved survival rules), stand-conflicted `mergeToMain`, resolve/conclude/abort, `MERGE_HEAD` state
- [x] Merge resolution server + UI: write-guard middleware, five routes, ResolutionView (hunk cards ours/theirs/edit, sidecar take-merged/ours/theirs), honest abort fallback
- [x] Agent CLI: `fragmt agent status · comment · draft` – TOON output, exit codes, `help[]` hints, `--author` identity
- [x] AGENTS.md block (create/append/replace on init) + `agents` config + UI agent chip
- [x] Docs: PLAN/BACKLOG/README (perf evidence recorded, agent item graduates, MCP line updated)

## M5 – Distributables & install

**Goal:** fragmt installs without cloning this repo – a published npm package, GitHub Releases on tags, and a quickstart that starts from `npx fragmt`. **Proves:** anyone can run v1 on their own clone in under a minute. Renumbered into place 2026-08-20 (dogfood hardening moved to M6; the publish-readiness work migrated here). Spec: [M5](milestones/M5-distributables-install.md) (decisions locked in two Lavish rounds, 2026-08-21: first release **v0.5.0** – milestone = minor, CI publishes on tag push via `NODE_AUTH_TOKEN`, auto-generated release notes + manual milestone paste; plain `npx fragmt` in docs; CodeQL default setup is the SAST layer; Windows-tested, Linux/macOS verification opens M6).

- [x] Publish readiness: shebang on the emitted bin (source-level – tsc preserves it), `files` allowlist ships `dist/` + `ui/dist/`, `npm pack` clean, `prepublishOnly` builds
- [x] `npm publish` – `fragmt@0.5.0` live on npm (2026-08-21), provenance-attested; GitHub Release cut. Clean-clone acceptance rolls into M6's daily dogfood (Windows-verified via the tarball smoke test)
- [x] GitHub Releases: tag → CI release workflow, notes from the milestone record
- [x] README quickstart rewritten for the installed path (`npx`/global first, from-source second)
- [x] Versioning policy (semver, milestone = minor during 0.x) in CONTRIBUTING

## <span data-c="d13d457e-564a-4e9d-9bc5-f5239144f512">M6 – Dogfood hardening</span>

**Goal:** the definition of done, literally exercised – now as a long-running milestone, not a scheduled one (re-framed 2026-08-26 when milestones were retired): the owner and downloaders test daily, file issues, and the backlog orders what bites; v1 closes with 1.0.0 when it's done, on the existing tag-push pipeline. **Proves:** v1 is done. Was M5 until the 2026-08-20 renumber; publish readiness lives in M5 now.

- [ ] Run fragmt on this repo's own docs daily
- [ ] Fix whatever bites during daily use
- [x] README quickstart (install, `init`, `serve`)
- [x] `npm publish --dry-run` clean

## Cut from v1

| Item | Deferred to |
| --- | --- |
| Search UI | shipped 2026-08-26 in the first backlog-driven round (#14 → v0.6.0); doc ordering and draft diff view stay "when they hurt" (gutter rung: #18) |
| PR create/review in UI, auth/multi-user | leads the post-v1 era – #20 |
| OKF support (init --okf, frontmatter editor, trust stamping) | after multi-user – #21 |
| Agent-in-UI (harness bridge, client-side agent tools) | after multi-user – #22 |
| MCP server | parked, not dropped – reconsider after multi-user/remote deployment (#23); the agent surface stays the AXI-conformant `fragmt agent` CLI, HTTP stays UI-private |
| Import (Notion/Confluence) | roadmap; agent-in-UI chat superseded by the harness bridge (#22) |
| Table column alignment | accepted loss (spike) |

## Risks

- **tiptap-markdown is a small third-party dep and serialization is core** → corpus test runs in CI; serializer isolated behind one module.
- **Git edge states** (rebase conflicts, dirty tree) → `sync()` never force-pushes, commits before rebasing, conflicts abort + surface.
- **Out-of-tool edits orphan comment spans** → accepted; orphan display designed in (M4).
- **Windows paths / line-endings** → author dogfoods on Windows day one.

## Plan closed – 2026-08-26

Milestones are retired. The M0–M5 sections above (with M2-2, M4-2…M4-4) are the fixed record of how v1 got built; M6 stays open as the long-running dogfooding milestone – no scheduled close, 1.0.0 when it's done. From here the engine is the backlog: GitHub issues carrying the `backlog` label, indexed in [BACKLOG.md](BACKLOG.md), specced in [milestones/](milestones/) when picked up, released on the existing tag-push pipeline.

The first backlog-driven PR closed the same day: search (#14) + link slideout (#15) on `feat/search-slideout` → v0.6.0 (spec: [search & link slideout](milestones/search-and-link-slideout.md); 294 → 322 tests). Every later release follows the same shape – round, not milestone.
