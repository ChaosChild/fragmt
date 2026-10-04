# UI upgrade – v1 visual pass

**Status: shipped 2026-10-03** on `feat/ui-v1` → PR #51 – all 14 phases, plus the owner-review fixes and `fix(sync): pull --rebase=merges` found in the final retest. `docs/app.v1.html` stays in the repo as the visual contract.

Implementation plan for the desktop visual redesign approved in the `docs/app.v1.html` mock (owner review round, 2026-10-03). Written for an implementing agent: follow the phases in order, one phase per commit, and do not start a phase until the previous one is green on all three gates (tests, typecheck/lint, visual check).

## 0. What this is, and what it is not

**The vision in one line:** the doc is a sheet of paper lying on a machined desk. Everything that is not the doc is the desk – a slim instrument rail, a title-only navigator, marginalia beside the sheet, a second sheet beside the first for previews, a full stage for PR review, the graph and merge resolution.

**Source of truth.** `docs/app.v1.html` is the visual contract. Open it in a browser while you work. Every screen is addressable by hash – `#read`, `#edit`, `#preview`, `#branch`, `#search`, `#prs`, `#review`, `#graph`, `#conflict`, `#focus`, `#signin` – and the review bar at the bottom toggles the theme. Copy values (tokens, sizes, spacing, radii, shadows) from its `<style>` block; do not eyeball them. Where this document and the mock disagree, this document wins (it records decisions made after the mock).

**Scope.** Desktop only: viewports ≥ 1280px wide, verified at 1920×1080 and 1440×900. The existing ≤ 1180px behaviour (bottom sheet rail, drawer sidebar) must keep working – do not redesign it, do not delete its media queries, and re-check it once per phase at 1024×768 (it may look plain; it must not be broken).

**Non-goals.** No new dependencies unless a phase explicitly allows one. No behaviour change to saving, drafting, syncing, merging, comments storage, OKF stamping or auth. No server route changes except the ones listed in phases 7, 8, 9 and 11. No mobile redesign.

## 1. Ground rules for the implementing agent

1. Work on a branch `feat/ui-v1` cut from `main`. Never commit to `main`.
2. Read before you edit: `docs/DESIGN.md` (the principles), `AGENTS.md` (doc-editing rules), `ui/src/App.tsx` render section, `ui/src/styles.css` tokens, and the component you are about to touch. Match the surrounding code: comment style (why, not what), naming, Biome formatting (tabs).
3. Markdown docs in this repo are edited through fragmt, never by hand on main: `fragmt agent save <doc> --file <body> --author "<Your Name> <you@example.invalid>"`. Write paragraph prose unwrapped – one line per paragraph.
4. Gates after every phase, all must pass:
   - `npm run typecheck`
   - `npm run lint` (Biome; run `npm run format` first if needed)
   - `npm test` (Vitest; the whole suite, not just your new tests)
   - `npm run build`
   - the phase's visual check (section 2).
5. Accessibility is the floor (DESIGN.md §9): text contrast ≥ 4.5:1 in both themes, visible focus rings, hit targets ≥ 32px, every icon-only button has an `aria-label` and a `title`. Trust tiers are never colour-only – each has a distinct shape.
6. Pinned selectors. The component harness in `tests/ui-guard.test.ts` (and `editing-controls`, `draft-gutter`, `at-references`) queries these – keep them working, or update the test in the same commit and say why in the commit message:
   - button names: `Edit`, `Merge`, `Open PR`, `Open pull request`, `Push commits`, `Discard`, `Reference graph`, `Close graph`, `Branch: <name>. Switch branch`
   - classes: `.breadcrumb`, `.app-frame` (+ its `data-prview` attribute), `.gv-pane`, `.gv-node`, `.pr-title`, `.pr-file-name`, `.pr-patch-row` (`.add`, `.del`, `.hunk`)
   - texts: `This document has unsaved changes.`, `/hard-wrapped paragraphs/`, the graph count line, `Open on GitHub`, `Resolve on GitHub`
   - the `data-c` comment span attribute (never rename it – it is the on-disk comment anchor format).
7. Security requirements that apply across phases:
   - Never render document or PR content as raw HTML. No `dangerouslySetInnerHTML`, no `rehype-raw`. Doc bodies contain raw `<span data-c>` HTML; strip or ignore it, never inject it.
   - New routes stay behind the existing `/api/*` auth gate (they are, by being under `/api`) and validate every parameter (branch names with the existing `badBranchName`, doc paths with `resolveDocPath`, PR numbers with `prNumber`).
   - Git is always called through `src/core/git.ts` (`execFile`, argument arrays, no shell). Never interpolate user input into a git argument that starts with `-`.
   - GitHub calls go through `src/core/github.ts` with the signed-in user's token, never the machine identity.
8. If something in this plan turns out impossible or wrong once you read the code, stop that phase, write down what you found and why, and ask the owner. Do not improvise around it.

## 2. The verification protocol

### 2.1 Running the app

The app needs a repo to serve. Use the OKF test repo (it exercises trust tiers, references, the graph):

```
git clone https://github.com/ChaosChild/scratch-fragmt-test.git <scratch>/scratch-fragmt-test
```

Local mode (most phases): from the test repo, `node <fragmt>/node_modules/tsx/dist/cli.mjs <fragmt>/src/cli/index.ts serve --port 4400`. For hot reload of the UI, additionally run `npm run dev:ui` in the fragmt repo and open http://localhost:5173 (Vite proxies `/api` to 4400).

Auth mode (phases 7, 9, 12 – PRs and sign-in): the same command with `--auth`, and `GH_CLIENT_ID` / `GH_CLIENT_SECRET` exported from the fragmt repo's `.env` (never print them). The owner signs in through the browser – you never type credentials. Ask the owner to log in and wait for confirmation.

