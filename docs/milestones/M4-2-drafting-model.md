# M4-2 — Dogfood polish: cards, headers, and the drafting model

**Goal:** close the navigation and doc-header gap to the v1-final mock, and finish the drafting model — protected main, visible drafts, operator-driven merge, deletions reversible.
**Proves:** daily dogfooding becomes natural: drafts are visible where you browse, merging is your call, and the doc lifecycle (create → edit → merge → delete → restore) has no dead ends.

Prerequisite: M4 complete (PR #3). Decisions locked in two Lavish rounds on 2026-08-18 (`.lavish/m4-2-plan.html`): cross-branch draft visibility; protected main = every doc-body write (edits, comment spans, new-doc creation — sidecar-only ops stay on main); one-commit comments folded in as item 10; the sidebar-head design pass folded in as item 11; avatars via the keyless GitHub noreply heuristic with initials fallback; a recycle bin for deletions (never rendered in the tree); one global Merge affordance with the branch auto-deleted after a clean merge.

## New dependencies (only these)

None. `lucide-react` shipped in M4; avatars are a plain `<img>` with an `onerror` fallback.

## Core additions (src/core/)

```ts
// git.ts — new thin commands over the same execFile seam
logCommits(repoRoot, args: string[]): Promise<string>  // git log <args>; caller owns format/filters
showRef(repoRoot, ref: string): Promise<string>        // git show <ref> — file content by ref
mergeBranch(repoRoot, name: string): Promise<void>     // git merge <name> --no-edit
deleteBranch(repoRoot, name: string): Promise<void>    // git branch -d <name>
```

```ts
// meta.ts — new
interface DocMeta { author: string; authorEmail: string; date: string; version: number }
interface DraftEntry { branch: string; status: "new" | "edited" | "deleted" }
interface DeletedDoc { path: string; sha: string; date: string }  // sha = the delete commit (for ^ restore)
interface RepoMeta {
  main: string | null;            // "main" → "master" → null; null = no draft model (chips hidden, main unprotected)
  current: string;
  docs: Record<string, DocMeta>;  // docsRoot-relative .md paths
  drafts: Record<string, DraftEntry[]>;
  deleted: DeletedDoc[];          // deletions reachable from HEAD, latest first, deduped by path
}
mainBranch(repoRoot): Promise<string | null>
repoMeta(repoRoot, docsRoot): Promise<RepoMeta>
```

Three walks, each a small spawn count (ponytail ceilings, mark in code):

1. `git log -n 2000 --format=%H%x1f%an%x1f%ae%x1f%aI%x1e --name-only` — one pass over HEAD history: per docsRoot `.md` path, count commits (version) and keep the newest author/email/date. No `--follow`: a rename restarts the count (accepted ceiling).
2. Per non-main branch B (from `listBranches`): `git log -n 500 <main>..B --name-status --format=%H` — A→`new`, M→`edited`, D→`deleted`; latest status per (branch, path) wins. N branches = N spawns (few, personal tool — ceiling noted).
3. `git log -n 200 --diff-filter=D --format=%H%x1f%aI%x1e --name-only` — the recycle-bin list, filtered to docsRoot `.md`.

```ts
// drafts.ts — new
nextDraftName(existing: string[], docPath: string): string
  // pure: drafts/<slug>; slug = basename minus .md, lowercase, non-[a-z0-9] → "-", trim "-";
  // collisions append -2, -3, …
startDraft(repoRoot, docPath: string): Promise<{ current: string; reused: boolean }>
  // already on a non-main branch → {current, reused: true} (no-op)
  // an existing drafts/* branch whose <main>..<branch> diff touches docPath → checkout it, reused: true
  // else createBranch + checkout drafts/<nextDraftName(listBranches(), docPath)>, reused: false
mergeToMain(repoRoot): Promise<{ merged: true; sha: string } | { merged: false; conflict: true; message: string }>
  // current must ≠ main (server 400s; UI disables)
  // checkout main → mergeBranch(current); conflict → merge --abort + checkout <current> back
  //   → {merged: false, conflict: true, message} — HEAD and the draft untouched, user not stranded
  // success → branch -d <current>; best-effort remote cleanup: branch.<name>.remote configured
  //   → push <remote> --delete <name>, GitError ignored
restoreDoc(repoRoot, docsRoot, docPath: string, deleteSha: string): Promise<{ sha: string }>
  // body = showRef(<deleteSha>^:<repo-relative doc path>); sidecar =
  //   showRef(<deleteSha>^:.docs/comments/<docPath>.json) — missing ref → sidecar skipped
  // resolveDocPath containment guard; existing doc at path → PathExistsError
  // write doc (LF-canonical) + sidecar bytes → ONE commitAs: `Restore <docPath>`
```

```ts
// comments.ts — amended
setResolved(repoRoot, docPath, id, resolved: boolean): Promise<{ sha }>  // replaces resolveThread
stripCommentSpan(body: string, id: string): string
  // pure, exported: removes `<span data-c="id">` and its MATCHING `</span>` — linear indexOf
  // walk to the next close tag (spans never nest), inner text kept; unknown id → body unchanged
addThreadWithDoc(repoRoot, docsRoot, docPath, { id, quote, author, body, docBody, baseHash }): Promise<{ sha }>
  // writeDoc's full discipline — identity resolved first, stale-hash check on baseHash BEFORE any
  // disk write, byte-for-byte frontmatter reattach, LF-canonical body — then the sidecar too:
  // ONE commitAs: `Comment on <docPath>`
deleteThreadWithDoc(repoRoot, docsRoot, docPath, id, baseHash): Promise<{ sha }>
  // stale-check → stripCommentSpan on the current body → write doc + sidecar (entry removed):
  // ONE commitAs: `Remove comment on <docPath>`
```

The shared doc-write prep (identity, stale check, frontmatter reattach, normalization) is extracted from `writeDoc` and reused by the combined ops — not duplicated.

## Server additions

| Route | Body | Returns |
|---|---|---|
| `GET /api/meta` | — | `RepoMeta` |
| `POST /api/draft` | `{docPath}` | startDraft → `200 {current, reused}` |
| `POST /api/merge` | — | mergeToMain → `200 {sha}` · conflict → `409 {conflict: true, message}` · on main → `400` |
| `POST /api/restore` | `{path, sha}` | restoreDoc → `200 {sha}` · exists → `409` |
| `POST /api/docs/*/comments` | `{id, quote, body, docBody?, docBaseHash?}` | docBody present → `addThreadWithDoc` (one commit); else sidecar-only `addThread` |
| `DELETE /api/docs/*/comments/:id?baseHash=` | — | baseHash present → `deleteThreadWithDoc` (one commit); else sidecar-only `deleteThread` |
| `PATCH /api/docs/*/comments/:id` | `{resolved: true \| false}` | `setResolved` — the `true`-only pin is lifted |

Errors keep the `respondFileError` mapping (DocPath 400, NotFound 404, PathExists/GitIdentity/StaleDoc 409).

## UI additions

- **Two-row sidebar head** (item 11): row 1 = brand + `+`; row 2 = branch selector at full width (ellipsis + `title`) + the **global Merge button**. Theme + sync stay in the comments rail. The `+` popover gains **New folder** (New document stays default) — `createFolder` finally gets a caller.
- **Cards** (item 1): `.dc-title` without `.md`, `.dc-ver` = `vN`, `.dc-meta` = author · date (+ `.dc-draft` status chip), `.dc-snippet` = first non-heading, non-empty body line clamped ~110 chars (fs read, not git). The row kebab stays on every card, **revealed on hover/focus-within** (≥32px target, keyboard-reachable) — actions unchanged (RowMenu).
- **Draft visibility, cross-branch** (item 2): docs that differ from main show the draft chip (`draft` for edits, `new` for additions) on every branch; docs existing only on drafts render as **ghost cards** in their folders (folders materialize to hold them) — clicking a ghost card checks out its branch and opens it. On main, the chip marks docs changed elsewhere.
- **Recycle bin** (item 9): a collapsed `Deleted (N)` row at the sidebar bottom (hidden when 0); expands to path · date · **Restore** per row with **Restore all** right-aligned beneath — all restore buttons on the same side. Deleted docs never render as tree nodes. Restores run sequentially, then the tree and meta refresh.
- **Doc head** (item 3): avatar — `https://avatars.githubusercontent.com/<user>?s=76` when `authorEmail` matches the `users.noreply.github.com` pattern (`123456+user@` or `user@`); `onerror` and non-matches fall back to initials. Author name, `vN · branch`, and read mode adds `saved <relative time>` while edit mode says `editing` + the unsaved LED — the rail's one-word status vocabulary, reused. Doc actions move into the head: read = Comments (with badge) + Edit; edit = Cancel (lucide `X`) + Save (lucide `Check`, "Saving…"). The **draft pill appears only on main**, when a draft elsewhere touches the open doc: `draft exists — open` → checkout. The old doc bar keeps only the breadcrumb.
- **Protected main** (item 7): Edit, read-mode comment creation, and new-doc creation on main each call `POST /api/draft {docPath}` first — no prompt — refresh branch/tree/meta, then proceed; the header names the new branch. Sidecar-only ops (reply/resolve/reopen) and folder create/rename stay on main. Merge is the sanctioned write.
- **Merge** (item 8): the global button, enabled only on a draft with unmerged changes (`title` = "N docs changed"); `POST /api/merge` → success refreshes to main (tree, meta, doc reload); `409` → the existing conflict banner. The merged branch vanishes from the dropdown (deleted server-side, so the dropdown lists only active branches).
- **Reopen** (item 4): resolved cards show Reopen + Delete — the mock's `.comment-thread.resolved` shape.
- **`@` references** (item 5): a second `Suggestion({char: "@"})` extension beside the slash menu (own plugin key) — items = tree docs (title sans `.md` + path), substring filter over title + path, ↑↓/Enter/Escape; Enter applies the `link` mark (href = repo-relative path, text = title). Comment reply textareas get a minimal input-listener variant (detect `@…` at the caret, filtered list, insert the path text), and rendered bodies linkify known doc paths (longest-first match) to the same in-app navigation.
- **Link clicks, minimal set**: read mode — an href that resolves (against the current doc's directory) to a doc in the tree navigates in-app; `http(s)` opens `target="_blank" rel="noopener noreferrer"`; anything else keeps browser default. Edit mode — Ctrl/Cmd+click follows. Anchor scrolling, non-doc targets, folder links: the full backlog item, not this milestone.

## Tests

- `meta.test.ts` (tmp repo, multi-branch): version counts, newest author/email/date, per-branch draft statuses, `main` → `master` fallback, null-main shape, deleted list (sha + date, dedup).
- `drafts.test.ts`: `nextDraftName` pure cases (slugification, collisions); `startDraft` create / reuse / on-draft no-op; `mergeToMain` happy path (branch gone after, merge commit, sha) and conflict (abort, back on the draft, tree clean); `restoreDoc` (doc + sidecar in one commit, `PathExistsError`, missing sidecar tolerated).
- `comments.test.ts` amendments: `setResolved(false)`; `addThreadWithDoc` — one commit, message `Comment on <path>`, both files in it, stale `baseHash` → `StaleDocError` with zero disk writes; `deleteThreadWithDoc` — one commit, span stripped; `stripCommentSpan` unit cases (multiple spans, adjacent spans, unknown id → unchanged).
- `server-m42.test.ts`: `/api/meta`, `/api/draft` (create + reuse + on-draft no-op), `/api/merge` (200 / 409 / 400-on-main), `/api/restore` (200 / 409 / 400 traversal); comments `PATCH {resolved: false}` → 200 (replaces the old 400 pin); `POST …/comments` with `docBody` → a single commit (`rev-list` delta 1).
- `at-references.test.ts` (happy-dom): `@` item filtering; the link-resolution helper (pure join/normalize against the tree).
- Corpus gate: add a `[title](docs/x.md)` case if the corpus lacks one — the Link mark is StarterKit's, already in the gated set.

## Acceptance

1. On main: Edit a doc → auto-switch to `drafts/<slug>` (no prompt), header reads `editing vN · drafts/<slug>`, the save lands on the draft, the card grows a draft chip.
2. Edit two docs on the draft → global Merge → both land on main in one merge, the branch disappears from the dropdown, the UI is back on main.
3. Move main externally, then Merge → conflict banner, still on the draft, HEAD clean.
4. Comment on a clean buffer → `git log -1` shows ONE commit (`Comment on docs/…`) touching doc + sidecar; delete → ONE commit (`Remove comment on …`), the span gone from the file immediately.
5. Resolve → Reopen → the thread returns to the open list; one commit each way.
6. Delete a doc → it leaves the tree and appears in the bin; Restore → back with content and comments in one commit.
7. `@` in a doc filters the menu and inserts a link; clicking it in read mode navigates in-app; an external link opens a new tab.
8. `+` → New folder → the folder appears; `+` → New document on main auto-drafts.
9. Cards show author · date · `vN` · snippet without `.md`, the kebab appears on hover, the avatar renders from GitHub when the email allows.

## Guardrails for implementers

- Every mutation is **one `commitAs` per logical action** — the `files` array carries multi-file actions; no second commit for sidecars.
- The stale-hash check runs BEFORE any disk write in every combined op.
- Never re-serialize frontmatter; containment guards wrap every path entering or leaving git.
- All git goes through the `execFile` seam — no git flags beyond the wrappers above without amending this spec; no new npm dependencies.
- Deleted docs never render as tree nodes — the bin is their only surface.
- ponytail ceilings, marked in code: the 2000-commit history cap, per-branch diff spawns, no `--follow`, restore's lack of rename tracing, best-effort remote branch delete.
- Do not build: PR creation UI, conflict-resolution UI, anchor scrolling, multi-user anything (all backlog'd).
