# Backlog

Deferred issues and enhancements captured while dogfooding — nothing here is scheduled or specced. An item graduates into a milestone in [PLAN.md](PLAN.md) (and gets an implementation-exact spec in [milestones/](milestones/)) when it's picked up. Add new entries with the date and the session that surfaced them.

## Drafting model

### Merge-conflict resolution in the UI (2026-08-18, M4-2 planning; cost estimate 2026-08-19)

With protected main and effectively one draft line per document, merge conflicts should be rare — but they remain possible when main moves under a draft (out-of-tool edits, another machine), and comment sidecars are the likeliest collision point. The M3/M4-2 discipline holds: the merge aborts, HEAD (and the checked-out branch) are restored untouched, and the UI surfaces the message.

Cost estimate from the M4-3 investigation (2026-08-19): in-UI resolution means letting the merge stand conflicted, parsing `<<<<<<<` markers in docs with a per-hunk ours/theirs editor, **and** structurally merging sidecar JSON (conflict markers make it unparseable — needs `:2:`/`:3:` stage reads plus a thread-map merge by id), then a conclude-merge commit that bypasses the one-commit contracts. An editor feature plus a merge engine — a milestone of its own. Revisit only if abort-and-resolve-outside actually hurts in daily use.

### /api/meta history-walk performance (2026-08-18, M4-2 planning; audit 2026-08-19)

M4-2's metadata endpoint feeds the cards and doc head from git-log walks: walk 1 is one spawn capped at 2000 commits; walk 3 (recycle bin) one spawn capped at 200; walk 2 (draft map) is one `for-each-ref` plus one `git log` per non-main branch — the real scaling axis is branch count. Refresh fires on discrete user actions (mount, branch ops, saves, file ops, restore), not on the sync timer. All ceilings are ponytail-marked in core. When it bites: `rev-list` per doc, or a cache invalidated by HEAD — a straight swap inside `repoMeta`.

### Drag & drop collision-aware targets (2026-08-20, M4-3 dogfooding)

Moving a doc onto a folder that already contains a file with the same name is refused cleanly server-side (409 "already exists", nothing moves) and the error shows in the banner — but the drag-over highlight promises a drop the server will refuse. The lazy fix when it bites: the tree is already client-side, so the picker and the drop-target validity check can consult it and simply not offer colliding destinations.

## Agent interaction

### The agent as a first-class user (2026-08-19, post-M4-2 dogfooding) — becomes M4-4

The product's premise is agents as first-class users (README: agentic-ready from the ground up; the MCP server is the first thing after v1). Today nothing surfaces for an agent: it sees a folder of MDs, can edit files directly and **bypass the drafting model completely**, has **no way to discover comments** (inline spans and sidecar threads are invisible without reading fragmt's own specs), and no affordance to start, inspect, or merge drafts.

Scope a real design before v1.1:

- **Read surface** — comments, draft state, and doc metadata over the API: what does an agent query to "see" what a human sees in the UI?
- **Write surface** — draft-aware mutations: can an agent start a draft, leave comments, and request a merge through the same one-commit contracts the UI uses?
- **Protocol** — the HTTP API is the seam for the planned MCP server; what is missing for tool-shaped use (the M4-2 routes are a start)?
- **Discovery** — how does an agent learn the rules (an in-repo conventions surface? exposed docs?) instead of having to read the source?
- **Identity** — how do the changes and comments the agent makes show this? How do users, both human and machine, identify who has done what in the repo.