The mock: serve `docs/` statically (`python -m http.server 4500 -d docs`) and open http://localhost:4500/app.v1.html#<screen>.

### 2.2 Visual check (every phase)

1. Set the browser window to 1920×1080.
2. For each screen the phase touches: screenshot the mock (`app.v1.html#<screen>`) and the app in the same state, light theme, then dark theme.
3. Compare side by side and write a short list: what matches, what differs, and whether each difference is (a) intended (this plan says so), (b) a data difference (real repo vs mock copy), or (c) a defect. Fix every (c) before closing the phase.
4. Check specifically: alignment of the sheet and margin, type sizes (title 54px, prose 18px/1.7, UI 13–14px), token colours, focus ring on Tab, hover states, no horizontal scrollbar, no clipped elements (the edit ribbon was clipped once – check tops and edges).
5. Repeat the main screen once at 1440×900 and once at 1024×768 (regression only).
6. Save the screenshots under `<scratch>/ui-v1-shots/phase-<n>/` (not in the repo) and mention the folder in the phase's commit message body.

### 2.3 Baseline (do this before phase 1)

Run the full gate set on untouched `main` and record the test count. Screenshot the current app (read, edit, comments with a thread, preview, PR list and review, graph, search, branch menu, merge resolution, sign-in) in both themes into `ui-v1-shots/phase-0/`. You will diff against these to catch regressions in behaviour, not looks.

## 3. Phases

Each phase lists: goal, files, steps, tests to add, visual check, done-when.

### Phase 1 – Tokens, fonts, surfaces

**Goal:** the new palette, type and surface materials are available everywhere, without moving any layout yet.

**Files:** `ui/index.html`, `ui/src/styles.css`.

**Steps**

1. In `ui/index.html`, replace the font link with the mock's: Newsreader (unchanged axes) + Geist (400/500/600) + Geist Mono (400/500). Keep the theme-before-paint script as is.
2. At the top of `styles.css`, add the mock's tokens under new names on `:root` and `[data-theme="dark"]`: `--desk --desk-2 --sheet --sheet-2 --ink --ink-2 --ink-3 --line --line-soft --accent --accent-hover --accent-on --accent-soft --accent-mid --green --amber --red --amber-soft --green-soft --red-soft --hl --sheet-shadow --float-shadow --grain-opacity --serif --sans --mono --r-sm --r --r-lg --rail --nav --cmd --status --focus --ease`. Copy values exactly from the mock.
3. Alias the old tokens to the new ones so the existing 3,400 lines keep working: `--bg: var(--desk); --pane: var(--desk-2); --surface: var(--sheet); --fg: var(--ink); --muted: var(--ink-2); --border: var(--line); --border-soft: var(--line-soft); --success: var(--green); --warn: var(--amber); --danger: var(--red); --font-serif: var(--serif); --font-body: var(--sans); --font-mono: var(--mono); --focus-ring: var(--focus)`. Leave the glass tokens defined for now; phase 2 removes their users.
4. Remove the `.ambient` element from `App.tsx` and its CSS. Add the grain layer: one `<div className="grain" aria-hidden="true" />` as the first child of the App fragment, CSS copied from the mock (`pointer-events: none`, `opacity: var(--grain-opacity)`).
5. Body font becomes `var(--sans)` at 14px; prose keeps the serif (set on the editor/prose container in phase 4 – for now leave `--text-base` as is so nothing reflows mid-plan).

**Tests:** none new (pure CSS). The full suite must stay green.

**Visual check:** every existing screen still works and reads; colours shift to the new palette; no element lost its contrast. Run a contrast check on `--ink-2` and `--ink-3` against `--sheet` and `--desk` in both themes (write a 10-line throwaway script using the WCAG relative-luminance formula; all text uses must be ≥ 4.5:1 – if `--ink-3` fails on `--desk`, use it only on `--sheet`).

**Done when:** gates green; contrast table pasted into the commit message.

### Phase 2 – The app shell: rail, navigator, stage, status bar

**Goal:** the frame from the mock: `rail (60px) | navigator (272px, collapsible) | stage (command bar 56px / desk / status bar 30px)`.

**Files:** `ui/src/App.tsx`, `ui/src/Menus.tsx` (UserChip), `ui/src/ThemeToggle.tsx`, `ui/src/styles.css`, new `ui/src/Rail.tsx`, new `ui/src/StatusBar.tsx`, new `ui/src/CommandBar.tsx`.

**Steps**

