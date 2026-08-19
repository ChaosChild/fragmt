# Backlog

Deferred issues and enhancements captured while dogfooding — nothing here is
scheduled or specced. An item graduates into a milestone in
[PLAN.md](PLAN.md) (and gets an implementation-exact spec in
[milestones/](milestones/)) when it's picked up. Add new entries with the
date and the session that surfaced them.

## Link behavior

### In-app link navigation (2026-08-14, M2-2 dogfooding)

Links in rendered docs should behave like a docs app, not a raw file view:

- **Links to another document in the same repo** (relative markdown links
  such as `[PLAN](PLAN.md)` or `[spec](milestones/M2-2-editing-controls.md)`)
  must **navigate within fragmt**: load the target doc into the doc pane —
  no full page reload, sidebar selection follows.
- **External links** (`http://`/`https://`, other absolute URLs) must open in
  a **new tab/window** (`target="_blank" rel="noopener noreferrer"`) so they
  never hijack the fragmt tab.

Notes for whoever specs it:

- The **minimal set shipped with M4-2 item 5** (`@` references): read-mode
  doc links navigate in-app (Ctrl/Cmd+click in edit mode), external links
  open a new tab. What remains here: **anchor fragments (`#heading`)**,
  links to **non-markdown files** (open raw? download?), **folder links**,
  and `../` cases beyond the editor's basic join-and-check.
- Resolve relative paths against the *current doc's directory*, not the repo
  root; handle `../` traversal and URL-encoded characters. The existing
  traversal guard in `resolveDocPath` is the safety net.

## Sidebar — cards, actions, and sizing

### Card file actions move to the content header (2026-08-19, post-M4-2 dogfooding)

The M4-2 corner icons don't work as shipped:

- They render inconsistently between rows — on **folder rows they overlap
  the file-counter badge**.
- The **move popover "flashes"** — opens and immediately closes with the
  file name in it — so the action is unusable.

