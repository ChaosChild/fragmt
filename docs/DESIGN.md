# Design principles

The base for fragmt's UX/UI templates and style guide. North star in one line:

> **A quiet reading room, not a workspace.** Notion feels like a cockpit – panels, hovers, popovers, template galleries. fragmt should feel like a well-set book that you can occasionally write in.

## Principles

### 1. Content is the interface
The rendered doc IS the product. Chrome (sidebars, toolbars, buttons) must earn every pixel; when in doubt, remove it. Default view = tree + doc, nothing else. Since ui v1 (2026-10) the chrome is exactly four pieces: a narrow icon **rail** (Documents, Search, Pull requests, Reference graph; the navigator toggle, theme and the signed-in user at the foot), the **navigator** (repo name, branch, the tree; `Ctrl/Cmd+\` hides it), one **command bar** per stage (breadcrumb left, the stage's actions right), and the **status bar** (sync state, branch, word count). Everything else is the doc.

### 2. White space is a feature, not waste
Generous margins, tall line-height, one comfortable reading column. Density is never a goal – a screen that feels half "empty" is correct.

### 3. Reading is the default state; editing is a deliberate act
Docs open read-only, typeset for reading. Edit is one explicit action (the Edit button, M2) that visibly changes mode. No always-live cursor, no accidental edits, no hover-to-reveal block handles in read mode. And navigation never drops the deliberate act on the floor: every jump that would displace unsaved edits – a search open, a link click, the preview's open-in-main – routes through the navigation queue (save/discard/cancel banner; #14/#15, 2026-08-26).

### 4. Progressive disclosure – first-run shows almost nothing
A first-time user sees: the tree, a doc, an Edit button. That's it. Branch dropdown, sync status, comments live quietly in corners and margins until relevant. **Never** greet a new user with onboarding modals, template galleries, or feature tours – the empty-state doc itself explains the one next step.

### 5. No hover minefields
At most one hover-revealed affordance per region. Actions live in fixed, predictable places (top-right of the doc pane; right margin for comments). Nothing important is *only* reachable by hovering – hover reveals shortcuts, never hides functionality.

### 6. Typography does the design
No cards, no shadows-as-decoration, no icon zoo. Hierarchy comes from type scale, weight, and space. Markdown output should look like a well-typeset article, not an app skin. The one deliberate card is **the sheet**: the doc is a sheet of paper on a desk, and it carries the one sheet shadow. Floating layers (menus, the search palette, popovers, the graph inspector) keep one shadow level of their own; nothing else gets a shadow, and nothing is glass.

### 7. Calm feedback
- Sync/save state: one small, fixed indicator (e.g. "saved · synced" text in a corner) – no toast parade.
- Errors: an inline banner with the problem and the one next step (the M2 409 banner is the template: what happened, what to do, nothing destructive). Modals only for genuinely blocking choices.
- No skeleton-loader theater; local server responses are fast – render when ready.

### 8. Keyboard-friendly, mouse-obvious
Every action reachable by keyboard; nothing *requires* memorizing shortcuts. v1 floor: focus order matches visual order, Ctrl/Cmd+K opens search (Shift+Enter previews the result in the side pane), Ctrl/Cmd+S saves, and Escape closes open surfaces in a fixed order before touching the edit – search modal → popover → slash/@ menus → bubble → selection → preview → cancel edit – asking for confirmation when there are unsaved changes (M2-2; the chain's two ends extended by the search/slideout round, 2026-08-26).

### 9. Accessibility is the floor, not a feature (non-negotiable)
Text contrast ≥ 4.5:1, visible focus rings (never `outline: none` without replacement), semantic HTML headings/landmarks, hit targets ≥ 32px, all interactive elements labeled. This never loses a trade-off.

### 10. Calm is not bland
Calm is spacious and quiet; it is not anonymous. fragmt has a deliberate editorial voice – a gunmetal/silver metallic palette, a typographic identity (Newsreader for headings, prose and the italic wordmark; Geist for UI; Geist Mono for paths, labels and running heads; a chapter-opening h1), and one distinctive royal-blue accent. Personality lives in type, space, the machined silver/gunmetal materiality, and that single accent – never in added chrome or decoration (§1, §6 still govern). It must never regress to a default-library or stock-framework look (Primer, Bootstrap): anonymous default-framework chrome – boxed borders and off-the-shelf component skins – is the failure state. The identity carries the distinctiveness; the accent colour is not the problem.

## Tokens

CSS variables in `ui/src/styles.css`, copied from the visual contract `docs/app.v1.html` – values are never eyeballed. **Both themes ship**: components reference only the variable; the default follows `prefers-color-scheme` and the rail's theme button overrides it (persisted in `localStorage`). The accessibility floor (§9) applies to both themes – contrast is checked twice or not at all.

**Surfaces – "papers on a machined desk."** Light is platinum, dark is gunmetal; same cool steel temperature so the two read as one object under different light. A fixed grain layer (3.5% light, 5% dark) sits over the desk.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--desk` / `--desk-2` | `#e3e7ec` / `#d9dee5` | `#0f1318` / `#0b0e12` | everything that is not the doc; rail and navigator tint |
| `--sheet` / `--sheet-2` | `#fbfcfd` / `#f3f5f8` | `#171c23` / `#1c222a` | the doc sheet and floating layers; inset rows |
| `--ink` / `--ink-2` / `--ink-3` | `#1b2128` / `#47505c` / `#5f6875` | `#e5e9ee` / `#a8b2be` / `#8a95a2` | text, secondary, tertiary |
| `--line` / `--line-soft` | `#cdd3db` / `#e4e8ed` | `#2b343f` / `#212831` | hairlines |
| `--accent` | `#1f39b0` | `#7ea4ff` | links, primary actions, focus, the brand period |
| `--green` / `--amber` / `--red` | `#2b7a4b` / `#94660a` / `#a3292f` | `#72b38d` / `#d9a74e` / `#ef7b81` | success · warning · error, each with a `-soft` tint |

One royal-blue accent and three muted semantic colours – nothing else. If a mockup needs a fifth colour, the mockup is wrong, in either theme.

**Contrast** (WCAG ratio, text on surface):

| | sheet | desk | desk-2 |
|---|---|---|---|
| light `--ink` | 15.79 | 13.06 | 11.99 |
| light `--ink-2` | 7.96 | 6.58 | 6.04 |
| light `--ink-3` | 5.49 | 4.54 | **4.17** |
| light `--accent` | 9.00 | 7.45 | 6.84 |
| dark `--ink` | 14.04 | 15.29 | 15.86 |
| dark `--ink-2` | 7.97 | 8.68 | 9.00 |
| dark `--ink-3` | 5.63 | 6.13 | 6.36 |
| dark `--accent` | 7.04 | 7.67 | 7.96 |

Light `--ink-3` fails on `--desk-2`, so text on the rail and the navigator tint uses `--ink-2`.

**Type** – Newsreader (serif: headings, prose, the wordmark), Geist (sans: UI chrome at 13–14px), Geist Mono (paths, kickers, labels, code). Body prose 17px / 1.65; scale 1.25 (h1 ≈ 33px, h2 ≈ 27px, h3 ≈ 21px). Fonts load from Google Fonts – self-hosting is an open owner decision.

**Layout** – rail 60px · navigator 272px · command bar 56px · status bar 30px. The page is the sheet (up to 1060px) plus a 260px margin for marginalia, 28px apart; sheet padding `clamp(40px, 4vw, 76px)`. Headings get more space above than below (≈ 2:1).

**Space** – 4px base: 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64.

**Shape** – radii 5 / 8 / 14px (`--r-sm`, `--r`, `--r-lg`); hairline 1px borders over shadows; two shadows only – `--sheet-shadow` for the sheet, `--float-shadow` for floating layers.

## v1 surfaces, in these terms

*(Rewritten by ui v1, 2026-10 – see milestones/ui-v1.md. The behaviours are the M1–M5 and backlog-round ones; ui v1 changed where they live and how they look, not what they do.)*

- **Navigator (the tree):** the repo name and branch on top, then plain text rows – folder chevrons with a doc count, the current doc marked with the accent, a trust mark per doc (unverified / machine-confirmed / human-reviewed / stale – each a distinct shape, never colour alone). No per-doc icons or emoji. Drag and drop, rename, move and the bin are unchanged.
- **Doc view – the sheet:** the command bar carries the breadcrumb (collapsed in the middle when long) and Edit; the sheet opens with a mono kicker (type · status), the title, a masthead line (version, last save, reading time) and the verification seal; details, connections (references in and out) and history fold below the prose. Nothing else on the sheet.
- **Editor (M2 + M2-2):** identical typography to read mode – entering edit mode must not reflow the text. A sticky edit ribbon swaps Edit for Save / Cancel. Formatting surfaces stay contextual only: a selection/right-click bubble and a `/` slash menu; `@` inserts a doc reference with a doc-relative link. Markdown input rules and shortcuts keep working.
- **Branches (M3):** a branch chip in the navigator head reads as metadata ("on main"); its menu lists branches with ahead/behind and a "conflicts with main" hint (git ≥ 2.38), plus create, switch, delete and merge.
- **Comments – marginalia (M4):** threads sit in the 260px margin beside the sheet, each note aligned to its anchor and pushed down only to avoid overlap; invisible until text is selected or a thread exists. Resolved threads are hidden by default; comment highlights are a barely-there tint, never boxes. Doc paths inside a comment open in main on click and in the preview on Ctrl/Cmd+click, both through the navigation queue.
- **Preview – side-by-side sheets (#15):** a previewed doc opens as a second sheet beside the main one, tops and bottoms aligned; both are height-bound and scroll inside, and the main sheet's marginalia become pins that follow its scroll. "Link at cursor" inserts a reference to the previewed doc while editing. Gestures are unchanged: read-mode Shift+click, edit-mode Ctrl/Cmd+click; open-in-main goes through the navigation queue.
- **Search (#14):** Ctrl/Cmd+K opens a centered palette in two columns – results (title + plain excerpt) on the left, the highlighted doc's preview on the right – plus an Actions group. ↑/↓ wrap, Enter opens, Shift+Enter previews, Escape dismisses.
- **Pull requests (#27):** the rail's PR button opens a list drawer (open / closed, age, author); a PR opens as a full-stage review – a rendered prose diff per changed doc (blocks matched, changed words marked, plain text only) with a Source tab for the exact patch – and merges or pushes from the command bar.
- **Reference graph (OKF rung 5):** a full-stage sheet on a dotted ground; folders draw as dashed hulls (Group: Off / 1 level / 2 levels / All, remembered), a hull label folds its folder into one node and back, and merged edges carry a weight. A click selects and opens an inspector (references in and out, Open, Preview); a double-click or Shift+Enter opens the doc.
- **Merge resolution (M4-4):** a stood conflict takes the stage – one sheet per conflict with both sides word-marked, who last touched each and when, the nearest heading and line; Keep main / Keep draft / Write my own, folding to one line with Change. Comment sidecars merge on their own. Preview the result, then Conclude (or Abort, confirmed).
- **Sign-in (#20):** a split page – two paper sheets and the tagline on the left, the wordmark and one "Continue with GitHub" button on the right. Nothing about the repo shows before sign-in.

## Roadmap surfaces – decided now, built later

Where each **already-established** roadmap item lives, so implementing it never starts with "what and where". Timing per PLAN.md's cut lines.

- **MCP server (v1.1):** no UI surface. Agents get parity through core; nothing to design.
- **Doc ordering (v1.x):** lives in `.fragmt.json` `order` first (edit the file). If a UI follows, it's an explicit reorder mode in the tree – drag handles appear only in that mode, never in normal browsing.
- **Conflict resolution (v1.x):** the calm-feedback banner pattern, never a merge UI: what conflicted + one action ("resolve on GitHub / in your editor") + link. The doc stays readable behind it.
- **Auth – GitHub OAuth Device Flow (v2):** one modest sign-in screen: the code, the verify URL, nothing else. Signed-in state = username/avatar, small, in the top-bar corner by the sync indicator. No account or profile screens – GitHub owns identity; we display it.
- **PR create / review (v2):** "Open PR" as one action next to the branch dropdown, handing off to GitHub. Incoming PR review comments render read-only in the right margin using the M4 comment presentation. GitHub stays the review surface; we never rebuild it.
- **Agent-in-the-UI (roadmap):** a right-side drawer, summoned explicitly (button or shortcut), never open on first run – the reading room stays quiet until the agent is called for. BYOK setup is one field inside the drawer, not a settings page. Agent edits land as ordinary commits through the same seam as user saves, attributed in the commit – no special "AI content" styling in docs.
- **Import – Notion/Confluence (roadmap):** CLI-first, progress printed to the terminal; the result is markdown files reviewed via git diff. No import wizard UI.

**The boundary:** this list plus the v1 surfaces is the entire designed product. Anything not named here or in PLAN.md has no home and no guidelines – **if we haven't spoken about it, it doesn't exist** until it's discussed and added here first.

## Anti-patterns (the Notion critique, operationalized)

Never ship: onboarding modals or template pickers on first run · floating "+" buttons and per-block hover handles in read mode · nested hover menus · per-doc emoji/icon pickers · more than one accent color · toast stacks · collapsible-everything sidebars with badges · settings screens for things a config file states once · glass (translucent, blurred panels) – a surface is desk, sheet, or one floating layer.

---
`ponytail:` this doc is the taste reference, not a component library. Build the style guide (actual CSS variables + a sample doc page) as part of M1's UI task, checking each screen against the principles above.