1. `Rail.tsx`: a `<nav aria-label="App">` column. Top: the brand mark (italic serif "f" on an ink square with the accent dot). Then icon buttons, each 40×40 with a tooltip span (copy `.rbtn` / `.tip`): Documents (closes graph/PR review, returns to the doc), Search (opens `SearchModal`), Pull requests (only when `prAvailable`; shows the accent dot when any PR is open – derive from `prByBranch`), Reference graph (only when `okfFindings !== null`, same gate as today's `graphBtn`). Spacer. Bottom: navigator toggle, `ThemeToggle` (restyled as a rail button), and the user avatar which opens the existing `UserChip` menu (move it out of DocView's head; keep its logout behaviour). The active view gets `aria-current="true"` and the accent bar.
2. Keep the existing `aria-label`s on Search, Pull requests and Reference graph (the tests click them by name).
3. Navigator (the existing `<aside className="sidebar">`): remove the brand and the head icon row (they moved to the rail). New head, top to bottom: repo name (serif italic 21px) + one muted line (`<owner> · OKF bundle · N docs`, parts omitted when unknown); the branch button (full-width, mono branch name, sync LED, chevron – it is `BranchMenu`'s trigger, restyled; keep its accessible name `Branch: <name>. Switch branch`); when off main, a row with `Merge` and `Open PR` (the existing `mergeBtn` and `openPrBtn` elements, restyled as `.btn.line`, same gating and titles); then `Find  Ctrl K` (opens search) and the `+` new-doc button.
4. Repo name: add `repo: { name: string; slug: { owner: string; repo: string } | null }` to the `/api/meta` response in `src/server/index.ts` (name = slug.repo when a GitHub slug exists, else the basename of `ctx.repoRoot`). Add the field to `RepoMeta` in `ui/src/api.ts` as optional so older fixtures still type-check.
5. Collapsing: the navigator collapses to width 0 (the rail stays). Reuse the existing `sidebarCollapsed` state, its persistence and the preview auto-collapse rule. Delete the `app-topbar` block – the rail now carries everything it used to. Add `Ctrl/Cmd+\` to toggle the navigator (register next to the existing `Ctrl+K` handler; it must not fire inside the editor's own shortcuts – check `e.target`).
6. `StatusBar.tsx` at the bottom of the stage: left – sync LED + `ledLabel` + "pulled N min ago" (track the last successful sync time in App; render minutes, refresh every 30s); branch icon + mono branch name. Right – word count of the open doc (count from `doc.body`, ignoring frontmatter and code fences); when `okfFindings !== null`, "OKF v0.2 · valid" or "OKF · N findings" (the latter is a button that opens the existing OKF findings banner/panel). Remove the sync LED from DocView's doc head and from the Slideout head – the status bar is its one home (DESIGN.md §7: one small, fixed indicator).
7. `CommandBar.tsx`: a presentational `<header className="cmd">` with `start`, `children` (actions, right-aligned) slots. Each main view renders its own (phase 4 for the doc, 9 for review, 10 for the graph, 11 for resolution).
8. The stage background is `--desk`; remove the glass card styling from the sidebar (no backdrop-filter, no rounded glass card – the navigator is a flat panel tinted between `--desk` and `--desk-2`, hairline right border).

**Tests:** add to `tests/ui-guard.test.ts` (App harness): (a) the rail renders Search / Pull requests / Reference graph with their labels and gates (PR hidden when `prAvailable` is false; graph hidden on non-OKF meta); (b) `Ctrl+\` toggles the navigator's collapsed class and the state persists via the existing storage helper; (c) the status bar shows "OKF · 2 findings" when validate returns two findings. Add a server test in `tests/server.test.ts` for the new `repo` field (slug and non-slug cases).

**Visual check:** `#read` and `#focus` against the app. The doc area will still look old – that is phase 4.

**Done when:** gates green; no element of the old collapsed topbar remains; every action reachable before is reachable now (walk the list from the phase-0 screenshots).

### Phase 3 – Navigator tree: titles only, trust marks, nested folders

**Goal:** the calm list from the mock, with real nesting.

**Files:** `ui/src/Sidebar.tsx`, `ui/src/styles.css`, `tests/sidebar.test.ts`.

**Steps**

1. `DocCard` becomes a single-line row (`.row`): title (`displayTitle`), then right-aligned indicators in this order: the draft mark (6px amber square, when `chipWord(meta, path)` is non-null; `title` = the chip word), the trust mark. Remove the visible author/date/version/snippet/chips. Put them in the row's `title` attribute instead: `"<title>\n<path> · v<version> · <author> · <date>\n<snippet>"` (only the parts that exist).
2. Trust mark (`<span className="tr …">`): `u` unverified = hollow ring; `m` machine-confirmed = half-filled accent; `h` human-reviewed = filled green; `s` stale = dashed amber ring (stale wins over the tier). Each has `title` and an `aria-label` with the tier word. Write a pure `trustClass(okf?: DocMeta["okf"]): "u" | "m" | "h" | "s" | null` in `ui/src/display.ts`.
3. Ghost rows (a doc that exists only on a draft branch) keep their behaviour; style them with the title in `--ink-3` italic and the draft mark.
4. Folders. Level 1 (direct children of the docs root) renders as a serif-italic section heading `.fold-h` with the recursive doc count (`countDocs`). Level ≥ 2 renders as `.frow`: a 20px chevron button (`aria-label` "Fold <name>" / "Unfold <name>", toggles collapse – reuse the existing collapsed set and its persistence) and the folder name. Children sit in `.sub` with a 1px left rule; the `.sub` that contains the current doc gets the accent-tinted rule. Indent is fixed per level (12px), no maximum depth – long names ellipsize, the full path is in `title`.
5. Folder name click: in OKF repos, opens the folder's `index.md` when it exists (look it up in the tree), through the same guarded `onSelect`. Otherwise it toggles like the chevron. Hide `index.md` rows in OKF repos (the folder row is the index). Non-OKF repos keep `index.md` rows as normal docs.
6. Drag and drop: unchanged behaviour. Re-apply the drop-target highlight classes to the new row/folder elements and verify by hand that dragging a doc onto a nested folder, the root, and the bin still works.
7. Recycle bin stays pinned at the bottom (`.nav-foot`), restyled; behaviour unchanged.
8. The OKF findings banner, if it currently renders inside the sidebar, moves out (phase 2's status bar button opens it). Keep its content.

**Tests (sidebar.test.ts, happy-dom):** `trustClass` for all tiers + stale precedence; a 4-level fixture tree renders the right nesting (level-1 heading, `.frow` for deeper, `.sub` containers), counts are recursive, a collapsed folder hides its subtree and survives a re-render; in OKF mode the folder click selects `folder/index.md` and `index.md` rows are hidden; in non-OKF mode they show.

**Visual check:** `#read` navigator. Use the test repo, and additionally create a throwaway nested folder 4 levels deep in your scratch clone (via the app's `+` → folder) to see real nesting.

**Done when:** gates green; DnD verified by hand on nested folders; screenshots saved.

### Phase 4 – The sheet: command bar, masthead, details, prose, connections

**Goal:** the doc page from `#read` and `#edit`.

**Files:** `ui/src/DocView.tsx`, `ui/src/App.tsx`, `ui/src/styles.css`, delete `ui/src/ReferencesPane.tsx` (see step 8), `tests/ui-guard.test.ts`.

**Steps**

1. Layout: DocView renders `CommandBar` above a scrolling `.desk`, inside which `.page` is a grid `minmax(0,820px) 292px` (sheet + margin), gap 36px, centered, padding-top 28px (the edit ribbon needs the room – it was clipped in the first mock).
2. Command bar, read mode: breadcrumb (keep `className="breadcrumb"`): folder segments in `--ink-3`, the doc name in `--ink` 500. Paths deeper than 3 segments collapse the middle to `…` with the full path in `title`. Rename / Move / Delete icon buttons stay right after it (same handlers, labels, menus). Right side: the draft pill / "on draft" chip (existing logic), `Verify` (`.btn.line`, existing handler and `verifiedByYou` states), `Edit` (`.btn.primary`). Edit mode: breadcrumb, an amber "Unsaved changes" chip while dirty, then `Cancel`, `Save as verified` (OKF, non-reserved), `Save` (primary, shows `Ctrl S`). Keep every existing disabled/title condition (reserved files, saving, verifying).
3. The sheet (`.sheet`): `--sheet` background, `--r-lg` radius, `--sheet-shadow`, padding 56px 76px 72px. Edit mode adds the 1.5px accent outline and the ribbon "Editing on a draft · <branch>" pinned on the top edge.
4. Masthead, top to bottom:
   - kicker: `type` in accent mono caps (OKF only, when present), a 28px rule, the doc path in mono.
   - title: `displayTitle(frontmatter.title, name)` in Newsreader 500 54px/1.04, tracking −0.022em, followed by the accent period (CSS `::after`). In edit mode the title is edited through the metadata block as today – the masthead shows the live value.
   - standfirst: `frontmatter.description` in italic serif 21px, `--ink-2`; omitted when absent.
   - byline: avatar (existing avatar resolution, rounded-square 36px), author name, the line `v<version> · saved <date> · <n> min read` (read time = words / 230, rounded up), and on the right the trust seal: a ring with the tier glyph + tier word + the `generated` actor (`generated by <actor>`) or the latest verification (`verified by <actor> · <date>`). The seal is information only – Verify lives in the command bar.
5. Details: the existing unified metadata block (`details`/`summary`) restyled as the mock's spec sheet: summary "Details" + a mono preview `type · status · N keys` on the right; rows as a two-column grid (mono key, value). Edit mode keeps the existing inputs, validation and inline errors – restyle only. It opens automatically in edit mode only if it does today; do not change that behaviour.
6. The hard-wrap notice: restyled as the amber `.notice` with an icon; text unchanged (a test pins it).
7. Prose: serif 18px/1.7 for both the read renderer and the Tiptap editor (identical – entering edit mode must not reflow, DESIGN.md §3). `h2` gets a CSS counter rendered as the mono accent "01" via `::before` (CSS only – nothing is written to markdown). Links to docs get the `↗` prefix via a class the link renderer already distinguishes (doc link vs external – check `resolveLinkTarget`). Comment highlights: `--hl` background with a thin amber underline; the focused one darker. Draft-change bars (draft gutter) move to 28px left of the text column, amber, 3px.
8. Connections (OKF repos only): at the end of the sheet, "Connections" (serif italic) + "N references · M backlinks", then a card grid: one card per `references` entry and per `referenced-by` entry (backlinks marked "links here"), each with trust mark, mono path and serif title (titles from the `docs` list; missing docs render the path in `--ink-3` with "missing"). Click opens the doc through the guarded navigation; Shift+click opens it in the preview (phase 6). Reserved files keep the §3.1 note that `ReferencesPane` shows today, as one muted line. This replaces the References toggle and `ReferencesPane` – delete both and the `refsMode` state in App.
9. History line under Connections (all repos): clock icon, "N versions · last by <author>, <date>", and when a GitHub slug exists a link "History on GitHub ↗" to `https://github.com/<owner>/<repo>/commits/<branch>/<docsRoot-joined path>` (build with `encodeURIComponent` per segment; `rel="noreferrer"` `target="_blank"`).

**Tests:** update the harness where the header moved (Edit/Save/Cancel names unchanged); add: breadcrumb collapses a 5-segment path to `a / … / d / name` with the full path in `title`; the masthead shows description as standfirst and omits it when absent; read time for a 1,150-word fixture is "5 min read"; Connections renders references and backlinks and hides on non-OKF meta; the seal shows `generated by` vs `verified by` correctly. Pure helpers (`collapseCrumb`, `readMinutes`, `wordCount`) go in `ui/src/display.ts` with unit tests.

**Visual check:** `#read` and `#edit` (scroll the whole doc), both themes. Check the ribbon is not clipped and that entering edit mode does not move the first paragraph.

**Done when:** gates green; no reflow on Edit (screenshot before/after at the same scroll position and compare).

### Phase 5 – Marginalia: comments beside their text

**Goal:** threads sit in the 292px margin, level with their highlighted text, instead of a separate rail.

**Files:** new `ui/src/margin-layout.ts`, `ui/src/CommentsRail.tsx` (becomes the margin), `ui/src/App.tsx`, `ui/src/DocView.tsx`, `ui/src/styles.css`, new `tests/margin-layout.test.ts`.

**Steps**

1. Pure layout function in `margin-layout.ts`:
   `layoutNotes(items: { id: string; anchorTop: number | null; height: number }[], opts: { gap: number; top: number }): Map<string, number>`. Items with an anchor are placed at `max(anchorTop − 14, previousBottom + gap)` in anchor order; when an item is focused, the layout must place the focused item exactly at its anchor and push earlier items upward when room exists (second pass). Items without an anchor (orphans) are not placed – they render in the bottom list.
2. The margin is rendered inside the doc's scroll container (`.page`'s second column), so notes scroll with the text. Each note is absolutely positioned at the computed `top`. A dashed connector (`::before`) points left toward the sheet.
3. Measuring: anchors are `.sheet [data-c="<id>"]` elements (the same spans `jumpToDoc` uses today; read mode and the Tiptap editor both render them). Compute `anchorTop` relative to the margin's top with `getBoundingClientRect`. Re-run layout, throttled to one `requestAnimationFrame`, on: thread list change, `document.fonts.ready`, a `ResizeObserver` on the sheet and on each note, editor `update` transactions (DocView exposes an `onLayoutChange` callback fired from Tiptap's `onUpdate`), image `load` events in the sheet, and window resize.
4. Header (sticky at the margin top): comment icon, "Notes N", "Show resolved · M" (existing toggle). Below the last positioned note: orphaned threads ("Not anchored" group, existing orphan styling and note) and, when shown, resolved threads that have no live span.
5. Interaction: clicking a highlight focuses its note (`.on`: raised, shifted 4px left) – replace today's "scroll the rail and flash" with "re-layout with focus + flash". Clicking a note's "Jump to text" scrolls the doc span into view and flashes it. Reply, resolve, reopen, delete, @-references and the agent chip all keep their current code – only the container changes.
6. The empty state: "Select text in the doc to leave a note." in `--ink-3`, placed under the last note (or at the top when none).
7. ≤ 1180px: keep the existing bottom-sheet rail behaviour – render the old list layout there (a CSS switch is enough: below 1180px the notes are `position: static` in a list). Do not break it.

**Tests (`margin-layout.test.ts`):** no overlap for 3 notes whose anchors are 10px apart; order follows anchors; orphans not placed; focused note lands exactly on its anchor and earlier notes move up when space allows; a note taller than the gap pushes the rest down. Harness: a doc with two `data-c` spans renders two notes and clicking the second span marks the second note focused.

**Visual check:** `#read` with the test repo – create two comments on paragraphs far apart and one on the line right below another, check alignment and collision handling; type in edit mode above a comment and watch it follow.

**Done when:** gates green; notes stay aligned while typing, resizing and toggling the theme.

### Phase 6 – Live preview beside the doc

**Goal:** the `#preview` screen: two sheets side by side, both scrollable, the main one still editable, nothing overlapping.

**Files:** `ui/src/Slideout.tsx`, `ui/src/App.tsx`, `ui/src/DocPreview.tsx`, `ui/src/DocView.tsx`, `ui/src/styles.css`, `ui/src/slideout-geometry.ts` (unchanged API).

**Steps**

1. When a preview is open, the stage's desk becomes a two-column grid: main page column and preview sheet, gap 18px, split by the existing draggable divider and share (`slideout-geometry.ts`, clamp 40–60%, persisted). The navigator auto-collapses once (existing rule – the user's manual choice wins).
2. Each column scrolls independently (`overflow: auto` on both; the stage itself does not scroll). The main doc stays fully interactive, including edit mode – opening a preview never cancels or blocks editing.
3. The preview is a sheet like the main one (radius, shadow), with a head row: kicker "Preview — <path>", `Link at cursor`, `Open` (existing promote-to-main through the navigation queue), close (`Esc` keeps its place in the existing Escape chain).
4. While the preview is open, margin notes fold to pins: 34px avatar chips at the same computed positions (same `layoutNotes`, heights fixed at 34). Clicking a pin focuses the thread and expands that single note as a popover over the margin (the preview stays open); Esc collapses it.
5. `Link at cursor`: DocView registers an imperative handle with App (`insertDocLink(path: string): boolean`) that calls the existing `applyAtReference` path from `ui/src/editor/at.ts` against the main editor at its current selection (Tiptap keeps the last selection while blurred). The button is disabled with title "Start editing the main doc to insert a link" when the main doc is not in edit mode. Because it uses the same path as `@` references, the OKF `references` field updates on save exactly like a typed `@` link – verify this.
6. The PR list does not use this layout (phase 9).

