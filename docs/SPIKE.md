# Spike: editor choice – markdown round-trip fidelity

## Why this is first
The riskiest assumption in the whole product: **a Notion-style ProseMirror editor can round-trip markdown without mangling it.** If false, the "GitHub-readable markdown as canonical storage" premise needs rethinking. Test on day one, not month three.

## Questions to answer
1. **BlockNote round-trip**: markdown → `tryParseMarkdownToBlocks` → `blocksToMarkdownLossy` – what survives, what's mangled? BlockNote's md export is documented as lossy; find out if the loss is acceptable.
2. **Comment-mark survival**: does an inline HTML span (`<span data-c="id">text</span>`) survive BlockNote's parse → export cycle? Do BlockNote's native comment marks export to markdown at all?
3. **Fallback – Tiptap**: headless Tiptap + StarterKit + a custom ~50-line comment mark + `tiptap-markdown` (with `html: true`). Same round-trip tests.

## Test corpus (must include)
- Headings h1–h3, bold/italic/strike/inline code, links
- Nested bullet + numbered lists (3 levels), task lists
- Fenced code blocks with language tags
- Tables (with alignment)
- Blockquotes, horizontal rules, images
- YAML frontmatter (should pass through untouched – likely needs stripping before parse and re-attaching after)
- Inline `<span data-c="x">…</span>` wrappers in various positions (mid-paragraph, inside bold, across list items)

## Pass/fail
- **Pass**: semantically identical markdown out (whitespace/list-marker normalization acceptable); spans preserved with attributes intact.
- Fail on content loss, structure corruption (tables/nesting), or stripped spans.

## Decision rule
- BlockNote passes both → BlockNote (Notion UX + built-in comments UI with pluggable `ThreadStore` = least code).
- BlockNote fails marks but Tiptap passes → Tiptap + custom mark; we own the comments sidebar UI (~200 extra lines).
- Both fail → escalate: consider storing marks out-of-band (offset-based, re-anchored via editor) before abandoning markdown storage.

## How to run headless (no browser)
- BlockNote: `@blocknote/server-util` → `ServerBlockNoteEditor.create()` – needs `react` + `react-dom` installed.
- Tiptap: `@tiptap/core` + `@tiptap/starter-kit` + `tiptap-markdown` run fine in Node.
- Verified: `npm install @blocknote/server-util react react-dom` works (Node 22, npm 10; installed clean in ~6s).

## Status
- [x] Spike scoped, environment approach verified
- [x] BlockNote round-trip corpus test
- [x] BlockNote span/mark survival test
- [x] Tiptap fallback test
- [x] Findings + editor decision recorded here

## Findings

Run from `spikes/roundtrip/`: `node blocknote-test.mjs` and `node tiptap-test.mjs`
(both scored against `corpus.md`). Versions: `@blocknote/server-util` 0.51.4,
`@tiptap/*` 3.27.1, `tiptap-markdown` 0.9.0, Node 22.

BlockNote runs headless via `@blocknote/server-util`. Tiptap needs a DOM shim
(`happy-dom`) because `tiptap-markdown` and ProseMirror reach for `window`/`Node`.
Tiptap results below use StarterKit + custom comment mark **plus** the extra
extensions StarterKit omits: `@tiptap/extension-list` (TaskList/TaskItem),
`@tiptap/extension-table` (+row/cell/header), `@tiptap/extension-image`.

| Feature | BlockNote | Tiptap |
| --- | --- | --- |
| h1–h3 headings | PASS | PASS |
| bold / italic / strike / inline code | PASS | PASS |
| link | PASS | PASS |
| nested bullet list (3 lvl) | NORMALIZED (`-`→`*`) | PASS |
| nested numbered list (3 lvl) | PASS | PASS |
| task list | NORMALIZED (`-`→`*`, state kept) | PASS (needs extension-list) |
| fenced code + lang | PASS | PASS |
| table content/structure | PASS | PASS (needs extension-table) |
| **table alignment** | **FAIL** (markers dropped) | **FAIL** (markers dropped) |
| blockquote | PASS | PASS (lines merged) |
| horizontal rule | NORMALIZED (`---`→`***`) | PASS |
| image | PASS | PASS (needs extension-image) |
| YAML frontmatter, stripped + reattached | PASS | PASS |
| YAML frontmatter, NOT stripped | FAIL (fence → `***`, `author:` → `## author`) | n/a (strip anyway) |
| **`<span data-c>` mid-paragraph** | **FAIL – tag stripped, text kept** | **PASS – attrs intact** |
| **`<span data-c>` inside bold** | **FAIL – tag stripped** | **PASS – attrs intact** |
| **`<span data-c>` in list item** | **FAIL – tag stripped** | **PASS – attrs intact** |
| `<span data-c>` in task item | n/a (no task ext test) | PASS – attrs intact |

Fate of the comment spans:
- **BlockNote strips them entirely.** `<span data-c="abc123">flagged phrase</span>`
  comes back as `flagged phrase` – the text survives, the tag and `data-c`
  attribute are gone. Same in bold and in list items. No native BlockNote comment
  mark exports to markdown either. **Span survival: NO.**
- **Tiptap preserves them verbatim** with a ~35-line custom `Mark` (parseHTML
  `span[data-c]`, renderHTML keeps `data-c`) + `tiptap-markdown` `html: true`.
  All positions round-trip with `data-c` intact. **Span survival: YES.**

Shared limitation: GFM **table column alignment** is lost in *both* editors
(`:---:`/`---:` collapse to `---`); cell content and structure survive. This is
the only failing content check for Tiptap and is not an editor differentiator.
Both test scripts therefore exit non-zero (1) on this shared alignment loss;
strip that one check and Tiptap is clean, BlockNote still fails on spans.

## Decision

**Chosen editor: Tiptap + custom comment mark.**

Per the decision rule: BlockNote passes general content fidelity but **fails the
comment-mark (`data-c` span) survival test** – the spans are stripped on export,
which is disqualifying for a git-native docs tool whose comments must live inline
in canonical markdown. Tiptap round-trips the full corpus and, with a ~35-line
custom mark, **preserves the `data-c` spans with attributes intact** in every
position tested (paragraph, bold, list item, task item). So we own the comments
sidebar UI (~200 extra lines) rather than getting BlockNote's built-in comments –
an acceptable cost given spans are the gating requirement.

Caveats to carry forward: (1) strip YAML frontmatter before parse and reattach
after – neither editor round-trips a frontmatter fence, BlockNote actively
mangles it. (2) Table column **alignment** is not preserved by either editor; if
alignment matters, it needs a custom table-markdown serializer or is accepted as
lost. (3) Tiptap headless needs a DOM shim (`happy-dom`) in Node.

`spikes/roundtrip/` holds the runnable spike: `corpus.md` (test corpus), `blocknote-test.mjs`, `tiptap-test.mjs` – run either with `node <script>`.
