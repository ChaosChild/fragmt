# Backlog

The work queue lives in GitHub issues carrying the [`backlog`](https://github.com/ChaosChild/fragmt/labels/backlog) label; this file is the index and the graduation log. The issue body is canonical for scope – entries here are pointers, never second descriptions. An item graduates when picked up – into a milestone in [PLAN.md](PLAN.md) through M5, into a backlog-driven round since milestones were retired (2026-08-26) – getting an implementation-exact spec in [milestones/](milestones/) either way; the issue closes against the round's PR and the pointer moves to *Graduated*. Add new entries with the date and the session that surfaced them.

## Index

### v1.x – polish & workflow (roadmap round, 2026-08-21)

- Nested docs repo – `init --folder <docs> --new <name>` – #16

### Post-v1 – collaboration first, then the OKF era (order locked 2026-08-21)

- Multi-user auth foundation – **leads** – #20 (PR wiring split to #27, 2026-09-01 round-2 Lavish review)
- PR create/review in the UI (split from #20) – #27
- OKF support – `init --okf`, conformant defaults + validate, frontmatter editor, trust stamping, references pane – #21
- Agent-in-UI: harness bridge + client-side agent tools – after multi-user – #22
- MCP – reconsider after multi-user / remote deployment – #23

### Older items, still open

- /api/meta history-walk performance (2026-08-18, M4-2 planning; measured 2026-08-20) – #17
- npm trusted publishing migration – before January 2027 (2026-08-21, M5 release round) – #19
- Avatar resolution for plain commit emails – verified GitHub emails can't map to a login without an authors entry; verified-emails rung is the lean (2026-09-01, round-2 testing) – #30

### Future (post-v2)

- Multi-repo hosting – clone, switch between and manage several repos from one instance; only makes sense once the fragmt CLI is available to agents with remote repo access (2026-09-01, round-2 Lavish review) – #28

## Graduated

- Merge-conflict resolution in the UI → specced and shipped as M4-4 (stand-conflicted merge, per-hunk ours/theirs/edit resolution, structural sidecar merge, conclude-merge commit; the M4-3-era "milestone of its own" cost estimate was right – it was one).
- Drag & drop collision-aware targets → shipped in M4-4 (client tree consult: drop-target validity + move-picker filtering).
- The agent as a first-class user → graduated into M4-4 as the `fragmt agent` CLI + AGENTS.md + identity (the planned MCP server was dropped in the same decision – the CLI is the agent contract).
- Search #14 → shipped 2026-08-26 in the first backlog-driven round (`feat/search-slideout` → v0.6.0): server-side flat scan behind `GET /api/search`, Ctrl/Cmd+K palette opening through the navigation queue; spec in [milestones/search-and-link-slideout.md](milestones/search-and-link-slideout.md).
- Link slideout #15 → same round: the comment rail became a two-mode slideout (comments + read-only preview) with the collapse chrome, promote-to-editor, and the Escape-chain slot; spec in [milestones/search-and-link-slideout.md](milestones/search-and-link-slideout.md).
- Draft change visibility #18 → shipped 2026-09-01 in backlog round 2 (`feat/draft-gutter-multiuser` → 0.7.0 candidate): one `git diff main..HEAD -U0` spawn behind `GET /api/draft-diff`, a pure blank-line/fence-aware block mapping with a correct-or-absent guard, amber bars on the touched blocks in read and edit mode; spec in [milestones/draft-change-visibility.md](milestones/draft-change-visibility.md).
