# M3 — Files & branches

**Goal:** full doc/folder lifecycle and branch-based drafting; the server keeps the local clone in sync with the remote automatically.
**Proves:** the git layer handles real editing workflows, not just single-file saves (M2).

Prerequisite: M2 complete (see M2-round-trip-editing.md). M3 reuses the `git()` wrapper, `commitAs()`, `localUser()`, and the `resolveDocPath` guard — it adds git commands and file ops on top, nothing new underneath.

## New dependencies (only these)

None. M3 is built entirely on M2's git layer + the `commitAs` mutation seam.

## Core additions (src/core/)

```ts
// git.ts — additions to the M2 wrapper (still execFile, never shell:true)
currentBranch(repoRoot: string): Promise<string>            // git rev-parse --abbrev-ref HEAD
listBranches(repoRoot: string): Promise<string[]>           // git for-each-ref refs/heads --format
createBranch(repoRoot: string, name: string): Promise<void> // git branch <name>
checkoutBranch(repoRoot: string, name: string): Promise<void> // git checkout <name>
pullRebase(repoRoot: string): Promise<SyncResult>           // git pull --rebase; aborts on conflict
push(repoRoot: string): Promise<void>                       // git push

// sync.ts — one function, three triggers (ARCHITECTURE §4)
type SyncResult = { conflict: boolean; message?: string };
sync(repoRoot: string): Promise<SyncResult>
// = pullRebase() then push(). Saves already commit in M2, so the working tree is
//   always clean between user actions — sync never races an uncommitted buffer.
//   On any conflict: git rebase --abort, return {conflict:true, message}. Never
//   force-push, never leave a rebase in progress.

// files.ts — each op is ONE commit via commitAs; both ends of a move pass resolveDocPath
createDoc (repoRoot, docsRoot, docPath: string, body?: string): Promise<{ sha: string }>
moveDoc   (repoRoot, docsRoot, from: string, to: string): Promise<{ sha: string }>   // git mv + commit
deleteDoc (repoRoot, docsRoot, docPath: string): Promise<{ sha: string }>            // git rm + commit
createFolder (repoRoot, docsRoot, folderPath: string): Promise<{ sha: string }>
renameFolder (repoRoot, docsRoot, from: string, to: string): Promise<{ sha: string }>
deleteFolder (repoRoot, docsRoot, folderPath: string): Promise<{ sha: string }>
```

**Folder model:** git does not track empty directories. `createFolder` writes a `.gitkeep` (a dotfile, so M1's tree never lists it). A folder containing `.md` needs none. `deleteFolder` is `git rm -r`. Folder paths get the same docsRoot containment check as docs (extend `resolveDocPath` to allow a non-`.md` target only for folder ops).

**Branch buffer:** saves are immediate commits (M2), so on-disk state is always clean between user actions; the editor's in-memory buffer is separate from disk. `sync()` therefore runs safely at any time. A branch switch reloads the open doc from the new branch; if the editor holds unsaved changes, the UI blocks the switch with a "save or discard" prompt — never a silent loss.

## Server additions

JSON only; every error body is `{ "error": string }`.

| Route | Returns |
|---|---|
| `POST /api/docs` | body `{ path, body? }` → createDoc → `200 { sha }`. Exists → `409`. |
| `PATCH /api/docs/*` | body `{ to }` → moveDoc → `200 { sha }`. |
| `DELETE /api/docs/*` | → deleteDoc → `200 { sha }`. |
| `POST /api/folders` · `PATCH /api/folders/*` · `DELETE /api/folders/*` | analogous |
| `GET /api/branches` | `{ current: string, branches: string[] }` |
| `POST /api/branches` | `{ name, base? }` → createBranch (+ checkout) → `200` |
| `POST /api/checkout` | `{ name }` → checkoutBranch → `200` |
| `POST /api/sync` | `SyncResult` |

Path-guard violations → `400`. Conflict / non-fast-forward → `409 { error }`, surfaced as the calm-feedback banner (never a merge UI — DESIGN.md "conflict resolution").

## UI additions

- **Branch dropdown** (sidebar head, reads as metadata "on main"): list + create + switch. Switching reloads tree + open doc from the new branch.
- **File ops:** create (a "new doc" action), rename/move/delete (per-doc, in fixed places — never hover-only, DESIGN §5). Folders the same.
- **Sync LED** (`.led` three-state — green synced / amber unsaved / red not synced): driven by `sync()` result + save state.
- **`sync()` triggers** wired client-side: `setInterval` (~60s), `window` focus, and before entering edit mode. A conflict → LED red + banner.
- No merge UI. Conflicts offer only "resolve in your editor / on GitHub".

## Tests

- `git.test.ts` (tmp repo via `git init`): createBranch/listBranches/checkout round-trip; `pullRebase` clean and conflict-abort paths.
- `files.test.ts`: create/move/delete doc + folder each produce exactly one commit with the correct author; traversal rejection on move targets (both ends).
- `sync.test.ts`: sync pushes + pulls; a constructed upstream conflict aborts and leaves HEAD intact.

## Acceptance

1. Create a doc in the UI → it appears in the tree; `git log -1` shows one commit `Create <path>`.
2. Rename then move a doc → one commit each (`git mv`), old path gone, history follows.
3. Branch dropdown: create `drafts/x`, switch, edit, switch back — tree + content reflect each branch.
4. Edit the file on disk (or a second clone), then focus the window → sync pulls the change; tree/doc update without a reload.
5. A real rebase conflict → LED red + banner naming the file + the one action; `git status` clean (rebase aborted), never a half-state.

## Guardrails for implementers

- Every file op goes through `commitAs` — no raw `git` outside `git.ts`, no `fs` outside the op functions.
- `sync()` never force-pushes and never leaves a rebase in progress — `--abort` on any conflict.
- Folder ops must never orphan a doc (move a folder by moving its contents atomically).
- Do not build: comment UI/sidecar (M4), conflict-resolution UI beyond the banner (v1.x), PR create/review (v2), worktrees (v2).
- M1 guardrails still hold: no router/state-lib/CSS-framework; UI talks HTTP only.
