# M4 — Comments

**Goal:** inline self-notes anchored to text, versioned alongside the docs in the same repo.
**Proves:** the ProseMirror mark + sidecar design from ARCHITECTURE §2 works end-to-end.

Prerequisite: M2 complete. The `CommentMark` is already plumbed through the editor and proven to survive round-trips (the M2 corpus test) — it is invisible plumbing until M4 wires a UI + sidecar to it.

## New dependencies (only these)

None. (`crypto.randomUUID` is built-in; the editor + git layer come from M2.)

## Core additions (src/core/)

```ts
// comments.ts
interface CommentThread {
  id: string;        // == the data-c span id in the doc body
  quote: string;     // snapshot of the marked text, captured ONCE at creation
  author: string;    // from localUser() (M2); v2 = GitHub identity
  createdAt: string; // ISO
  resolved: boolean;
  replies: { author: string; body: string; at: string }[];
}
type CommentFile = { comments: Record<string, CommentThread> };

sidecarPath(repoRoot: string, docPath: string): string
  // .docs/comments/<docPath>.json, docPath taken literally (slashes nest):
  //   docs/PLAN.md → .docs/comments/docs/PLAN.md.json
  // guarded by the same docsRoot containment logic as resolveDocPath.
readComments(repoRoot: string, docPath: string): Promise<CommentFile>                  // {comments:{}} if none
writeComments(repoRoot: string, docPath: string, file: CommentFile): Promise<{ sha: string }>  // JSON + commitAs

// read-modify-write helpers through writeComments:
addThread   (repoRoot, docPath, id, quote, author, body): Promise<{ sha }>
addReply    (repoRoot, docPath, id, author, body): Promise<{ sha }>
resolveThread(repoRoot, docPath, id): Promise<{ sha }>
deleteThread(repoRoot, docPath, id): Promise<{ sha }>
```

**Anchoring contract:** creating a comment applies the `CommentMark` to the selection with a fresh `crypto.randomUUID` (editor side), saves the doc through the M2 `writeDoc` seam, AND writes the sidecar entry through `writeComments`. Two files change → two sequential commits via `commitAs` (doc, then sidecar), both attributed to the local identity. Deleting a thread removes the span on the next save AND removes the sidecar entry — one logical action.

**Orphan rule:** the UI reconciles mark ids present in the rendered markdown against sidecar ids. A sidecar thread whose id has no live span renders as an **orphan** (`docs/app.html` `.comment-thread.orphan`): the quote snapshot + thread body + "original text no longer in document" + a Delete action. Edits outside the editor that delete a span are the known, accepted degradation (ARCHITECTURE §2) — the snapshot exists precisely so orphans still make sense.

## Server additions

| Route | Returns |
|---|---|
| `GET /api/docs/*/comments` | the `CommentFile` |
| `POST /api/docs/*/comments` | `{ id, quote, body }` → addThread → `200 { sha }` |
| `PATCH /api/docs/*/comments/<id>` | `{ resolved?, body?, reply? }` → resolve/reply → `200 { sha }` |
| `DELETE /api/docs/*/comments/<id>` | deleteThread → `200 { sha }` |

The docPath segment is guarded like `readDoc`; the `<id>` segment is opaque (no path resolution).

## UI additions

- **Selection → comment:** selecting text in the editor shows ONE small affordance (DESIGN §5 — no hover minefield) → an inline thread composer. Submit applies the mark + writes the sidecar + reloads.
- **Comments rail** (`docs/app.html` right margin): threads with quote snapshot on top, author/time, body, actions (Reply / Resolve / Delete). Resolved hidden by default with a toggle. The rail carries the sync LED + theme toggle (per `app.html`).
- **Anchored highlights in read mode:** `<span data-c>` rendered with the `.comment-highlight` tint; click scrolls to its thread + flashes.
- **Orphan threads** render with the orphan style + note + Delete.

## Tests

- `comments.test.ts` (tmp repo): addThread writes the sidecar in one commit; resolve/reply/delete mutate correctly; reading a missing sidecar returns `{comments:{}}`; traversal rejection on the sidecar path.
- Orphan logic: unit-test the pure reconcile function — a sidecar thread whose id is absent from the doc body is flagged orphan.
- The M2 corpus round-trip still passes — adding/removing comment spans must not regress serialization.

## Acceptance

1. Select text in the editor → comment → the doc saves with a `<span data-c="…">` and the sidecar gains a thread; the rail shows it.
2. Resolve a thread → rail updates (under the resolved toggle); the span stays in the doc (resolve ≠ delete).
3. Delete a thread → span removed on next save + sidecar entry gone (one logical action).
4. Edit the marked text out of the doc externally → the thread shows as an orphan with its quote snapshot + Delete.
5. `git log` shows comment changes as ordinary commits attributed to the local identity; `git diff` is markdown + a JSON sidecar — reviewable on GitHub.

## Guardrails for implementers

- Comment mutation always goes through `commitAs`; thread content lives ONLY in the sidecar (never in the doc).
- Never re-serialize the doc's YAML frontmatter (M2 rule) when adding/removing a mark.
- The mark id is the single link between span and thread — never store offsets (they drift; mark-anchoring exists to avoid exactly that).
- Do not build: PR-review comments (v2 — those are GitHub's, used as-is), real-time collaboration, special "AI content" styling for agent edits.
