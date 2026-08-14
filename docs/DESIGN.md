# Design principles

The base for fragmt's UX/UI templates and style guide. North star in one line:

> **A quiet reading room, not a workspace.** Notion feels like a cockpit — panels, hovers, popovers, template galleries. fragmt should feel like a well-set book that you can occasionally write in.

## Principles

### 1. Content is the interface
The rendered doc IS the product. Chrome (sidebars, toolbars, buttons) must earn every pixel; when in doubt, remove it. Default view = tree + doc, nothing else.

### 2. White space is a feature, not waste
Generous margins, tall line-height, one comfortable reading column. Density is never a goal — a screen that feels half "empty" is correct.

### 3. Reading is the default state; editing is a deliberate act
Docs open read-only, typeset for reading. Edit is one explicit action (the Edit button, M2) that visibly changes mode. No always-live cursor, no accidental edits, no hover-to-reveal block handles in read mode.

### 4. Progressive disclosure — first-run shows almost nothing
A first-time user sees: the tree, a doc, an Edit button. That's it. Branch dropdown, sync status, comments live quietly in corners and margins until relevant. **Never** greet a new user with onboarding modals, template galleries, or feature tours — the empty-state doc itself explains the one next step.

### 5. No hover minefields
At most one hover-revealed affordance per region. Actions live in fixed, predictable places (top-right of the doc pane; right margin for comments). Nothing important is *only* reachable by hovering — hover reveals shortcuts, never hides functionality.

### 6. Typography does the design
No cards, no shadows-as-decoration, no icon zoo. Hierarchy comes from type scale, weight, and space. Markdown output should look like a well-typeset article, not an app skin.

### 7. Calm feedback
- Sync/save state: one small, fixed indicator (e.g. "saved · synced" text in a corner) — no toast parade.
- Errors: an inline banner with the problem and the one next step (the M2 409 banner is the template: what happened, what to do, nothing destructive). Modals only for genuinely blocking choices.
- No skeleton-loader theater; local server responses are fast — render when ready.

### 8. Keyboard-friendly, mouse-obvious
Every action reachable by keyboard; nothing *requires* memorizing shortcuts. v1 floor: focus order matches visual order, Escape cancels edit mode, Ctrl/Cmd+S saves.

### 9. Accessibility is the floor, not a feature (non-negotiable)
Text contrast ≥ 4.5:1, visible focus rings (never `outline: none` without replacement), semantic HTML headings/landmarks, hit targets ≥ 32px, all interactive elements labeled. This never loses a trade-off.

### 10. Calm is not bland
Calm is spacious and quiet; it is not anonymous. fragmt has a deliberate editorial voice — a gunmetal/silver metallic palette, a typographic identity (Newsreader headings, a chapter-opening h1, an italic wordmark, mono running-header labels), and one distinctive royal-blue accent. Personality lives in type, space, the machined silver/gunmetal materiality, and that single accent — never in added chrome or decoration (§1, §6 still govern). It must never regress to a default-library or stock-framework look (Primer, Bootstrap): anonymous default-framework chrome — boxed borders and off-the-shelf component skins — is the failure state. The identity carries the distinctiveness; the accent colour is not the problem.

## Style guide starters (tokens)

Define these as CSS variables from day one. **Both themes ship in v1**: every color below is a semantic variable (`--bg`, `--fg`, `--fg-muted`, `--accent`, `--border`, `--danger`, `--success`) with a light and a dark value — components only ever reference the variable. Default follows `prefers-color-scheme`; one small toggle in the top-bar corner overrides it (persisted in `localStorage`). The accessibility floor (§9) applies to **both** themes — contrast is checked twice or not at all.

**Type**
- Body: 17px / line-height 1.65. UI chrome: 13–14px.
- Scale (1.25 ratio): h1 ≈ 33px, h2 ≈ 27px, h3 ≈ 21px, body 17px, small 13px.
- Fonts: system stack for UI; body text may use one high-quality reading face later — start with the system stack, decide during dogfood. Monospace: system mono stack for code.

**Layout**
- Reading column: `max-width: 72ch`, centered in the doc pane, side padding ≥ 24px.
- Sidebar: 260px, collapsible, hairline border — no contrasting panel background.
- Vertical rhythm: headings get more space above than below (≈ 2:1).

**Space** — 4px base: 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64. No off-scale values.