**Tests:** harness – with a preview open, the main doc's Edit still works and `Save` still saves; `Link at cursor` is disabled in read mode and, in edit mode, inserts a link whose `href` is the previewed path (assert on the editor's markdown output); Escape closes the preview before touching the edit.

**Visual check:** `#preview` at 1920×1080 and 1440×900: no overlap, both columns scroll, main ribbon visible; insert a link via the button, save, check the doc's references updated.

**Done when:** gates green; the owner's scenario works: scroll the preview, keep editing the main doc, insert a reference.

### Phase 7 – Branch menu with branch state

**Goal:** the `#branch` popover: each branch with ahead/behind, PR chip, and a conflicts warning.

**Files:** `src/core/git.ts` or new `src/core/branch-status.ts`, `src/server/index.ts`, `ui/src/api.ts`, `ui/src/Menus.tsx`, tests.

**Steps**

1. Core `branchStatus(repoRoot, main, branch)`: ahead/behind via `git rev-list --left-right --count <main>...<branch>` (validate both names with `badBranchName` first; pass them after `--end-of-options` where git supports it); `conflicts` via `git merge-tree --write-tree --name-only <main> <branch>` – exit code 1 means conflicts, 0 clean, anything else → `null`. `merge-tree --write-tree` needs git ≥ 2.38: detect the version once at startup (`git --version`) and return `conflicts: null` on older git. This must never touch the working tree or index – merge-tree does not.
2. Route `GET /api/branches/status` → `{ branches: { name, ahead, behind, conflicts: boolean | null, lastCommitAt }[] }` for every local branch except main. Called only when the menu opens, never on boot.
3. Menu UI per the mock: current branch with a check, LED and "approved · synced N min ago" for main; draft rows with mono name, `PR #n` chip (from the existing `prByBranch`) or "no PR", and a muted line "N ahead · M behind" plus "conflicts with main" in amber when true. Keep: create-branch input, delete with the merged gate, existing actions and their accessible names. Footer: "Editing on main starts a draft branch for you."

