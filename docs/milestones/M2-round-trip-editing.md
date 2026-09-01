# M2 – Round-trip editing

**Goal:** open a doc in Tiptap, edit it, save – the save is a git commit whose diff touches only what the user changed.
**Proves:** the spike's round-trip result (docs/SPIKE.md) holds in a real browser. Deliberately before file ops – riskiest first.

Prerequisites: M0 + M1 complete. Read docs/SPIKE.md Findings before implementing; `spikes/roundtrip/tiptap-test.mjs` is the reference implementation for the editor config.

## New dependencies (only these)

- UI: `@tiptap/react`, `@tiptap/core`, `@tiptap/starter-kit`, `@tiptap/extension-list`, `@tiptap/extension-table`, `@tiptap/extension-image`, `tiptap-markdown`
- Dev: `happy-dom` (for the corpus test – the spike showed tiptap-markdown/ProseMirror need a DOM in Node)

Pin the same major versions the spike validated: Tiptap 3.x, tiptap-markdown 0.9.x.

## Editor configuration – single source of truth

Create `ui/src/editor/extensions.ts` exporting one array used by BOTH the React editor and the corpus test:

- StarterKit
- TaskList + TaskItem (from `@tiptap/extension-list`)
- Table + TableRow + TableCell + TableHeader
- Image
- `Markdown` from tiptap-markdown, configured `{ html: true }`
- `CommentMark` – port the custom mark from `spikes/roundtrip/tiptap-test.mjs` **unchanged in behavior**: mark name `comment`, `parseHTML: span[data-c]`, `renderHTML` emits `<span data-c="...">`, attribute `id` mapped to `data-c`. TypeScript-ify it; do not "improve" the serialization.

The corpus test importing this exact array is the point: if anyone changes the editor config, the round-trip test judges the change.

## Core additions (src/core/)

```ts
// git.ts – the ~50-line wrapper (ARCHITECTURE §3)
git(repoRoot: string, args: string[]): Promise<string>
// execFile("git", args, { cwd: repoRoot }); resolves stdout, rejects with
// a typed GitError carrying exitCode + stderr. No shell:true, ever.

// identity.ts
localUser(repoRoot: string): Promise<{ name: string; email: string }>
// git config user.name / user.email; missing → typed error the server
// maps to 409 { error: "git identity not configured" } – never invent an author.

// commit.ts – THE mutation seam (ARCHITECTURE §5). All future writes flow here.
commitAs(
  user: { name: string; email: string },
  change: { files: string[]; message: string },
  repoRoot: string,
): Promise<string>  // resolves new commit sha
// = git add -- <files>  then  git commit --author="name <email>" -m message -- <files>
// If the commit produces no change (identical content): return current HEAD sha, not an error.

// docs.ts additions
writeDoc(repoRoot: string, docsRoot: string, docPath: string, body: string, baseHash: string): Promise<{ sha: string }>
// 1. Same traversal guard as readDoc (shared function, not copied).
// 2. Load current file; if sha256(current body after frontmatter split) !== baseHash → typed
//    StaleDocError (server: 409). Prevents blind overwrite of concurrent/external edits.
// 3. Reattach the CURRENT file's rawFrontmatter (gray-matter .matter) byte-for-byte:
//    delimiters + raw YAML text + body. NEVER re-serialize YAML – the diff must not touch
//    frontmatter the user didn't edit. File without frontmatter stays without.
// 4. Write with LF line endings, exactly one trailing newline.
// 5. commitAs(localUser(), { files: [docPath], message: `Update ${docPath}` }).

docHash(markdown: string): string   // sha256 hex of the body; shared by readDoc response and writeDoc check
```

## Server additions

- `GET /api/docs/*` response gains `"hash"` (the `docHash` of `markdown`).
- `PUT /api/docs/*` – body `{ "markdown": string, "baseHash": string }` → `writeDoc` → `200 { "sha": string, "hash": string }` (new hash, so the UI can keep editing without reloading).
  - Stale `baseHash` → `409 { "error": "doc changed since load – reload" }`.
  - Missing git identity → `409`. Guard violation → `400`. Not found → `404`.

## UI additions

- Doc view gains an **Edit** button → swaps react-markdown for the Tiptap editor loaded with the doc's `markdown` (tiptap-markdown parse via `setContent`); **Save** and **Cancel** buttons in edit mode.
- Save: serialize via tiptap-markdown → `PUT` with the stored `baseHash` → on 200, swap back to view mode with fresh content + hash; on 409, non-destructive error banner ("changed on disk – copy your changes, then reload"); do not silently drop the user's buffer.
- Existing `<span data-c>` marks in a doc must load into the editor, survive unrelated edits, and appear intact in the saved markdown. No comment UI yet (M4) – the mark is invisible plumbing here.
- Frontmatter is invisible in the editor (M1 already splits it; the editor only ever sees the body).

## Corpus test – the permanent regression gate (tests/roundtrip.test.ts)

1. Copy `spikes/roundtrip/corpus.md` → `tests/fixtures/corpus.md` (copy, don't move – the spike stays runnable).
2. Vitest with `// @vitest-environment happy-dom`. Build a headless Editor from `ui/src/editor/extensions.ts` (the app's array – not a re-declared one), parse the corpus body, serialize back.
3. Assert per feature like the spike did: headings, marks, links, nested/task lists, code fences, table structure, blockquotes, hr, images, and **every `data-c` span with attributes intact**.
4. Known accepted losses (assert the *documented* behavior, don't fail on it): table column alignment markers. Whitespace/list-marker normalization is acceptable; content loss is not.
5. Frontmatter round-trip: separate test at the `readDoc`/`writeDoc` level – a fixture with frontmatter saved with an unchanged body must produce **zero diff** (byte-identical file).
6. `writeDoc` tests: stale-hash 409 path, traversal rejection, no-frontmatter file stays clean, commit created with correct author (init a throwaway repo in tmp via `git init` in the test).

CI already runs `npm test` (M0), so this gate is automatic from the first M2 commit.

## Acceptance

1. In this repo (dogfood): open `docs/PLAN.md`, tick one task-list checkbox, save. `git log -1` shows `Update docs/PLAN.md` authored by the local git identity; `git diff HEAD~1` touches only that line (plus acceptable list-marker normalization on first save of a doc).
2. A doc with frontmatter: edit one body word, save → diff shows zero frontmatter changes.
3. A doc containing `<span data-c="test1">text</span>`: edit a different paragraph, save → span present and byte-identical in the saved file.
4. Concurrent-edit check: load doc in browser, edit the file on disk manually, save in browser → 409 banner, file not overwritten.
5. `npm test` green including the corpus round-trip; CI green.

## Guardrails for implementers

- Dependency list is closed. No isomorphic-git, no simple-git, no yaml lib (gray-matter is already there and its raw `.matter` is reattached verbatim – never re-serialized).
- Do not modify `spikes/roundtrip/` (reference material) except copying corpus.md out of it.
- Do not build: comment UI/sidecar (M4), branch/sync operations (M3), create/rename/delete (M3), conflict UI (v1.x).
- Every write goes through `commitAs`. No `fs.writeFile` outside `writeDoc`, no direct `git commit` outside `commitAs`.
- If the corpus test surfaces a fidelity failure the spike didn't (real-browser divergence), STOP and report – do not paper over it with a corpus edit. That result changes the plan.
