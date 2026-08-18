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
- The head needs a layout decision, not a patch: truncate branch names
  (ellipsis + `title`), consider a two-row head, or move the branch control
  to the doc bar / top bar — `docs/app.html` (the v1-final mock) is the
  reference for intended placement.
- Whatever lands, the anti-pattern list still holds: no toast stacks, no
  nested hover menus, nothing important reachable only by hovering.

## M4-2 scope — dogfooding round 2 (2026-08-17, post-M4)

Nine items scheduled together as M4-2 in [PLAN.md](PLAN.md); the numbering is
cross-referenced, so it is preserved here.

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
