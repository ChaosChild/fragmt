# Backlog

This file is a historical record, not an actively maintained queue – the live work queue is the GitHub issues carrying the [`backlog`](https://github.com/ChaosChild/fragmt/labels/backlog) label; what remains here is the index and the graduation log. The issue body is canonical for scope – entries here are pointers, never second descriptions. An item graduates when picked up – into a milestone in [PLAN.md](PLAN.md) through M5, into a backlog-driven round since milestones were retired (2026-08-26) – getting an implementation-exact spec in [milestones/](milestones/) either way; the issue closes against the round's PR and the pointer moves to *Graduated*. Add new entries with the date and the session that surfaced them.

## Index

### v1.x – polish & workflow (roadmap round, 2026-08-21)

### Post-v1 – collaboration first, then the OKF era (order locked 2026-08-21)

- Agent-in-UI: harness bridge + client-side agent tools – after multi-user – #22
- MCP – reconsider after multi-user / remote deployment – #23

### Older items, still open

- /api/meta history-walk performance (2026-08-18, M4-2 planning; measured 2026-08-20) – #17
- npm trusted publishing migration – before January 2027 (2026-08-21, M5 release round) – #19

### Future (post-v2)

- Multi-repo hosting – clone, switch between and manage several repos from one instance; only makes sense once the fragmt CLI is available to agents with remote repo access (2026-09-01, round-2 Lavish review) – #28

## Graduated

- OKF support #21 → shipped 2026-09-18 in v0.9.0 (`feat/okf-rungs-1-2` + `feat/okf-rungs-3-4` → PRs #36 + #37): rungs 1–4 plus the references core and pane — `init --okf` (fresh, existing-repo flip, nested), `validate [--fix]` over the three §11 clauses with self-healing generated indexes, reserved `index.md`/`log.md`, the derived `references`/`referenced-by` graph, the unified metadata editor with §4.1 extension keys, trust stamping (`generated`/`verified`, four verify affordances including `fragmt agent verify --as-actor`), trust badges + `verifiedByYou`, the conditional OKF AGENTS block, and a React component harness pinning the dirty-guard matrix. Spec source moved to `GoogleCloudPlatform/open-knowledge-format` (v0.2). Specs in [milestones/okf-rungs-1-2.md](milestones/okf-rungs-1-2.md) and [milestones/okf-rungs-3-4.md](milestones/okf-rungs-3-4.md). The rung-5 remainder closed 2026-09-20 in v0.9.1 (`feat/okf-graph-export` → PR #38, decisions locked in the 2026-09-18 Lavish review): the repo-wide reference graph as a fourth main-pane state (zero-dependency SVG force layout, trust-tier colors, stale rings, isolated docs, dirty-guard-wired node navigation), exported as Mermaid/DOT/JSON through `GET /api/graph` and `fragmt export`, plus the bundle zip — with three operator rounds folded in (head-row entry + collapsed-topbar button, close button, bare bottom-left legend, full-disc node hit targets). Spec in [milestones/okf-graph-export.md](milestones/okf-graph-export.md). The issue is closed — the OKF initial build is complete; the Attested Computation (§10) revisit comes next per the locked vote.
- OKF rungs 3–4 #33 (split from #21) → shipped complete in the same v0.9.0 round, with four operator-review passes folded in (unified editing, extension keys, side-by-side references, reserved-file surfaces) and the dirty-guard hardening.
- Merge-conflict resolution in the UI → specced and shipped as M4-4 (stand-conflicted merge, per-hunk ours/theirs/edit resolution, structural sidecar merge, conclude-merge commit; the M4-3-era "milestone of its own" cost estimate was right – it was one).
- Drag & drop collision-aware targets → shipped in M4-4 (client tree consult: drop-target validity + move-picker filtering).
- The agent as a first-class user → graduated into M4-4 as the `fragmt agent` CLI + AGENTS.md + identity (the planned MCP server was dropped in the same decision – the CLI is the agent contract).
- Search #14 → shipped 2026-08-26 in the first backlog-driven round (`feat/search-slideout` → v0.6.0): server-side flat scan behind `GET /api/search`, Ctrl/Cmd+K palette opening through the navigation queue; spec in [milestones/search-and-link-slideout.md](milestones/search-and-link-slideout.md).
- Link slideout #15 → same round: the comment rail became a two-mode slideout (comments + read-only preview) with the collapse chrome, promote-to-editor, and the Escape-chain slot; spec in [milestones/search-and-link-slideout.md](milestones/search-and-link-slideout.md).
- Draft change visibility #18 → shipped 2026-09-01 in backlog round 2 (`feat/draft-gutter-multiuser` → 0.7.0 candidate): one `git diff main..HEAD -U0` spawn behind `GET /api/draft-diff`, a pure blank-line/fence-aware block mapping with a correct-or-absent guard, amber bars on the touched blocks in read and edit mode; spec in [milestones/draft-change-visibility.md](milestones/draft-change-visibility.md).
- Avatar resolution #30 → shipped 2026-09-15 in `feat/avatar-resolution` → v0.8.0: verified-email cache for signed-in users, authors-map notice for local mode; the avatar gap described is closed both ways.
- Nested docs repo #16 → shipped 2026-09-15 in `feat/nested-docs-repo` → v0.8.0: init --folder --new create path (folder created if missing, existing markdown into the initial commit), ask-and-wait origin graduation staging gitlink + .gitmodules (tracked-folder migration included), AGENTS.md at both roots, wrong-root redirect for serve/agent; the OKF subdirectory shape #21 composes on.
- Multi-user auth foundation #20 → shipped 2026-09-01 in v0.7.0 (`feat/draft-gutter-multiuser` → PR #29): serve --auth (GitHub OAuth web flow, in-memory per-user sessions, the /api/* gate, collaborator permissions with the user's own token, loopback default), per-user commit authors, the sign-in gate UI, verified-email avatar resolution (#30 follow-up in v0.8.0).
- PR create/review in the UI #27 → shipped 2026-09-22 in v0.10.0 (`feat/pr-wiring`): per-user push identity (committer + pusher = the signed-in user; token as an env-injected http extraheader, scrubbed from errors), the sync mirror (push --all, never force – drafts stop living only locally), the GitHub client + /api/prs routes, PR chips + the slideout's Pull requests mode (paged diffs, in-UI merge, conflict link-out), and the merged-gated branch delete. Spec in [milestones/pr-wiring.md](milestones/pr-wiring.md).
