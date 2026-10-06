# UI source-splice save (#56 tier 2)

**Goal:** a UI save rewrites only the blocks the author touched – untouched paragraphs keep their original bytes, so the editor's round-trip can never reflow or reshape content it did not edit. This closes the residual #56 gaps that the tier-1 round (v0.11.0) deliberately left: hard-wrapped paragraphs still reflow on save, and pipes inside inline code spans in table cells still serialize raw. Both are flagged by the load-time fidelity check and gated behind the save confirm today; this milestone makes them non-events.

## Current state (after tier 1)

- The editor round-trips the whole body through markdown-it → ProseMirror → tiptap-markdown on every load (`EditorPane.tsx` `setContent`) and every save (`getMarkdown()`), because the ProseMirror doc is the only edit surface.
- Tier 1 (PR #62) added: `\|` escaping for table text, a load-time round-trip fidelity check (`ui/src/roundtrip.ts`) that flags lossy docs, and a confirm gate on every save path. Nothing is silently lost anymore, but a lossy doc still *is* reshaped when the author saves.
- Known serializer ceilings: the code mark bypasses the text-node serializer (pipes inside inline code spans in cells go out raw), and soft-break collapse joins hard-wrapped paragraphs at parse time.

## Proposed design

1. **The loaded body is the source of truth.** Keep the exact markdown string the doc was opened with through the edit session (it already exists today for the fidelity check).
2. **Block mapping.** `ui/src/draft-gutter.ts` (`sourceBlockSpans`) already maps top-level markdown blocks to source line spans and back – the natural seam. Extend it to map each top-level ProseMirror doc child to its source span at load time.
3. **Edited vs untouched.** On save, classify each top-level node: untouched nodes are those whose current serialized form is byte-equal to the serialization of the span as originally parsed (cheap string compare per block; position-mapping through PM steps is the fallback if hashing proves insufficient). Edited, inserted, or type-changed nodes serialize normally.
4. **Splice.** Emit the original source bytes for untouched spans, the fresh serialization for edited spans, and the original inter-block whitespace – so a save that touches one paragraph produces a one-line diff by construction.
5. **Ride the same path everywhere.** The comment flow's `docBody` and Save-as-Verified go through the same assembled output; the metadata meta-edit splice keeps its byte-for-byte frontmatter guarantee.

## Edge cases

- Edits spanning several blocks (delete across paragraphs, paste over a range): the union of touched spans serializes; everything outside stays original.
- Undo back to the original content: the node compares equal to the original parse again and returns to original bytes.
- An edited table serializes as a whole (the cell-level ceiling moves out of scope with the block boundary).
- Docs whose round trip is lossy for reasons outside blocks (none known) keep the fidelity warning as the backstop.

## Acceptance

- Corpus gate goes byte-level: a fixture with one edited paragraph must differ from the source only inside that paragraph's span; the hard-wrapped-paragraph fixture saves byte-identical when untouched; the code-span-pipe table saves byte-identical when untouched.
- The load-time fidelity warning disappears for docs that are stable under splice-save; it remains only for content the editor genuinely cannot represent.

## Out of scope

- Making *edited* code spans inside table cells round-trip (needs a full table serializer override with per-cell `renderInline` control).
- Server-side normalization changes – the server is already verbatim.
