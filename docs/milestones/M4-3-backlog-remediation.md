# M4-3 — Backlog remediation

**Goal:** clear the post-M4-2 dogfooding backlog in one milestone — file actions move to the content header, the sidebar gets sane geometry and drag & drop, the drafting model gains branch deletion, identity resolves real authors, and link navigation covers the remaining cases.
**Proves:** the daily-dogfood friction found on 2026-08-19 is gone: nothing in the navbar is broken, the header tells the truth about drafts and authors, and every kind of link in a doc goes somewhere sane.

Prerequisite: M4-2 complete (PR #4). Decisions locked in a Lavish round on 2026-08-19 (`.lavish/m4-3-backlog-remediation.html`): title↔filename via **frontmatter `title:`**; non-md links via a **raw-file route**; dead links get an **inline note**; **merge-conflict UI and /api/meta performance stay deferred** (cost evidence recorded in BACKLOG.md). Owner amendments from the review: **"/" (docsRoot) is a drag target**; the **gitignore filter covers every tree-derived surface** (@ menu, move picker — all inherit `/api/tree`); the **rename box's confirm/cancel are icon buttons**; **folder links handle empty folders** (a freshly created folder holds no docs yet).

**One deliberate deviation from the approved artifact text:** inline rename writes the frontmatter `title` and **never renames the file** (the artifact's "file is renamed only when it has no title yet" is dropped). Renaming the file would silently break every relative and `@` link pointing at the old path — the display name decouples from the filename instead. Filesystem renames stay a git-level operator action; the M3 move/rename routes are untouched and keep working.

## New dependencies (only these)

None.

## Batch 1 — Quick fixes (client-only)

1. **Edit lands at the top.** In `EditorPane.tsx`'s load effect, right after `setContent(markdown)`, reset the selection to the start (`editor.commands.setTextSelection(0)`) so the caret matches the visible top; the Edit-flip `focus()` then scrolls to the top instead of the end. No change to the flip effect.
2. **`@`/slash menu height cap.** `.slash-menu` gains `max-height: min(340px, calc(100vh - 32px)); overflow-y: auto;` — one rule caps both popups. The keyboard handler scrolls the selected item into view inside the container (`scrollIntoView({ block: "nearest" })` on the registered item).
3. **On-draft badge.** `App.tsx` computes `onDraft = current ≠ main && (meta.drafts[selected] ?? []).some(e => e.branch === meta.current)` alongside the existing main-only `draftBranch`, and passes it to DocView. DocView renders a **non-clickable** `.draft-pill.on-draft` ("on draft") when `onDraft` — the CSS variant has existed unused since M4-2. The clickable on-main pill is unchanged. Per-doc semantics: on a branch that doesn't touch the open doc, no badge.

## Batch 2 — Identity and branches

**Authors map (avatar resolution).** `.fragmt.json` gains an optional `authors` record (email → GitHub username); `loadConfig` parses and validates it (string→string record, invalid entries ignored). `RepoMeta` gains `authors: Record<string, string>` — the config map verbatim, `{}` when absent. `Avatar` in DocView resolves in order: `authors[email]` → noreply heuristic (`@users.noreply.github.com`) → initials. The map is passed down as a prop from App (it already holds `meta`); comment rail avatars, if any gain images later, use the same map.

**Branch deletion.**

```ts
// git.ts — deleteBranch amended (merge's caller unchanged)
deleteBranch(repoRoot, name: string, force = false): Promise<void>  // git branch -d|-D <name>
```

| Route | Body/Query | Returns |
|---|---|---|
| `DELETE /api/branches/:name` | `?force=` | `200 {sha?}`-less `{ok: true}` · name === current → `400 "switch away first"` · unmerged without force → `409 {unmerged: true, error}` · bad name → 400 |

Unmerged detection server-side: catch the `GitError` from `-d`; stdout/stderr matching `/not (fully )?merged/i` → the 409 shape; anything else → the standard `respondGitError`.

UI: `BranchMenu` rows gain a trash icon (lucide) — hidden on the current branch. Click → `window.confirm('Delete branch "X"?')` (the house destructive pattern) → `DELETE` → on the 409 unmerged shape → `window.confirm('"X" has unmerged commits. Force-delete?')` → `DELETE ?force=1` → refresh branches + meta. Deleting the checked-out branch is refused server-side; the UI never offers it on the current row.

## Batch 3 — Sidebar geometry (corner icons untouched this batch)

- **Guide-line indent:** `.folder-children` drops `margin-left` (keep `padding-left: var(--space-4)` + `border-left`) → 16px per level, not 32px.
- **Row minimum width:** the doc list scrolls horizontally (`overflow-x: auto`) instead of clipping (`hidden`); nested rows keep their natural minimum width — a level-5 name reads fully or scrolls, never vanishes.
- **Resizable sidebar:** a 6px drag handle on the sidebar's right edge; pointer drag writes `--sidebar-w` on `:root` (clamp 260–560px), `pointerup` persists to `localStorage` ("fragmt.sidebarW"), restored on load. Hidden ≤768px (the drawer override owns width there).
- **Recycle bin always visible:** `Sidebar.tsx`'s `deleted.length === 0 → return null` is removed; an empty bin renders as a collapsed `Deleted (0)` row. (The M4-2 "hidden when 0" rule is amended — the bin is also the drag-delete target.)

## Batch 4 — Content-header file actions; corner icons deleted

- **Corner icons and their machinery are removed** — `RowActions` in `Menus.tsx`, `.row-corner`/hover-reveal CSS, the doc-row 92px reserve. The folder-badge overlap and the move-popover flash die with it (root causes: no width reserve on folder rows; focus-at-open racing the any-scroll dismissor — not worth fixing on death row).
- **Indicators move after the name** (same batch — they own the freed right edge): folder count badge and `vN` render inline immediately after the card name; nothing right-aligned, so overflow can't hide them.
- **The breadcrumb name becomes `frontmatter.title || basename minus .md`**, and the sidebar cards + `@` menu labels use the same rule. `DocMeta` gains `title: string | null`, extracted in the meta walk's existing per-doc fs read (same gray-matter options-object parse discipline as docs.ts).
- **Three icon buttons right of the name** (lucide `Pencil`, `FolderInput`, `Trash2`; ≥32px targets, aria-labels), visible in read and edit mode:
  - **Rename** → the name becomes an inline input (initial = current display name). Confirm = icon button (lucide `Check`), cancel = icon button (`X`) — icons, not text, per the review. Enter saves, Escape cancels. Save calls `PATCH /api/docs/:path {title}` (new branch of the existing move route: `to` = move, `title` = rename). Empty input = cancel.
  - **Move** → a popover listing every folder from the tree, **including "/ (root)"** — selection calls the existing `PATCH {to}` move op. After: tree + meta + doc refresh, selection follows the new path.
  - **Delete** → `window.confirm("Delete <name>? The removal is committed.")` → the existing DELETE op → selection clears, tree + meta refresh.
- **Server: `PATCH /api/docs/:path {title}` → `setTitle(repoRoot, docsRoot, docPath, title)`** (docs.ts): read doc → parse frontmatter → set `title` → reattach through the existing byte-discipline write path → **one commit** `Rename <docPath> to <title>`. The file path never changes. Empty/whitespace title → 400.
- **Gates, in this order:** dirty buffer → the existing save-or-discard guard (as branch switch); on main → the existing draft gate (`beforeEdit`) — a title write is a doc-body write under protected main. After the commit the doc reloads (frontmatter changed) and meta refreshes.

## Batch 5 — Drag & drop (HTML5, no library)

- Doc rows and folder rows are `draggable`; `dragstart` carries the path + type.
- **Drop targets:** folder rows (move into), **"/" the docsRoot root** — the list container's own background — (move to top level), and the recycle bin (delete). Targets highlight on `dragover`.
- Drops reuse the batch-4 ops exactly: doc → `moveDoc(from, folder + "/" + basename)`; folder → `renameFolder(from, folder + "/" + basename)`; bin → confirm + the existing delete ops. Root drop = folder `""`.
- Guards: no-op when the destination equals the current parent; a folder never drops into itself or its own subtree (path-prefix check). Pointer-only by design — the header icons are the keyboard path (a11y note, accepted).

## Batch 6 — Link navigation completion

`resolveLinkTarget` (links.ts) extends to a five-way dispatch; read mode acts on click, edit mode on Ctrl/Cmd+click (unchanged modifiers):

| href resolves to | Behavior |
|---|---|
| doc in tree (fragment stripped for matching) | in-app navigate; a `#fragment` scrolls to the heading after render |
| `#fragment` alone | smooth-scroll to that heading in the open doc |
| folder in tree | expand it in the sidebar; select its first doc if one exists, else just expand (a freshly created folder may hold none — it stays visible via `.gitkeep`) |
| non-md relative file | open `/api/raw/<path>` in a **new tab** (`noopener`) |
| relative but matching nothing (dead link) | `preventDefault` + a small dismissable note under the breadcrumb: `Link not found: <href>` — no tab hijack |
| external / `../` escape | unchanged (new tab / browser default) |

- **Heading ids:** after `setContent` (both modes — one code path), a DOM walk over the editor assigns `id` = GitHub-compatible gfm slug of the heading text (lowercase, keep Unicode letters/digits, strip other punctuation, spaces → `-`, dedupe with `-1` suffixes). `slugifyHeading(text, seen)` is a pure exported helper.
- **Raw route:** `GET /api/raw/*` — the `resolveDocPath` containment guard minus the `.md` constraint, files only. Mime from a short extension map; `html`/`svg` serve as `text/plain` (never execute repo content in the app origin); unknown extensions → `application/octet-stream` (download); missing → 404.
- **Tree amendment:** `buildDir` keeps a folder that contains a `.gitkeep` even with no docs beneath (created folders stay visible until their first doc exists — the M1 prune rule is otherwise a disappearance bug from the operator's seat).

## Batch 7 — `.gitignore` in the doc tree

- `GET /api/tree` becomes async and builds an allow-list per refresh: `git ls-files --cached --others --exclude-standard -z -- <docsAbs>` (one spawn, the existing execFile seam) → docsRoot-relative POSIX paths → `Set`. `listTree(repoRoot, docsRoot, allow?)` — entries not covered are skipped; the existing docless-dir prune runs after. Tracked-wins is inherent (`--cached` lists the index; ignore rules never apply to tracked files). `GitError` → fall back to today's hardcoded skips (one try/catch; keep-prior-state pattern).
- The filter lives in `/api/tree`, so **every tree-derived surface inherits it**: the sidebar, `@` menu items, the move picker's folders, and the link known-doc set. `/api/meta` (git-history walks) is untouched by construction. `init`'s doc count keeps the two-arg call.

## Tests

- Batch 1: none new beyond existing suites — flip-to-edit scroll and pill states get happy-dom assertions where the existing DocView/EditorPane tests allow; the CSS cap is visual.
- Batch 2: `config.test.ts` — authors parsing (valid/invalid/absent); `meta.test.ts` — `authors` in RepoMeta; `server-m43.test.ts` — DELETE branch (200 / 400 current / 400 bad name / 409 unmerged / force 200); `git` force flag asserted via behavior (unmerged branch deletable only with force).
- Batch 3: none server-side; geometry is CSS (visual acceptance).
- Batch 4: `docs.test.ts` — `setTitle` (creates and updates `title`, one commit, byte-discipline on the rest of the frontmatter, path unchanged, stale baseHash semantics if applicable); server PATCH `{title}` vs `{to}` dispatch; UI — rename box Enter/Escape/empty-cancel (happy-dom).
- Batch 5: happy-dom dnd simulation where practical (dataTransfer paths, self-drop guard unit test on the pure path-prefix helper); op routing asserted against existing endpoints.
- Batch 6: `links.test.ts` — the five-way dispatch (incl. fragment stripping, folder match, dead link, non-md); `slugifyHeading` pure cases (unicode, punctuation, dedupe); `server-m43` — raw route (200 + mime, 404, traversal 400, html-as-text/plain); tree `.gitkeep` visibility case.
- Batch 7: `tree.test.ts` — allow-list filtering, tracked-but-ignored kept, GitError fallback; server `/api/tree` unaffected shape.

## Acceptance

1. Clicking Edit keeps the scroll at the top; `@` opens a capped, internally scrolling menu (keyboard selection follows).
2. On a draft branch touching the open doc: the header shows the "on draft" badge; on main with a draft elsewhere: the clickable pill; on an unrelated branch: neither.
3. `.fragmt.json` authors map resolves the real Gmail author's GitHub avatar (initials before, avatar after).
4. Branch dropdown deletes a dead branch; an unmerged one asks twice; the current one doesn't offer deletion.
5. A 5-level-nested card reads fully (or the list scrolls); indicators sit after the name; the sidebar drags to resize and remembers.
6. The bin is visible with zero deletions; restore still works.
7. Rename in the header turns the name into an inline box with icon confirm/cancel; the sidebar card and `@` menu show the new title immediately; the file path and every existing link still work.
8. Move offers "/ (root)" and folders; dragging a doc onto a folder, onto the list background, and onto the bin does move, move-to-root, and confirm-delete respectively; dropping a folder into its own child does nothing.
9. In a doc: `#heading`, `doc.md#section`, a folder link, an image link, and a typo'd `.md` link each behave per the dispatch table — nothing navigates the app tab away.
10. A scratch folder ignored by `.gitignore` disappears from the sidebar, the `@` menu, and the move picker; a force-added tracked file inside it stays.

## Guardrails for implementers

- Every mutation stays **one `commitAs` per logical action**; the stale check before any disk write; never re-serialize frontmatter except the explicit `title` key `setTitle` writes.
- All git through the execFile seam; no new git flags beyond the spec'd commands; no new npm dependencies.
- The rename box never rewrites the filename — title writes only.
- Raw route serves repo content as data, never as same-origin HTML/SVG.
- Deleted docs never render as tree nodes; ignored paths never render on any tree-derived surface.
- ponytail ceilings to mark in code: per-refresh `ls-files` spawn (per-tree-refresh, not cached); dnd as pointer-only; slug dedupe counter unbounded.
- Do not build: merge-conflict resolution UI, `/api/meta` caching, PR creation, agentic surfaces (M4-4 / backlog).
