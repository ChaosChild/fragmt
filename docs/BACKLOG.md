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
