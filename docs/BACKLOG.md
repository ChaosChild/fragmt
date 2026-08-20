# Backlog

Deferred issues and enhancements captured while dogfooding — nothing here is scheduled or specced. An item graduates into a milestone in [PLAN.md](PLAN.md) (and gets an implementation-exact spec in [milestones/](milestones/)) when it's picked up. Add new entries with the date and the session that surfaced them.

## Drafting model

### /api/meta history-walk performance (2026-08-18, M4-2 planning; audit 2026-08-19; measured 2026-08-20, M4-4 planning)

M4-2's metadata endpoint feeds the cards and doc head from git-log walks: walk 1 is one spawn capped at 2000 commits; walk 3 (recycle bin) one spawn capped at 200; walk 2 (draft map) is one `for-each-ref` plus one `git log` per non-main branch — the real scaling axis is branch count. Refresh fires on discrete user actions (mount, branch ops, saves, file ops, restore), not on the sync timer.

Measured on this repo (2026-08-20, M4-4 planning): **~250 ms warm / 377 ms cold** for the full `repoMeta()` at 19 docs, 13 non-main branches, 77 commits — not biting. All ceilings are ponytail-marked in core. When it bites: `rev-list` per doc, or a cache invalidated by HEAD — a straight swap inside `repoMeta`.

## Graduated

- Merge-conflict resolution in the UI → specced and shipped as M4-4 (stand-conflicted merge, per-hunk ours/theirs/edit resolution, structural sidecar merge, conclude-merge commit; the M4-3-era "milestone of its own" cost estimate was right — it was one).
- Drag & drop collision-aware targets → shipped in M4-4 (client tree consult: drop-target validity + move-picker filtering).
- The agent as a first-class user → graduated into M4-4 as the `fragmt agent` CLI + AGENTS.md + identity (the planned MCP server was dropped in the same decision — the CLI is the agent contract).
