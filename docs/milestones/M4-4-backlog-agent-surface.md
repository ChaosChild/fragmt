# M4-4 – Backlog remediation 2 + the agent surface

**Goal:** clear the remaining backlog in one milestone – collision-aware drag & drop, the full merge-conflict resolution engine (stand-conflicted merge, hunk editor, structural sidecar merge), and the agent surface: AXI-conformant `fragmt agent` CLI verbs with `--author` identity, an AGENTS.md block written/appended on `init`, and the agent chip in the UI.
**Proves:** the drag-over highlight never promises a drop the server refuses; a conflicting draft merge resolves entirely inside the tool; and an agent can read draft/comment state, reply, and merge through the CLI with its own visible identity – no more talking to yourself.

Prerequisite: M4-3 complete (PR #5). Decisions locked in three Lavish rounds (2026-08-20, `.lavish/m4-4-backlog-remediation-2.html`): everything in M4-4 (no M4-5); merge engine **builds here** (Q1); sidecar survival rules **as written** (Q4); **MCP dropped** – the agent surface is the CLI, HTTP stays UI-private (Q2); identity is the **name-keyed** `agents` list, no sidecar schema change (Q3); the `fragmt agent` namespace (owner's idea) is the stability contract; /api/meta performance **stays deferred** with measured evidence recorded in BACKLOG.md (~250 ms warm @ 19 docs / 13 non-main branches / 77 commits).

## New dependencies (only these)

None.

## Batch 1 – Collision-aware targets (client-only)

1. **`targetOccupied(tree, folder, name)`** in `ui/src/dnd.ts` (pure, next to `movedPath`): walks `tree` (`TreeNode` from `ui/src/api.ts`) to `folder` ("" = root) and returns whether any child – `dir` or `file` – is named `name`. Type-agnostic, matching the server's `existsSync` 409 (`src/core/files.ts:95`).
2. **Sidebar dragover** (`ui/src/Sidebar.tsx`): `validHere` for folder rows and the `/` root target becomes `dropTargetValid(drag, target) && !targetOccupied(tree, destFolder, basename(drag.path))` – invalid targets don't highlight and never `preventDefault`, so the drop can't land (blocked cursor). Bin unchanged (deletes never collide).
3. **Move picker** (`ui/src/DocView.tsx` + `App.tsx`): App pre-filters – `folders` passed to DocView excludes both the current parent (existing rule) and every folder where `targetOccupied(tree, f, basename(docPath))`; a new `rootMoveValid` prop is true only when the doc's parent ≠ "" and root isn't occupied. DocView renders "/ (root)" on `rootMoveValid` and, when the filtered list is empty and root is invalid, a one-line "no collision-free destination" note instead of a dead menu.
4. **Tests** (`tests/dnd.test.ts` + UI-logic suite): occupancy cases (doc name taken, folder name taken, free, root), highlight-decision integration, picker filter. Server untouched – the 409 stays the source of truth for stale trees.

## Batch 2 – Merge resolution: core

New `src/core/conflict.ts`:

```ts
export type ConflictPart = { text: string } | { ours: string; theirs: string };
/** Split raw file text on <<<<<<< / ======= / >>>>>>> markers. Throws
 *  ConflictParseError on malformed nesting – git output is well-formed. */
export function parseConflicts(text: string): ConflictPart[];

/** Structural sidecar merge (approved rules, Q4): threads union by id
 *  (presence wins), creation fields from ours, resolved = ours || theirs
 *  (sticky), replies = ours + theirs entries whose (author, at) is new. */
export function mergeSidecars(ours: CommentFile, theirs: CommentFile): {
	merged: CommentFile;
	summary: { keptFromOurs: number; keptFromTheirs: number; resolvedCarried: number; repliesMerged: number };
};
```

`src/core/drafts.ts` amendments:

- `mergeToMain` conflict path classifies the unmerged set (`git diff --name-only --diff-filter=U`): every path is a `.md` under docsRoot or a `.docs/comments/*.json` sidecar → **the merge stands**: return `{merged:false, conflict:true, stood:true, branch, files}` without aborting. Anything else (non-doc, md outside docsRoot) → the existing abort path, returning `{merged:false, conflict:true, stood:false, files, message}`. Clean-merge path unchanged.
- Extract the post-merge cleanup (branch `-d` + best-effort `push --delete`) into `cleanupDraftBranch(repoRoot, branch)`; `mergeToMain` and conclude both call it.
- New, all in drafts.ts:
  - `mergeState(repoRoot, docsRoot)` – `{inMerge:false}` when no `MERGE_HEAD`; otherwise `{branch, files}` where branch parses `MERGE_MSG`'s `Merge branch 'X'` line (`# ponytail:`-mark the MERGE_MSG parse) and files classify as `{path, kind:"doc", parts}` (conflict-marked text parsed) or `{path, kind:"sidecar", summary}` (stage reads `git show :2:`/`:3:`, both parsed, `mergeSidecars` summary). `remaining` = live `--diff-filter=U` count – recomputed per call, so staged files drop out naturally.
  - `resolveMergeDoc(repoRoot, path, content)` – writes the assembled text verbatim (no canonicalization, no commit) + `git add`.
  - `resolveMergeSidecar(repoRoot, path, choice)` – stages reads again; `merged` (the union result), `ours` (:2:), or `theirs` (:3:); writes through the sidecar serializer's exact format (`JSON.stringify(file, null, "\t")` + trailing newline) + `git add`.
  - `concludeMerge(repoRoot)` – 409-shaped error if `--diff-filter=U` is non-empty; `git commit --no-edit`; `cleanupDraftBranch`. This is the one write path that bypasses `commitAs`, by design: it *is* the merge commit.
  - `abortMerge(repoRoot)` – branch from `MERGE_MSG` first, then `merge --abort` + checkout back.
- `inMerge(repoRoot)` – `existsSync(<.git>/MERGE_HEAD)`; used by the server guard (b3) and the CLI mutation guard (b4).

`RepoMeta` gains `merge: {branch, remaining} | null` (computed in `repoMeta` via `mergeState` – summary only; the full hunks come from `GET /api/merge`). Also gains `agents: string[]` (b5).

**Tests** (`tests/conflict.test.ts` pure + `tests/drafts.test.ts` flows on temp repos): parseConflicts (no markers, one hunk, several, frontmatter-adjacent, malformed → throw); mergeSidecars (each rule row + summary counts); stand-conflicted flow (conflict created by editing the same line on main and draft), resolve doc + sidecar, conclude (branch gone, merge commit exists), abort mid-way (HEAD back on draft, clean tree), unresolvable-file fallback (a non-doc conflict aborts + reports), remaining recomputation after staging.

## Batch 3 – Merge resolution: server + UI

**Server** (`src/server/index.ts`):

- **One write-guard middleware** (laziest correct seam – covers every current and future write route, including the comment fall-through): method ≠ GET/HEAD and path not starting `/api/merge` and `inMerge(ctx.repoRoot)` → `409 {error: "a merge is in progress – finish or abort it first"}`. This is load-bearing: `commitAs` unconditionally `git add`s, so a stray save mid-merge would stage a half-resolution into an unrelated commit.
- Routes: `POST /api/merge` amended to the b2 result shapes; `GET /api/merge` → `mergeState` full detail; `PUT /api/merge/resolve` `{path, content}` | `{path, choice}` → resolve + `{remaining}`; `POST /api/merge/conclude`; `POST /api/merge/abort`. Conflict paths resolve under `/api/merge/*` via `resolveDocPath`-style containment (paths come from git, not the user – validate against the unmerged set).
- **Honest fallback message:** `stood:false` reaches the UI as a distinct *merge*-conflict banner (not the sync-conflict one): "Merge conflict – the merge was aborted and nothing changed. These files conflict and fragmt can't resolve them in-UI: <list>. Reconcile in your terminal, then merge again."

**UI:**

- **Resolution mode** is a main-pane takeover: when `meta.merge` is non-null (mount or refresh), App renders `ui/src/ResolutionView.tsx` instead of DocView. Header banner: "Resolving merge of `<branch>` – N of M files left" + **Finish** (disabled while remaining > 0; conclude → refresh everything) + **Abort** (confirm → abort → refresh). Sidebar stays for context; all writes are server-refused anyway and the global Merge button is hidden in this mode.
- ResolutionView per file: **doc** → hunk cards (ours / theirs / edit – edit swaps the chosen side into a textarea; `<code>` styling per the artifact mock), live assembled preview, **Stage** button → `PUT resolve` with the full assembled text. **sidecar** → summary line ("3 threads kept · 1 resolve carried · 2 replies merged") + three one-click choices (take merged / ours / theirs) – no per-reply editor. Staged files show a done state and drop out of `remaining`.
- `ui/src/api.ts`: `getMergeState`, `resolveMergeFile`, `concludeMerge`, `abortMerge` fetch helpers.

**Tests** (`tests/server-m44.test.ts`, HTTP on temp repos): conflict → stood response with both kinds; GET merge detail; PUT resolve doc + sidecar; conclude ok; write-guard 409 on save/draft/checkout/sync/comment during merge; abort; non-resolvable fallback shape. **Rebuild `ui/dist`** after the UI lands.

## Batch 4 – Agent CLI: `fragmt agent`

New `src/cli/agent.ts` dispatched from `main()` (`src/cli/index.ts`: `agent` positional + updated usage). AXI-conformant: TOON rows (`name[fields]:` headers, comma rows), aggregates inline, definitive empty states ("0 threads"), errors on **stdout** as `error: …` with exit 1, unknown flags exit 2 (parseArgs strict, caught), `help[n]:` next-step hints after every output, no interactive prompts, `--full` untruncates. Bare `fragmt agent` = status.

- **`fragmt agent [status]`** – `repoMeta` once: `branch: <name>( (protected))? · drafts: N · merge: clean|"in progress – N unresolved"`, then `drafts[N]{branch,doc,status}` rows (empty state: `drafts[0]: none`). Mid-merge: hint "resolve in the fragmt UI".
- **`fragmt agent comment <doc> [--thread <id>] [--body <text>] [--resolve] [--author <"Name <email>">] [--full]`** – default lists `threads[N]{id,author,resolved,replies}` + `– N of M total, K open`; `--thread` shows detail with replies truncated at 120 chars (`(truncated, N chars total – use --full)`); `--thread --body` → `addReply` (`comments.ts`, already user-parameterized – no core change); `--thread --resolve` → `setResolved(true)`; both reply and resolve commit as the `--author` identity. New anchored threads stay a UI act (quote anchoring is a selection gesture) – AGENTS.md says so. Mutations refuse while `inMerge` ("a merge is in progress – finish or abort it first").
- **`fragmt agent draft <doc> [--merge]`** – default: `startDraft` (reuse-or-create) → `ok: on draft <branch> (reused|created)`; `--merge` → `mergeToMain` → `ok: merged to main · branch <b> deleted` | conflict-stood → `error: merge conflict – N files; resolve in the fragmt UI` exit 1 | conflict-aborted → error + file list.
- **`--author` parse:** `Name <email>` git-style; name-only → email `<name-slug>@users.noreply.fragmt` (deterministic placeholder, never a real address). Flows to `commitAs` commits (history attribution free) and sidecar `author` names.
- **Tests** (`tests/agent-cli.test.ts`): pure formatters (status/comment rows, truncation, author parse incl. placeholder) + end-to-end on a temp repo through the dispatch (reply lands with the agent's name, exit codes 0/1/2, help[] lines present).

## Batch 5 – AGENTS.md, agents config, agent chip

- **`src/core/agents.ts`:** `AGENTS_BLOCK` constant (the approved copy: protected main, never hand-edit sidecars, always `--author`, state via `fragmt agent status`, all commands namespaced) + `writeAgentsBlock(repoRoot)`: no AGENTS.md → create with the block; file without markers → append (leading newline); block present → replace between `<!-- fragmt:begin v1 -->` / `<!-- fragmt:end -->`. Nothing outside the markers is touched. `initRepo` (`src/core/init.ts`) calls it after writing `.fragmt.json`; re-running `init` refreshes the block.
- **Config:** `.fragmt.json` gains optional `agents: string[]` (names); `loadConfig` validates (string array, invalid entries ignored). `RepoMeta.agents` carries it verbatim (`[]` default).
- **UI chip:** the comment rail's author line (DocView) renders an `agent` chip (warn-tinted, the artifact mock's style) when `author ∈ meta.agents`; App passes the list down alongside the existing meta plumbing.
- **Tests:** block create/append/replace-on-reinit (init suite), config parse, meta carries agents, chip predicate.

## Batch 6 – Docs

- PLAN.md: M4-4 section + build-status line; spec list link; cut-list MCP row → "dropped – agent surface is the `fragmt agent` CLI (M4-4), HTTP stays UI-private"; Next → M5.
- BACKLOG.md: /api/meta entry gains the measured evidence; the merge-resolution entry is rewritten (engine specced + shipped here – the abort-only estimate is history); the agent item graduates out; header note updated.
- README: an "Agents" section – `fragmt agent`, `--author`, AGENTS.md behavior.

## Order

Batches run sequentially (O1): 1 → 2 → 3 → 4 → 5 → 6, full gates (`typecheck · lint · biome ci · test`) green between batches, `dist` rebuilt after 3, one `m4-4` branch → one PR, owner retests on :4400 before merge.

## Dogfood round (2026-08-20, PR #7)

Three finds from the first post-merge dogfooding:

1. **UI Merge "Failed to fetch" (the merge had succeeded).** `npm run dev:server` ran `tsx watch`, and the merge's `git checkout main` rewrites the very `src/**` the watcher observes – the restart killed the connection racing the response/follow-up refresh (and, in the same race, the post-merge `push --delete` of the branch never made it out). `dev`/`dev:server` now run plain `tsx` – the dogfood posture; `dev:server:watch` keeps the restart loop for src development. Production `fragmt serve` never watched.
2. **The origin folder is the peaceful cancel.** M4-3's `dropTargetValid` blocked same-parent destinations – mid-drag, the natural "put it back" was refused with the blocked cursor, and the only accepting targets were the root and the bin (an accidental root drop followed; the emptied source folder then vanished, closing the in-UI undo). Amended: a drop back on the item's own folder or the root highlights and lands as a **silent no-op** (`isNoOpDrop`, checked where drops funnel in App); Escape also natively ends a drag at any time. Subtree and collision refusals unchanged; the picker still omits the current folder.
3. **A folder emptied by a move no longer vanishes.** The M1 prune rule dropped a folder with no `.md` beneath it from every tree-derived surface – including as a drop target – so the move couldn't be undone in the UI (the recycle bin covers deletions, not moves). `moveDoc`/`renameFolder` now commit a `.gitkeep` into the emptied parent **in the same commit** (createFolder's marker, same contract; rolled back with the move on commit failure), and the tree's keep rule is chain-complete – a kept child folder keeps its parent (this also fixed a latent one-level bug in M4-3 b6's created-folder chains: `createFolder("a/b")` left `a` pruned).

Cleanup from the same session: the stray root `corpus.md` left by the accidental drop (identical to `tests/fixtures/corpus.md`) deleted in its own commit.
