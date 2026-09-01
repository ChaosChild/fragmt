# Backlog

The work queue lives in GitHub issues carrying the [`backlog`](https://github.com/ChaosChild/fragmt/labels/backlog) label; this file is the index and the graduation log. The issue body is canonical for scope – entries here are pointers, never second descriptions. An item graduates when picked up – into a milestone in [PLAN.md](PLAN.md) through M5, into a backlog-driven round since milestones were retired (2026-08-26) – getting an implementation-exact spec in [milestones/](milestones/) either way; the issue closes against the round's PR and the pointer moves to *Graduated*. Add new entries with the date and the session that surfaced them.

## Index

### v1.x – polish & workflow (roadmap round, 2026-08-21)

- Nested docs repo – `init --folder <docs> --new <name>` – #16

### Post-v1 – collaboration first, then the OKF era (order locked 2026-08-21)

- Multi-user + PR wiring – **leads** – #20
- OKF support – `init --okf`, conformant defaults + validate, frontmatter editor, trust stamping, references pane – #21
- Agent-in-UI: harness bridge + client-side agent tools – after multi-user – #22
- MCP – reconsider after multi-user / remote deployment – #23

### Older items, still open

- /api/meta history-walk performance (2026-08-18, M4-2 planning; measured 2026-08-20) – #17
- Draft change visibility in the content area (2026-08-20, M4-4 dogfooding) – #18
- npm trusted publishing migration – before January 2027 (2026-08-21, M5 release round) – #19

## Graduated

- Merge-conflict resolution in the UI → specced and shipped as M4-4 (stand-conflicted merge, per-hunk ours/theirs/edit resolution, structural sidecar merge, conclude-merge commit; the M4-3-era "milestone of its own" cost estimate was right – it was one).
- Drag & drop collision-aware targets → shipped in M4-4 (client tree consult: drop-target validity + move-picker filtering).
- The agent as a first-class user → graduated into M4-4 as the `fragmt agent` CLI + AGENTS.md + identity (the planned MCP server was dropped in the same decision – the CLI is the agent contract).
- Search #14 → shipped 2026-08-26 in the first backlog-driven round (`feat/search-slideout` → v0.6.0): server-side flat scan behind `GET /api/search`, Ctrl/Cmd+K palette opening through the navigation queue; spec in [milestones/search-and-link-slideout.md](milestones/search-and-link-slideout.md).
- Link slideout #15 → same round: the comment rail became a two-mode slideout (comments + read-only preview) with the collapse chrome, promote-to-editor, and the Escape-chain slot; spec in [milestones/search-and-link-slideout.md](milestones/search-and-link-slideout.md).
