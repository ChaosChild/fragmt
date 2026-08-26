# Search & link slideout

**Goal:** find any doc fast — Ctrl/Cmd+K search over titles and bodies with snippets — and read two docs at once: the permanent comment rail generalized into a slideout with a read-only preview mode.
**Proves:** the roadmap's first two backlog items (#14, #15) ship without disturbing the reading room — and the round that retired milestones: the first backlog-driven PR (`feat/search-slideout`, no milestone number).

Specced in three Lavish rounds, 2026-08-25/26 (artifact: `.lavish/m7-search-link-slideout-2.html` — the file keeps the m7 working name from before the retirement decision). Round one specced search as a sidebar box plus the slideout; round two moved search to the Ctrl/Cmd+K modal and reworked the collapse chrome (variant A, revised); round three pulled promote-to-editor into the build and locked the workflow and version decisions.

## Decisions (locked, 2026-08-26)

- **B1 — split geometry:** the slideout opens at a 55/45 main/slideout split; a 7px drag divider clamps it to 40–60% and persists via localStorage (`fragmt.slideoutShare` — the sidebar-geometry pattern, in %). Either side can win the majority; both stay usable. Rounded to 4 decimals so pointer math never grows a float tail in storage; one write per drag (pointerup), not per move.
- **B2 — collapse chrome (A, revised):** no hamburger. Opening the slideout auto-collapses the sidebar once — «/» chevrons in the tree header restore it; a manual re-expand sticks (the slideout never re-collapses, no fighting); closing restores only the automatic collapse. While collapsed, a desktop topbar appears: » brand · BranchMenu · Merge · spacer · ＋ · ⌕ · LED — the same components in a second location, so the fixed actions never disappear.
- **Search is the Ctrl/Cmd+K modal**, not round one's sidebar box — DESIGN.md's roadmap bullet had it right all along: a centered overlay palette, no persistent search pane. The mouse-obvious trigger is a ⌕ button in the sidebar brand row, left of ＋ (owner order).
- **Promote-to-editor pulled into the build** (round three): a button in the slideout head navigates the main doc to the previewed one — through the navigation queue, like every open.
- **Workflow — milestones retired (2026-08-26):** this is the first backlog-driven round; PLAN.md's milestone table becomes the fixed M1–M5 record, M6 re-framed as the long-running dogfooding milestone, and the backlog/issues are the engine now. Releases continue on the existing tag-push pipeline (`release.yml`); branch names follow the feature, not a milestone number.
- **Version: 0.6.0** — a minor, not 0.5.1: two features, and a patch number would mislabel them. The bump stays the owner's post-merge ritual on main, exactly like 0.5.0 (see M5's release ritual).

## Batch 1 — Search core + route (#14)

- **`searchDocs` in `src/core/search.ts`:** a flat substring scan over the current worktree's allow-listed docs — case-insensitive query against frontmatter title + body. No history walk, no index (ponytail: add an index when a real repo measurably hurts — measure first, same discipline as `/api/meta`'s walks). Title hits first, then body-only hits, tree order (the sidebar's own order) within each group. Snippets: a ~110-char window around the first body match on the whitespace-flattened body — the match and the window live on the same flattened line, so they always agree — with "…" marking each clamp and the opening clamp standing in when only the title matched. Cap 50. A trimmed query under 2 chars is a non-error empty result.
- **`GET /api/search?q=`** (`src/server/index.ts`): a thin GET over the core scan — `q` missing is a 400; present-but-short is `searchDocs`' own empty array, not an error.
- Tests: `tests/search.test.ts` + `tests/server-search.test.ts` (ordering, snippet window, cap, short query, the 400).

## Batch 2 — Ctrl/Cmd+K search modal (#14)

- **`ui/src/SearchModal.tsx`:** the centered palette. The global Ctrl/Cmd+K shortcut works mid-edit (the editor never swallows it); Esc closes. Focus trap inside the modal, focus restored to the invoker on close.
- Debounced as-you-type: 250ms after the last keystroke, ≥2 trimmed chars — the server's own rule, mirrored client-side so a 1-char query never fires a request.
- Results: title + path + snippet. ↑/↓ wrap, and hovering a row syncs with the keyboard cursor (both directions). Enter/click opens the doc through the navigation queue — a dirty buffer gets the save/discard/cancel banner, never a silent drop. Shift+Enter / Shift+click opens the result in the slideout preview instead.

## Batch 3 — Slideout shell + collapse chrome (#15)

- The permanent comment rail became **`ui/src/Slideout.tsx`**: two modes. **Comments** = the refactored rail (`CommentsRail.tsx` — thread list, reply, resolve, delete, jump, all preserved). **Preview** = the read-only second pane (batch 4). Geometry per B1 in **`ui/src/slideout-geometry.ts`**: clamp + persist + the 0.55 default for absent/empty/invalid storage (App always needs a number).
- Collapse chrome per B2: App tracks an `autoCollapsed` ref — opening the slideout collapses only an expanded sidebar and flags it automatic; a manual «/» expand clears the flag (the slideout never re-collapses); closing restores only the flag's collapse. The collapsed topbar mounts the same BranchMenu/Merge/＋/⌕/LED components against the same handlers — a second location, not a second implementation.

## Batch 4 — Preview, link interception, promote (#15)

- **Preview mode = `ui/src/DocPreview.tsx`:** the linked doc as a second, read-only EditorPane — every edit surface inert by wiring (`commenting: false`, save/cancel keys editable-gated); one rendering path, no drift. Doc links inside the preview re-target the preview itself, so following a trail never touches the editor's doc or buffer; `#anchors` scroll; non-doc links keep the main pane's dispatch; a dead link gets the pane's quiet note.
- **Interception in the main doc:** edit-mode link clicks ALWAYS open the preview — the dirty buffer is never navigated away. Read-mode plain clicks navigate through the guard. Shift+click and the hover-↗ zone (the last 18px of a doc link, geometric hit test in `ui/src/link-hit.ts`) open the preview from either mode.
- **Promote-to-editor:** the slideout-head button navigates the main doc to the previewed one through the navigation queue.

## Batch 5 — The Escape chain (#15)

- The fixed order, end to end: **search modal → popover → slash/@ menus → bubble → selection → slideout → edit-cancel** — the M2-2 contract extended in two places: the modal leads, the slideout slots in before edit-cancel. EditorPane treats a chain-consumed Escape as spent.
- A window-level fallback (App) catches the Escape that reaches it in read mode — the editor preventDefaults every Escape it sees, so read mode's arrive at the window unclaimed.

## Acceptance

- Gates green: `npx biome ci .` · `npm run typecheck` · `npm test` — **322 tests (294 → 322)**.
- Manual: Ctrl+K mid-edit opens search; opening a result over a dirty buffer shows the banner (no silent drop); the slideout opens at 55/45, the divider drags and clamps, the split survives reload; opening collapses the sidebar once, a manual re-expand sticks, close restores only the automatic one; the collapsed topbar's branch/merge/new-doc/search all work; an edit-mode link click previews; Shift+click and the hover ↗ preview; promote routes through the queue; Esc walks the whole chain in order from any state.

## Risks

- **Flat scan, no index** — the deliberate ponytail ceiling: cap 50 + measure-first before any index (the same gutter as #17's `/api/meta` walks).
- **Two live Tiptap instances** (editor + preview) — the preview rides the app's own extension array read-only, so there is no second rendering path to drift; still the heaviest thing in the round.