**Color** — light theme: silver/platinum — cool platinum off-white background (not pure `#fff`), gunmetal ink text (dark steel gray with a cool cast). Dark theme: gunmetal — deep blue-steel charcoal background, silver/off-white text; same cool steel temperature as light so the two themes read as one machined object under different light. Per theme: 3–4 cool neutral grays, **one royal-blue accent** — a deep, saturated royal blue (links + primary actions + focus + the brand period + the h1 hairline; lifted brighter in dark), muted *cool* semantic red/amber/green for errors/warnings/success. Nothing else. If a mockup needs a fifth color, the mockup is wrong — in either theme.

**Shape** — one border radius (6px) everywhere; hairline 1px borders over shadows; shadows only for genuinely floating layers (menus, dialogs), one soft level.

## v1 surfaces, in these terms

- **Tree (sidebar):** plain text rows, folder disclosure triangles, current doc highlighted with the accent — no per-doc icons/emoji, no drag handles in v1.
- **Doc view:** breadcrumb line (small, gray) + typeset content. Edit button top-right. Nothing else in the pane.
- **Editor (M2 + M2-2):** identical typography to view mode — entering edit mode must not reflow the text. Save / Cancel where Edit was. Formatting surfaces are contextual only, never persistent: a selection/right-click bubble (marks, turn into, table structure, image edit) and a `/` slash menu for inserting blocks; an empty-doc placeholder hints at both. Markdown-native typing (Tiptap input rules) and keyboard shortcuts keep working. *(Amended by M2-2, which reversed the original "no floating toolbars in v1" decision after dogfooding — see milestones/M2-2-editing-controls.md.)*
- **Branch dropdown (M3):** small control in the top bar, reads as metadata ("on main"), not a headline feature.
- **Comments (M4):** invisible until text is selected (selection → one small affordance) or a thread is opened; threads in the right margin, resolved hidden by default. Comment highlights in read mode: barely-there tint, never boxes.

## Roadmap surfaces — decided now, built later

Where each **already-established** roadmap item lives, so implementing it never starts with "what and where". Timing per PLAN.md's cut lines.

- **MCP server (v1.1):** no UI surface. Agents get parity through core; nothing to design.
- **Search (v1.x):** Ctrl/Cmd+K opens a centered overlay palette — one input, results as doc path + snippet, Enter opens, Escape dismisses. No persistent search pane, no search chrome in the sidebar.
- **Doc ordering (v1.x):** lives in `.fragmt.json` `order` first (edit the file). If a UI follows, it's an explicit reorder mode in the tree — drag handles appear only in that mode, never in normal browsing.
- **Conflict resolution (v1.x):** the calm-feedback banner pattern, never a merge UI: what conflicted + one action ("resolve on GitHub / in your editor") + link. The doc stays readable behind it.
- **Auth — GitHub OAuth Device Flow (v2):** one modest sign-in screen: the code, the verify URL, nothing else. Signed-in state = username/avatar, small, in the top-bar corner by the sync indicator. No account or profile screens — GitHub owns identity; we display it.
- **PR create / review (v2):** "Open PR" as one action next to the branch dropdown, handing off to GitHub. Incoming PR review comments render read-only in the right margin using the M4 comment presentation. GitHub stays the review surface; we never rebuild it.
- **Agent-in-the-UI (roadmap):** a right-side drawer, summoned explicitly (button or shortcut), never open on first run — the reading room stays quiet until the agent is called for. BYOK setup is one field inside the drawer, not a settings page. Agent edits land as ordinary commits through the same seam as user saves, attributed in the commit — no special "AI content" styling in docs.
- **Import — Notion/Confluence (roadmap):** CLI-first, progress printed to the terminal; the result is markdown files reviewed via git diff. No import wizard UI.

**The boundary:** this list plus the v1 surfaces is the entire designed product. Anything not named here or in PLAN.md has no home and no guidelines — **if we haven't spoken about it, it doesn't exist** until it's discussed and added here first.

## Anti-patterns (the Notion critique, operationalized)

Never ship: onboarding modals or template pickers on first run · floating "+" buttons and per-block hover handles in read mode · nested hover menus · per-doc emoji/icon pickers · more than one accent color · toast stacks · collapsible-everything sidebars with badges · settings screens for things a config file states once.

---
`ponytail:` this doc is the taste reference, not a component library. Build the style guide (actual CSS variables + a sample doc page) as part of M1's UI task, checking each screen against the principles above.