**Tests:** core tests on a temp repo (follow `tests/drafts.test.ts`'s temp-repo pattern): clean branch → conflicts false; a branch editing the same line as main → true; ahead/behind counts; an invalid branch name is rejected before any git spawn. Server test for the route shape. Harness: the menu renders the chip and the conflict line from a stubbed response.

**Visual check:** `#branch` against the app with two draft branches in the scratch repo, one made to conflict on purpose.

### Phase 8 – Search palette with live preview

**Goal:** `#search`: results left, preview right, an Actions group.

**Files:** `ui/src/SearchModal.tsx`, `ui/src/styles.css`, tests.

**Steps**

1. Two-column body (400px results / preview). Results keep the existing data (`SearchHit`: title, path, snippet) and keyboard model (↑/↓ wrap, Enter opens, Shift+Enter previews beside, Esc closes). Add the trust mark per hit (from meta) and the folder as mono text on the right.
2. Preview: on selection change, debounce 120ms, then `getDoc(path)`; cache results in a `Map` for the modal's lifetime; render kicker + title + the first ~600 characters of the body as plain text paragraphs with the query highlighted using `highlightSegments`. Never render the body as HTML. Ignore a response that arrives after the selection moved on.
3. Actions group (below documents, only when the query matches the action name): "Sync now" (calls the existing sync), "New document", "Open reference graph" (OKF only). They run through the same guarded paths as their buttons.
4. Placeholder and footer copy from the mock.

**Tests:** harness – arrow keys move the selection and the preview requests the selected path once (debounced); stale responses are ignored; the Actions group appears for "sync" and runs the sync handler.

**Visual check:** `#search` with "sync" typed.

### Phase 9 – Pull requests: list drawer and full-stage review with a rendered diff

**Goal:** `#prs` and `#review`.

**Files:** `src/core/github.ts`, `src/server/index.ts`, `ui/src/api.ts`, `ui/src/PRPane.tsx` (split into `PRList.tsx` and `PRReview.tsx`), new `ui/src/prose-diff.ts`, `ui/src/App.tsx`, tests.

**Steps – server**

1. `PullRequest` type: add `base.sha`, `merged_at: string | null`, `created_at: string`; `PullRequestFile`: add `previous_filename?: string`. Pass `created_at` and `merged_at` through `prSummary`.
2. `listPulls(slug, opts, state: "open" | "closed" = "open")` – add the parameter; the route `GET /api/prs?state=closed` passes it (validate: only `open`/`closed`). Closed PRs with `merged_at` are "Merged" in the UI, others "Closed".
3. `getPullCommits(slug, n)` → `GET /repos/{o}/{r}/pulls/{n}/commits?per_page=50`; add `commits: { sha, message, author }[]` to the `/api/prs/:n` response (first line of message only).
4. New route `GET /api/prs/:n/doc?path=<path>`: returns `{ base: { frontmatter, body } | null, head: { frontmatter, body } | null }` for one file. Rules: `path` must be one of the PR's files (fetch the file page(s) and check membership – never serve arbitrary paths) and must end in `.md`; fetch each side with the GitHub contents API using the signed-in user's token: `GET /repos/{o}/{r}/contents/{path}?ref={sha}` with `Accept: application/vnd.github.raw+json` (base side uses `previous_filename` for renames; `added` → base null; `removed` → head null). Parse each with gray-matter server-side (the same call `readDoc` uses). Cap each side at 1 MB; larger → `{ tooLarge: true }`, and the UI shows the Source tab only.
5. Up-to-date check: if a local branch named `head.ref` exists, compare `git rev-parse <ref>` with `head.sha`; return `localUpToDate: boolean | null` on `/api/prs/:n`.

**Steps – client diff (`prose-diff.ts`, pure, no dependency)**

6. `diffFrontmatter(a, b)`: per key → `same | added | removed | changed` (compare with `JSON.stringify` after sorting object keys).
7. `diffBlocks(aBody, bBody)`: split each body into blocks with the existing `sourceBlockSpans` (fence-aware) from `ui/src/draft-gutter.ts`; strip comment spans first (a local copy of the `<span data-c="…">…</span>` → inner-text rule; the canonical one is `stripCommentSpan` in `src/core/comments.ts` – keep them in sync and test both on the same fixtures). Align blocks with an LCS on whitespace-normalized block text. Classify each pair: `same`; `reflow` (equal after normalizing whitespace, different raw); `changed` (an adjacent removed+added pair of the same kind – paragraph, heading, list item); `added`; `removed`.
8. `diffWords(a, b)`: tokenize on `/(\s+)/` keeping separators; LCS over tokens; return `{ type: "same" | "ins" | "del"; text }[]`. Guard: if `tokensA × tokensB > 250,000`, return the whole block as one `del` + one `ins`. Code fences, tables and HTML blocks never get word diffs – always whole-block.

**Steps – UI**

9. `PRList.tsx`: a sheet that slides over the doc from the right (fixed, top under the command bar, bottom above the status bar, width min(48%, 720px)); the doc behind dims. Segmented filter Open / Merged / Closed with counts; rows: PR icon (green open, accent merged, muted closed), serif title, mono `#n`, `head → base`, author, age, `+a −d`. A call-to-action card when the current branch is a draft with no PR (reuses `OpenPRButton`).
10. `PRReview.tsx` takes over the stage (navigator collapsed, like the graph). Command bar: back to "Pull requests", `#n`, `Open on GitHub` (link, keep name), `Merge into main` (existing merge action, existing gating and conflict link-out – keep "Resolve on GitHub" text). Left column (260px, sticky): files (each selectable; status and +/−), status checks (`mergeable` → "No conflicts with main" or the conflict link-out; `localUpToDate` → "Branch is up to date with GitHub" / "Local branch is behind GitHub"), commits. Main: a sheet with the big `#n` + title + state chip + `head → base` + author/time; then a kicker for the selected file and the Rendered / Source segmented control.
11. Rendered tab: the frontmatter table (changed keys only: old struck in red, new in green), then blocks: `same` blocks render as quiet serif paragraphs (plain text with inline code detection – backtick spans become `<code>`, nothing else is interpreted); consecutive `reflow` blocks collapse into one row "N paragraphs reflowed – line breaks only, no words changed" with a Show toggle; `changed` blocks get a green left bar and inline `<ins>`/`<del>` from `diffWords`, rendered as React text nodes; `added`/`removed` blocks as whole green/red blocks. Long unchanged stretches (> 3 blocks) collapse to "N unchanged paragraphs" with a toggle.
12. Source tab: the existing patch renderer (keep `.pr-patch-row` classes – tests pin them) and the 20-file pager.
13. Keep `data-prview` on `.app-frame` updated (`list` / `pr:<n>`) – tests read it.

**Tests:** `tests/prose-diff.test.ts`: frontmatter changed/added/removed; reflow-only detection (hard-wrapped vs unwrapped paragraph); a single-word change yields one `del` and one `ins`; inserted sentence at the end; fence blocks never word-diffed; the size guard; comment spans stripped identically to `stripCommentSpan` (import the core function in the test and compare outputs on shared fixtures). `tests/server-prs.test.ts`: the `/doc` route rejects a path not in the PR, a non-`.md` path, and a bad PR number; added/removed/renamed sides; the 1 MB cap; `state=closed` passthrough; commits in the detail response. Harness: Rendered is the default tab, Source shows the existing patch rows, the reflow row collapses N blocks.

**Visual check:** `#prs` and `#review` in auth mode against a real PR in the scratch repo – create one that rewraps a hard-wrapped doc and changes one sentence, so the reflow row and an inline change both appear.

### Phase 10 – Reference graph: folder grouping, folding, inspector

**Goal:** `#graph`.

**Files:** `ui/src/GraphView.tsx`, new `ui/src/graph-group.ts`, `ui/src/styles.css`, tests.

**Steps**

1. Pure `graph-group.ts`:
   - `folderAt(path, depth)`: the first `depth` folder segments (`""` for root-level docs; depth `Infinity` = full folder).
   - `foldGraph(graph, folded: Set<string>)`: replaces every node under a folded folder with one folder node `{ path: "<folder>/", title: "<name>/", count }`, merges edges between the same endpoints into one with `weight`, drops self-edges created by folding.
   - `groupsOf(nodes, depth)`: map group key → node paths, nested (a depth-2 group knows its depth-1 parent).
2. Layout: in the existing force tick, add a cluster force pulling each node toward its group's centroid (strength ~0.02, tune visually), applied for the innermost visible group. Keep the existing caps (`TICK_CAP`, `RING_CAP`) and deterministic seeding.
3. Hulls: per group and frame, draw an ellipse around the group's node positions (bounding box + 40px padding), dashed, very low-contrast fill; level-2 hulls are smaller-dashed inside their parent; labels in serif italic (level 1, 20px) / mono-ish italic (level 2, 15px) at the hull's top-left.
4. Controls (floating, top-left): "N docs · M links · K isolated" (keep the existing count text format in the test or update it deliberately) + segmented "Group: Off / 1 level / 2 levels / All" (default 2, persisted in localStorage). Top-right: zoom −/+, fit, Export ▾ (existing Mermaid/DOT/JSON/bundle actions in a menu). Bottom-left: legend (trust tiers + isolated + folded folder).
5. Folding: a folder hull label (and the folder node) has a fold/unfold button; folded folders render as a rounded-rect node "name/ · N docs"; edge weights > 1 show a small mono count at the edge midpoint.
6. Selection: single click selects a node and opens the inspector card (kicker, title, description, references / referenced-by lists – clicking one selects it, `Open` and `Preview` buttons); non-neighbours dim to 35%. Double-click or `Open` navigates (existing `onOpenDoc` path). Keyboard: nodes are focusable; Enter = select, Shift+Enter = open.
7. The graph takes over the stage with its own command bar ("Reference graph", Close – keep the `Close graph` label).

**Tests:** `tests/graph-group.test.ts`: `folderAt` at depths 1/2/∞; folding merges edges with weights and removes internal edges; unfolding restores the original; nested groups. Harness: the existing graph tests updated for the select-then-open interaction (`.gv-node` count unchanged for an unfolded graph).

**Visual check:** `#graph` with grouping at 1 and 2 levels and one folder folded; use the 4-level scratch folder from phase 3.

### Phase 11 – Merge-conflict resolution

**Goal:** `#conflict`.

**Files:** `src/core/drafts.ts` (`mergeState`), `ui/src/api.ts`, `ui/src/ResolutionView.tsx`, `ui/src/styles.css`, tests.

**Steps**

1. `mergeState` adds per doc file `sides: { ours: { ref, author, date }, theirs: { ref, author, date } }` from `git log -1 --format=%an%x00%aI <HEAD|MERGE_HEAD> -- <path>` (through `git.ts`; tolerate failure with nulls).
2. UI: command bar "Resolving merge · `<theirs> → <ours>`" + `Abort merge`. Header: kicker (type + path), serif headline "N places where both branches changed the same words", one line of guidance, a chip "k of N resolved" and a progress bar.
3. Each hunk is a sheet: header with the section name (the nearest markdown heading above the hunk, found by scanning the preceding `text` parts – pure helper, unit-tested), the line number, and "Write my own". Resolved hunks collapse to one line ("Kept main's version" / "Kept the draft's version" / "Wrote my own") with Change. Open hunks show two side-by-side columns: branch label + author/date, the side's text in serif with the words that differ from the other side highlighted (`diffWords` from phase 9; plain text only), and `Keep main` / `Keep draft` (primary on the draft side). "Write my own" opens the existing textarea editor.
4. Footer: the sidecar note ("Comment threads merge on their own – no action needed." when the sidecar summary exists), `Abort merge`, `Conclude merge` (disabled until all resolved – existing logic).
5. Keep the assembled preview available behind a "Preview result" toggle (existing `resolve-preview` content).

**Tests:** `nearestHeading(parts, i)` unit tests; core test that `mergeState` reports authors for both sides on a conflicting temp repo; the existing `merge-resolution.test.ts` stays green.

**Visual check:** `#conflict` – produce a real conflict in the scratch repo (two branches editing one sentence, merge from the UI).

### Phase 12 – Sign-in page

**Goal:** `#signin`.

**Files:** `ui/src/AuthGate.tsx`, `ui/src/styles.css`.

**Steps**

1. Split layout: left art panel (`--desk-2`) with two stacked paper sheets drawn in CSS (no images), the tagline "Write docs in your repo. Ship them as Open Knowledge." in italic serif 30px, and the mono line "OKF v0.2 native · plain markdown · your git history". Right: the `fragmt.` wordmark (64px italic serif, accent period), "Sign in with GitHub to read and edit these docs. Your saves become commits under your own name.", the dark "Continue with GitHub" button (existing login href), and the small print "Your GitHub permissions on this repo decide what you can do here. fragmt keeps the session in memory only – nothing about you is stored on this server."
2. Do not show the repo name or URL before sign-in: `/api/auth/session` is reachable unauthenticated, and on a LAN-bound `--auth` server the repo's identity is not public information. (Decided in the owner round – the mock was changed to match.)
3. Keep the existing error states (failed callback, forbidden) – restyle them as `.notice` blocks under the button.

**Tests:** harness – the sign-in view renders the button with the existing login link and no repo name.

**Visual check:** `#signin` both themes, in auth mode signed out.

### Phase 13 – Documentation

1. `docs/DESIGN.md` through `fragmt agent save`: amend §1 (chrome now = rail + navigator + command bar + status bar), §6 (the sheet is the one deliberate card; floating layers keep one shadow level), §10 (fonts: Newsreader + Geist + Geist Mono), the tokens section (new names and values, both themes, the contrast table from phase 1), and every "v1 surfaces" bullet that moved (tree, doc view, comments → marginalia, link slideout → side-by-side sheets, search, PR review with the rendered diff, graph grouping). Keep the anti-patterns list; add "no glass".
2. `docs/ARCHITECTURE.md`: the new routes (`/api/branches/status`, `/api/prs/:n/doc`, `?state=` on `/api/prs`, the `repo` field on `/api/meta`) and the pure UI modules (`margin-layout`, `prose-diff`, `graph-group`).
3. `README.md`: replace the screenshot (`docs/screenshot-lightmode.png`) with a new 1920×1080 light-mode capture of the read screen, plus a dark one if the README shows both.
4. `docs/BACKLOG.md`: a graduation entry for this round (date, branch, PR, what shipped), in the file's existing style.
5. Move this file to `docs/milestones/ui-v1.md` once all phases shipped, and leave `docs/app.v1.html` in place as the reference.

### Phase 14 – Final sweep

1. Full gates, then the whole visual protocol once more for all eleven screens, both themes, 1920×1080 and 1440×900; 1024×768 for regressions.
2. Keyboard-only walk: Tab through the rail, navigator, command bar, sheet, margin; Ctrl+K, Ctrl+S, Ctrl+\, Esc chain (search → popover → menus → bubble → selection → preview → cancel edit).
3. Behaviour regression walk against the phase-0 screenshots: every action that existed still exists and works (create/rename/move/delete doc and folder, drag and drop, restore from bin, branch create/switch/delete, merge, open PR, PR merge, comments create/reply/resolve/reopen/delete, verify, save as verified, graph export, sign out).
4. Open a PR `feat/ui-v1 → main` with the phase list, the screenshots folder location, and the test count delta.

## 4. Known limits (accepted)

- The rendered PR diff interprets no inline markdown inside changed blocks except backtick code – bold/links show as their source characters there. The Source tab is the exact view.
- Code blocks, tables and images diff as whole blocks.
- `conflicts with main` needs git ≥ 2.38; older git shows no conflict hint.
- Marginalia positions are recomputed on change, not continuously; a note may lag one frame behind fast typing.
- Fonts load from Google Fonts as today (the reader's IP reaches Google). Self-hosting them is a separate decision for the owner.