Direction (owner's, from dogfooding):

1. **Remove the move/delete icons from the navbar altogether.**
2. **Rename, move, and delete become functions of the content header**, on
   the breadcrumb's file name (shown without the extension): three small
   icons to the right of the name — rename (pen), move, delete (trash).
   - *Rename* turns the file name (sans `.md`) into an **inline edit box**.
     This needs **title ↔ filename rules** (perhaps a YAML frontmatter
     title) so the display name stays human-readable while the FS filename
     never violates syntax.
   - *Move* shows the **tree/list of folders** and the user selects a
     destination.
   - *Delete* asks for a **confirmation prompt first**.
3. **The navbar gets drag & drop** — dragging files and folders around moves
   them; dragging into the **recycle bin area deletes**.

### Recycle bin audit — it doesn't render (2026-08-19, post-M4-2 dogfooding)

The recycle bin (M4-2 item 9) is not visible at the bottom of the navbar.
Audit the implementation against the spec — what was done, what was not —
and complete the work. Likely cause to check first: the bin is hidden when
the deleted list is empty, and this repo has no deletions yet. It should be
an always-visible area — it is also the drag-delete target for the item
above.

### Nested card width collapses (2026-08-19, post-M4-2 dogfooding)

Cards get narrower with each nesting level; a few levels deep the name is
barely visible, and five levels down it's gone. Direction:

1. **Fixed minimum card width regardless of level**; the maximum is 100% of
   the available width.
2. **Right-side indicators move to immediately after the name** (folder
   count badge, doc version) — nothing right-aligned, where overflow can
   hide it.
3. **The navbar's width becomes resizable.**

## Content header

### Draft badge missing in the doc header (2026-08-19, post-M4-2 dogfooding)

The draft badge doesn't show in the content header area. Investigate and
fix. Note the current M4-2 rule: the draft pill renders **only on main**
(when another branch carries changes to the open doc) — on a draft branch
the header shows `vN · branch` with no badge. The expectation from
dogfooding is a draft badge whenever the doc/branch is in draft state.

### Author avatar never resolves (2026-08-19, post-M4-2 dogfooding)

The GitHub avatar doesn't render — initials show even though the author's
email is linked to a GitHub account with an avatar. The M4-2 heuristic only
resolves `@users.noreply.github.com` emails; a regular address has no
keyless email→username path. Investigate (confirm what the local git email
actually is), then fix — likely a config mapping (email → GitHub username
in `.fragmt.json`), keeping the noreply heuristic as the zero-config case.

## Editor polish

### Edit lands scrolled near the end of the file (2026-08-19, post-M4-2 dogfooding)

Clicking Edit used to keep the content at the top; it now scrolls to
somewhere near the end of the file. Investigate the mode-flip focus/scroll
behavior (caret-focus scroll? the doc-head layout change?) and restore
staying at the top.

### `@` menu needs a height cap (2026-08-19, post-M4-2 dogfooding)

The reference popup currently opens with the height of the entire screen.
Cap its height and let the list scroll inside its container.

## Drafting model

### Branch deletion (2026-08-19, post-M4-2 dogfooding)

Dead branches accumulate naturally:

- Started editing a document → a draft branch was auto-created → the
  changes got discarded → the document's state is unchanged, but an empty
  branch is left behind.
- A feature was documented across multiple files (one draft branch), then
  dropped — undoing the edits wholesale is easiest by deleting the branch.

Add branch deletion — in the branch dropdown. Deleting the checked-out
branch requires switching away first; branches with unmerged commits need
`git branch -D`, so confirm before doing something git's `-d` would refuse.
Merge already deletes merged branches with `-d` (M4-2); this is its manual
counterpart.

### Merge-conflict resolution in the UI (2026-08-18, M4-2 planning)

With protected main and effectively one draft line per document, merge
conflicts should be rare — but they remain possible when main moves under a
draft (out-of-tool edits, another machine), and comment sidecars are the
likeliest collision point. M4-2 keeps the M3 discipline: the merge aborts,
HEAD (and the checked-out branch) are restored untouched, and the UI surfaces
the message. Look later at resolving conflicts inside fragmt — doc-level and
sidecar-level — instead of aborting.

### /api/meta history-walk performance (2026-08-18, M4-2 planning)

M4-2's metadata endpoint feeds the cards and doc head from a single
`git log` walk (capped at 2000 commits, one spawn) on every refresh. Fine for
a personal docs repo; a large repo would feel it in sidebar-refresh latency.
When it bites: `rev-list` per doc, or a cache invalidated by HEAD — the
ceiling is ponytail-marked in core.

## Tree & files

### Respect .gitignore in the doc tree (2026-08-18, post-M4-2 dogfooding)

`listTree` skips dot-folders, `node_modules`, and `dist` by hardcoded rule,
but anything else a `.gitignore` excludes (build output, caches, scratch
folders) still shows as browsable docs when it contains markdown — and the
fs-derived surfaces built on the walk (`/api/meta` snippets, the UI's
doc/ghost sets) inherit the leak. The tree should exclude ignored paths:
`git check-ignore` or a `git ls-files` allow-list is the seam, one call per
tree refresh (not per file), with the hardcoded skips kept as the fallback
when the repo has no ignores. Decide whether ignored docs that ARE tracked
(the classic force-add) still show — git's own answer (tracked wins over
ignore) is the sane default.

## Agent interaction

### The agent as a first-class user (2026-08-19, post-M4-2 dogfooding)

The product's premise is agents as first-class users (README: agentic-ready
from the ground up; the MCP server is the first thing after v1). Today
nothing surfaces for an agent: it sees a folder of MDs, can edit files
directly and **bypass the drafting model completely**, has **no way to
discover comments** (inline spans and sidecar threads are invisible without
reading fragmt's own specs), and no affordance to start, inspect, or merge
drafts.

Scope a real design before v1.1:

- **Read surface** — comments, draft state, and doc metadata over the API:
  what does an agent query to "see" what a human sees in the UI?
- **Write surface** — draft-aware mutations: can an agent start a draft,
  leave comments, and request a merge through the same one-commit contracts
  the UI uses?
- **Protocol** — the HTTP API is the seam for the planned MCP server; what
  is missing for tool-shaped use (the M4-2 routes are a start)?
- **Discovery** — how does an agent learn the rules (an in-repo conventions
  surface? exposed docs?) instead of having to read the source?
