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

Current behavior: read mode renders default anchors — internal links
navigate the browser away (usually to a 404 or the raw file), external links
take over the tab.

Notes for whoever specs it:

- Applies to **read mode** (react-markdown `a` component override) and
  **edit mode** (Tiptap `Link` mark click handling — likely follow-only while
  editing, e.g. Ctrl/Cmd+click).
- Resolve relative paths against the *current doc's directory*, not the repo
  root; handle `../` traversal and URL-encoded characters. The existing
  traversal guard in `resolveDocPath` is the safety net.
- Decide and spec: anchor fragments (`#heading`) within the same doc; links
  to non-markdown files in the repo (open raw? download?); links to folders.

**2026-08-18:** the minimal set (in-app navigation for doc links, external →
new tab) ships with M4-2 item 5 because `@` references are links; the rest —
anchors, non-markdown targets, folder links, `../` edge cases — stays here.

## Sidebar chrome

### Navbar / tree-row design pass (2026-08-17, M3 dogfooding)

The M3 additions to the sidebar work but read as bolted-on chrome; the head
and the rows need a rethink before v1:

- **The branch dropdown crowds the sidebar head.** A long branch name pushes
  the dark/light toggle out of view and the dropdown itself clips at the right
  edge — the head has no width budget for brand + new-doc + branch + sync LED
  + theme in one row.
- **The new-document "+" button sits awkwardly** in the head — placement and
  visual weight feel wrong rather than merely new.
- **The per-row "..." action menu renders on every doc/folder row** — that
  much visible affordance for an occasional action is noise, and it fights the
  calm-reading-room premise (DESIGN §1).

Notes for whoever specs it:

- DESIGN §5 permits at most one hover-revealed affordance per region and
  forbids hover-ONLY functionality: the kebab could be revealed on row
  hover/focus while the same actions stay reachable from a fixed place (e.g.
  the doc bar for the open doc) — rows must keep ≥32px targets and full
  keyboard reach either way.
- **The head needs a layout decision, not a patch: truncate branch names**
  (ellipsis + `title`), consider a two-row head, or move the branch control
  to the doc bar / top bar — `docs/app.html` (the v1-final mock) is the
  reference for intended placement.
- Whatever lands, the anti-pattern list still holds: no toast stacks, no
  nested hover menus, nothing important reachable only by hovering.

**2026-08-18:** the head layout and row-affordance halves of this item
graduated into M4-2 (items 11 and 1 — two-row head with brand + "+" / branch
+ global Merge, kebab revealed on hover/focus) per the Lavish M4-2 round 2.
The item stays open only for whatever dogfooding still flags.

## M4-2 scope — dogfooding round 2 (2026-08-18, post-M4)

Eleven items scheduled together as M4-2 in [PLAN.md](PLAN.md); the numbering
is cross-referenced, so it is preserved here.

1. **Navigation cards to the mock.** Doc cards carry author, date last
   edited, a short snippet, version, and a draft indicator
   (`docs/app.html` `.doc-card`). Blocked since M1 on the tree API carrying
   no metadata — needs the git-log metadata API (last author/date/version
   per doc) that M1 deferred.
2. **Drafts must be visible.** Creating a branch and creating/editing a
   document on it shows no draft card anywhere today. A card per doc that
   differs from `main` (new, edited, deleted) with its branch — flows into 1
   and 3.
3. **Document header to the mock.** The email-style doc head (author ·
   "editing vX · branch" · unsaved indicator, `app.html` `.doc-head`), plus
   icons on Cancel/Save (currently text-only; the mock uses ✕ / ✓).
4. **Reopen resolved comments.** Resolved threads can only be deleted. The
   server currently pins `resolved: true` (`PATCH` rejects `false` — "v1.x");
   reopen needs that lifted plus the rail affordance.
5. **"@" references.** An `@` command — in documents and in comment bodies —
   to reference existing documents, as a menu like the `/` slash menu. Ties
   into the in-app link-navigation item above: a doc reference IS a
   navigable link.
6. **"+" gains a folder option.** The new-document action becomes a dropdown:
   document (default) or folder — `createFolder` exists in core and the API,
   only the UI is missing.
7. **Protected main.** Editing a document on `main` should automatically
   create a draft branch (possibly auto-named, no user prompt) and move the
   document to draft. The platform operates on the principle that main is
   protected — whether the branch actually is or not.
8. **Merge is the operator's call.** With drafts visible in the navbar (1
   and 2), a "Merge" button on the draft merges its branch to `main` —
   multiple files per draft, merged together when the user decides. This
   settles the sequencing question of when a draft becomes a PR: the
   operator creates it on GitHub from the merged branch, or merges directly.
9. **Restore deleted documents.** Everything is in git; deleting should be
   reversible — restore a deleted doc (and its comments sidecar) from
   history.
10. **One commit per logical comment action** (graduated from "Git & commits"
    below, Lavish round 2): comment create/delete become single commits
    covering doc + sidecar; M4's anchoring contract is amended in the same
    change.
11. **Sidebar head layout** (graduated from "Sidebar chrome" above, Lavish
    round 2): two-row head — brand + "+" / branch selector + global Merge
    button; kebab revealed on hover/focus per DESIGN §5.

## Git & commits

### One commit per logical action, including comments (2026-08-18, post-M4 dogfooding)

Creating a comment ships **two commits** — the document's markdown (the new
`data-c` span) and then the sidecar JSON. That is the M4 spec's anchoring
contract ("two sequential commits via `commitAs`"), but in practice it is
overkill: the two files are one logical action and should land in **one
commit**.

Notes for whoever specs it:

- `commitAs` already takes a `files` array — write the doc body and the
  sidecar, then one `commitAs` call covering both paths. The doc-first
  ordering that motivated the split (a stale-hash 409 must never leave a
  half-written comment) is preserved by validating/saving the doc *before*
  the commit, not by committing it separately.
- Pick a message that names the action (`Comment on <docPath>` beats two
  `Update …` commits).
- Same lens on comment **delete**: today it is a sidecar commit plus the
  span removal waiting for the doc's next save — the most split action of
  all. One commit covering doc + sidecar there too.
- Amend the M4 spec's anchoring contract when this lands; the tests pinning
  one-commit-per-file-op show the pattern.

**2026-08-18:** graduated into M4-2 as item 10 (Lavish round 2).

## Drafting model

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
