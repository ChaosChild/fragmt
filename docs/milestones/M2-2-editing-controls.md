# M2-2 — Editing controls

**Goal:** every basic formatting action is reachable by mouse — block types, table structure, images — through two contextual surfaces with zero persistent chrome.
**Proves:** the README's "Notion-style WYSIWYG" is true for users who don't know markdown.
**Origin:** M2 dogfooding found only Ctrl+B/I and markdown input rules reachable; direction, scope, and UX reviewed and locked in a Lavish annotation round (2026-08-14, `.lavish/m2-2-editing-controls.html` — local only, gitignored). This milestone **amends** the DESIGN "Editor (M2)" clause that banned floating toolbars; the design doc is updated in the same PR, not contradicted silently.

Prerequisites: M2 complete. Read `docs/milestones/M2-round-trip-editing.md` first — the corpus gate and the single `editorExtensions` array are the ground this stands on.

## New dependencies (only these)

- `@tiptap/suggestion@^3.30.0` — slash menu engine (official, same release train).
- `@tiptap/extension-bubble-menu@^3.30.0` — imported by `@tiptap/react`'s `./menus` export but undeclared there; we declare it so installs don't depend on hoisting luck.
- `@tiptap/extensions@^3.30.0` — Placeholder for the empty-doc hint (already a real dependency of StarterKit; declared because we import `@tiptap/extensions/placeholder` directly).

## The two surfaces, three triggers

Nothing persistent is added to the page. Both surfaces render only inside edit mode, styled with the existing design tokens.

### 1. Bubble — act on existing content (`ui/src/editor/BubbleToolbar.tsx`)

Uses `BubbleMenu` from `@tiptap/react/menus` with a custom `shouldShow`. It appears on exactly three triggers:

1. **Non-empty text selection** (the normal case).
2. **Image node selection** (clicking an image).
3. **Right-click anywhere in the edit area** — `contextmenu` is prevented and the bubble opens at the pointer with **no selection required**. This is the discoverability path: turn-into applies to the textblock under the cursor (`setHeading`/`toggleBlockquote`/etc. operate on the cursor's block), and inside a table it carries the table section. Trade-off accepted in review: the browser's native context menu (paste/spellcheck entries) is replaced inside the edit area only — Ctrl+V / Ctrl+Shift+V unaffected, read mode and all other chrome untouched.

The bubble must **never** auto-show on a bare cursor (no selection, no right-click) — it cannot sit over text while the user types.

Sections render by context:

- **Marks row** (always): Bold, Italic, Strike, Code, Link. Link opens an inline URL input prefilled from the selection's href; Enter confirms, Escape cancels. The popover swallows Escape/Enter before the editor sees them.
- **Turn into** (always): Text, Heading 1–3, Quote, Code block. H4–H6 stay markdown-typed on purpose (calm menu; corpus proves they round-trip).
- **Table section** (cursor or selection inside a table): add row above/below, add column left/right, toggle header row, delete row, delete column, delete table.
- **Image section** (image node selected): edit URL/alt in the image popover, delete image.

### 2. Slash menu — insert new blocks (`ui/src/editor/slash.ts` + `SlashMenu.tsx`)

Suggestion-based (`char: "/"`), items filtered by label as the user types:

Text · Heading 1–3 · Quote · Code block · Bullet list · Numbered list · Task list · Divider · **Table** (`insertTable` 3×3 with header row) · **Image** (opens the image popover: URL + alt → `setImage`).

- Keyboard: ↑/↓ move (intercepted by the suggestion's editorProps — the caret must not move), Enter executes, Escape closes. Mouse click also executes.
- Anchored at the caret via `editor.view.coordsAtPos` + absolute positioning — no positioning library.
- The extension lives in the shared `editorExtensions` array; React wiring happens through a render callback in `EditorPane`, so the extension stays headless-testable. Serialization is untouched — the corpus gate judges that.

### 3. Hint — empty-doc discoverability

`Placeholder` from `@tiptap/extensions/placeholder`, text like `Type / to insert blocks · right-click to format`, shown on the current empty node (`showOnlyCurrent`). It disappears as soon as the user types.

## Keyboard contract update (DESIGN §8 interaction)

Escape now has an order: **open popover → open slash menu → visible bubble → selection → cancel**. The first Escape closes whatever surface is open (the bubble runs a capture-phase listener whenever it is visible, so it can never cancel edit mode underneath itself); a bare selection collapses first. Canceling with unsaved changes asks first — the calm-banner pattern ("Discard unsaved changes?" / Keep editing / Discard); a second Escape confirms the discard. Ctrl/Cmd+S still saves from anywhere. All existing Tiptap keymaps (Ctrl+B/I/E, Ctrl+Shift+S, Ctrl+Alt+1–6) and markdown input rules keep working — the surfaces are additive.

## Post-review fixes (first dogfood round, 2026-08-14)

1. **Right-click bubble position** — the plugin's `show` meta appends the element with its previous coordinates; the context handler now follows with an `updatePosition` dispatch, so the bubble lands at the current click.
2. **Escape under an open bubble** — never cancels edit mode (see the order above); previously a forced bubble could let the pane's Escape-cancel through.
3. **Cancel confirmation** — any cancel path (Escape, Cancel button) with a dirty buffer (any doc-changing transaction since load) raises the discard banner instead of silently dropping work.
4. **Slash menu viewport fit** — placement clamps against the menu's measured height (flips above the caret when there is no room below) and follows scroll/resize; previously the bottom items could sit off-screen with no way to reach them.

## Accessibility floor (from DESIGN — never loses a trade-off)

Every bubble/slash control: ≥ 32px hit target, visible `:focus-visible` ring, `aria-label`, full keyboard reach. Menus are real focusable lists (roving `aria-activedescendant` or focus management) with `role="menu"`/`role="menuitem"` semantics.

## Tests (tests/editing-controls.test.ts, happy-dom)

1. **Slash items execute**: headless editor built from the app's `editorExtensions`; run each item's command; assert resulting doc structure (table node with header row, heading level, blockquote, taskList, horizontalRule).
2. **Turn-into on a bare cursor**: place cursor mid-paragraph, `setHeading(2)`/`toggleBlockquote()` → block converts (validates the right-click promise).
3. **Comment-mark preservation**: parse a doc containing `<span data-c="t1">text</span>`, select across it, `toggleBold` → the comment mark survives; serialize → span byte-intact.
4. **Bubble visibility predicate**: pure `shouldShowBubble` — false for empty selection, true for text selection and image NodeSelection (right-click force-show is component state, judged by the same predicate's `force` flag).
5. **Corpus round-trip stays green** — the extension array changed; the gate is the judge.

## Acceptance

1. Select a paragraph, bubble → Heading 2, save → file contains `## …` and the diff touches only that line.
2. Bare cursor in a paragraph, right-click → bubble → Quote → block converts without a selection ever existing.
3. Inside a table: right-click → add row below / delete column / toggle header row all work; save round-trips (documented alignment-marker loss only).
4. Type `/`, `tab`, Enter → 3×3 table with header row inserted at the caret.
5. Slash → Image → URL + alt → image renders in read mode after save.
6. A new empty doc shows the hint; typing dismisses it.
7. `npm test`, `npm run typecheck`, `npm run lint` green; CI green.
8. No persistent UI added — read mode and edit-mode typography unchanged (M2's pixel-parity holds).

## Guardrails for implementers

- Dependency list is closed: the three packages above, nothing else. No floating-ui, no tippy, no command-palette lib.
- UI-only: no `src/core` or `src/server` changes; the write path stays `PUT` markdown. Binary image upload belongs to M3's file lifecycle — M2-2 inserts by URL only.
- No comment UI (M4), no branch/sync UI (M3), no drag handles, no H4–H6 menu entries.
- Escape order (popover → slash → edit-cancel) is part of the contract; test it by hand before the PR.
- If the corpus test fails after adding the slash extension to `editorExtensions`, STOP and report — same rule as M2.
