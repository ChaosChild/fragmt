# Draft change visibility in the content area (#18)

Backlog round 2, 2026-09-01. Issue: [ChaosChild/fragmt#18](https://github.com/ChaosChild/fragmt/issues/18). The approach was locked in the issue body: a changed-lines gutter as a decoration, not a diff surface – side-by-side or per-hunk diff views stay v1.x+.

## What ships

When the open doc sits on its draft branch, an amber bar (`var(--warn)`, 3px) appears beside every top-level content block the draft's commits touched. Works in read and edit mode (one mounted editor serves both). The main pane only – the slideout preview never receives the payload.

## Pipeline

1. **Core** – `src/core/drafts.ts`:
	- `parseDiffNewLines(diffText)` – `git diff -U0` hunk headers → new-side inclusive line ranges; a pure deletion (d=0) collapses to the join line.
	- `draftDiffLines(repoRoot, docsRoot, docPath)` – exactly one spawn, `git diff main..HEAD -U0 -- <pathspec>`, plus the branch reads `repoMeta` already pays. Returns `[]` on main, mid-merge, or without a diff – the gutter is a decoration, never an error surface. File-line ranges are shifted to body-relative by counting the raw file's frontmatter fence pair and the leading/trailing blanks `canonicalBody` strips; CRLF is normalized first. A newly added doc clamps to the whole body.
2. **Server** – `src/server/index.ts`: `GET /api/draft-diff/*` → `{doc, lines}`; `resolveDocPath` is the traversal guard, missing file → 404, malformed path → 400. Sits next to `POST /api/draft`.
3. **Mapping** – `ui/src/draft-gutter.ts` (pure, zero imports):
	- `sourceBlockSpans(body)` – top-level markdown blocks as 1-based inclusive spans: blank-line separated, fence-aware (``` and ~~~, closer at least as long as the opener; blank lines inside never split).
	- `mapRangesToBlocks(ranges, spans, blockCount)` – indices whose span intersects any range. **Correct-or-absent guard:** if source spans and the editor's top-level child count disagree, it returns an empty set rather than mislabel a block. `ponytail:` ceiling – tiptap-markdown exposes no source maps, so this blank-line heuristic is the whole mapping; upgrade path is upstream source-map support.
4. **Render** – `ui/src/EditorPane.tsx` + `ui/src/styles.css`: a clear-then-mark DOM walk (the heading-id pass's pattern) adds `.draft-changed` to matching top-level children of `view.dom` (ProseMirror renders each top-level doc node as exactly one element child). The class lives only in the rendered DOM, never the markdown. CSS bar sits 12px left of the text, inside the pane's 32px padding, so it never clips.
5. **Wiring** – `ui/src/DocView.tsx` fetches `getDraftDiff(selected)` when the existing `onDraft` signal fires, refetching on doc/branch change; off-draft and fetch failure both clear to no marking.

## Excluded

The slideout preview pane (no gutter), pure-deletion visualization beyond the join line, and any diff-view UI – v1.x+ per the issue.

## Tests

19 across three files: `tests/draft-diff.test.ts` (parser units + tmp-repo integration: frontmatter shift, [] on main/no-diff/mid-merge, new-doc whole-body), `tests/draft-gutter.test.ts` (spans for headings/fences/loose lists/tables; mapping overlap/gap/count-bail; happy-dom headless-editor walk), `tests/server-draft-diff.test.ts` (200 on draft, 200 `[]` on main, 404 unknown).
