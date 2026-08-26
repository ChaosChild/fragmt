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

## Testing round (2026-08-26)

The owner tested the build against the locked design and filed seven corrections; all landed the same day, plus an eighth the follow-up inspection caught.

1. **The default view regressed** — docs opened into a 55/45 split with an empty side pane (the tabs let the pane sit in Preview mode with nothing previewed, and the mode/open state stuck across doc switches). Rewritten: the v0.5.0 comments rail is the default and always-present pane again — fixed 316px (`--rail-w` restored), the open doc's threads, no mode tabs, no Comments button in the doc header. The pane widens to the draggable split **only while a preview is open**; closing the preview returns the 316px rail.
2. **The Comments button collapsed the sidebar** — moot with the button gone, and the rule tightened with it: only a preview open auto-collapses (restore on close, manual « still wins); a span click touches nothing but the ≤1180px sheet. The empty-pane class died with the rewrite — the pane is always mounted with the thread list, and the split only exists with a live previewPath.
3. **The hover ↗ glyph and the 18px right-edge hit zone were unusable** — both deleted (the CSS pseudo-element, the `isIconHit` dispatch, `ui/src/link-hit.ts` + its tests). Read-mode preview gestures reduce to **Shift+click**.
4. **Edit-mode link clicks opened the preview on cursor placement** — reversed: a plain click in edit mode is normal editing (PM default, nothing opens); **Ctrl/Cmd+click opens the preview** (v0.5.0's ctrl-to-follow, retargeted).
5. **The promote button misled** (a pencil titled "Open in editor", navigating the main pane in read mode) — now `SquareArrowOutUpRight` with "Open in main pane" title/aria; same guarded navigation + close.
6. **Preview span tooltips promised a dead click** — in the preview only, span titles now summarize the thread's first comment (`andrei · open — "Pin this wording?"` — the sidecar carries no per-thread version, so the formatter drops absent pieces; `ui/src/comment-summary.ts` + tests). A second sidecar fetch feeds them; main-doc spans keep "View comment" + jump, preview span clicks stay inert.
7. **Topbar gaps** — ThemeToggle renders in the topbar now (it was unreachable while collapsed); ＋ and ⌕ sit immediately right of Merge, LED alone at the far end: `» brand BranchMenu Merge ＋ ⌕ ThemeToggle [spacer] LED`.
8. **Dead space right of the rail** (owner's annotated screenshot, second testing pass) — the rail itself was the right 316px but the content pane stopped at 55% of the free space, leaving an unclaimed gap wider than the pane. Root cause, per CSS flexbox spec §9.7.1: **a flex-grow factor under 1 earns only `grow × free-space`, never the whole remainder** — the "lone grower takes everything" assumption in the `.main` comment was wrong, and only held earlier because the preview pane's 0.45 completed the sum to 1.0. Fix: App feeds the layout variable `1` when no preview is open (one line; the 0.55 share only matters while the pane is flexed). Verified in-browser with measured geometry: rail state — main 584px filling all free space, pane flush at the layout's right edge; preview state — 674/551 = the exact 55/45 with the divider; Esc — both restored. Lesson recorded: UI-changing rounds get measured browser verification, not just gates.
9. **The comments header never came back** (owner, same pass) — the rewrite had stripped the rail head entirely, and the sync LED had landed only in the collapse topbar (so expanded desktop showed no sync cue at all). Restored the v0.5.0 head in the comments state: `Comments · N` (11px mono uppercase), the sync LED + one-word label; the close stays preview-only on desktop (v0.5.0's `display:none` rule, re-shown ≤1180px as the sheet fold). ThemeToggle deliberately NOT returned to the head — it lives in the sidebar head per the locked design (restoring it would show two toggles). The LED now renders in the preview head too — the split hides the sidebar, so it stays the one always-visible sync cue.
10. **Chrome polish** (owner, next pass) — (a) the topbar LED removed: with the rail head showing sync status permanently, the collapsed topbar repeating it is noise; (b) ThemeToggle restyled `theme-toggle` → `tool-btn` (it was the only bordered icon — the border and its whole CSS block went); (c) one order everywhere: **search, add, theme** (+ collapse pairs with it in the sidebar head, expand leads the topbar); (d) the save/discard guard banner's button bar pins right — `.conflict-banner .doc-actions { margin-left: auto }` (it sat flush after the headline before). The dirty-guard wiring itself was re-verified intact end to end during (d) (Sidebar → onDocLink → guardAction → pendingAction → DocView banner) — an automation scare that looked like silent loss turned out to be test keystrokes never landing, not the guard.

## Acceptance

- Gates green: `npx biome ci .` · `npm run typecheck` · `npm test` — **322 tests (294 → 322)**; the dogfood round kept the count (link-hit's 5 out, comment-summary's 5 in).
- Manual: Ctrl+K mid-edit opens search; opening a result over a dirty buffer shows the banner (no silent drop); the slideout opens at 55/45, the divider drags and clamps, the split survives reload; opening collapses the sidebar once, a manual re-expand sticks, close restores only the automatic one; the collapsed topbar's branch/merge/new-doc/search all work; an edit-mode link click previews; Shift+click and the hover ↗ preview; promote routes through the queue; Esc walks the whole chain in order from any state.
- Testing round: every doc opens with the 316px comments rail showing its threads and main filling ALL the remaining width (measured, not assumed); a preview (edit Ctrl/Cmd+click, read Shift+click, search ⇧↵) widens the pane and collapses the sidebar once; ✕/Esc/promote return the rail and restore the sidebar; edit-mode plain clicks place the cursor; preview spans summarize their threads; the topbar shows theme + ＋ ⌕ by Merge with the LED at the far end.

## Risks

- **Flat scan, no index** — the deliberate ponytail ceiling: cap 50 + measure-first before any index (the same gutter as #17's `/api/meta` walks).
- **Two live Tiptap instances** (editor + preview) — the preview rides the app's own extension array read-only, so there is no second rendering path to drift; still the heaviest thing in the round.
