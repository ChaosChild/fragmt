# Product requirements

## Problem

Documentation tools are expensive and heavyweight. Notion's free tier block limit is unusable (exhausted on a first serious document) and paid tiers are ludicrous for individuals and small teams. Open-source alternatives (AppFlowy et al.) are cumbersome, DB-backed, and don't really work. Small dev teams, start-ups, and solo developers want a structured, usable, collaborative documentation environment without paying for it or hosting a database.

## Product & positioning

A lightweight, open-source **documentation environment** where **a GitHub repo is the storage**. Docs are plain markdown — readable on GitHub, diffable, reviewable via PRs, and directly usable by AI coding agents.

**This is not an open-source Notion.** It is not a clone and will never have Notion's full feature set — "Notion-style" refers only to the editing UX (WYSIWYG block editing, inline comments). It is also **not a CMS** — not a Decap CMS replacement; the emphasis is documentation, not publishing pipelines.

Closest existing relative: **Wiki.js** (git-backed wiki). Key differentiator: **agentic-ready from the ground up** — CLI, MCP server, and agent-in-the-UI are first-class citizens of the architecture (one core library), not bolt-ons.

## Target users

1. Individual developers (v1 — including the author, dogfooding daily)
2. Small teams collaborating on a docs repo (v2)
3. AI coding agents as first-class users (via CLI and MCP)

## v1 scope (single user, local)

- **CLI**: `npx <tool> init` — point at a GitHub repo (or run inside a clone). If docs already exist, adopt them (markdown needs no conversion); create config + folder conventions.
- **Local web server** on a free port serving the UI.
- **UI**: folder tree navigation; Notion-style WYSIWYG editor over markdown; create/rename/move docs and folders; save = commit with local git identity; push/pull; branch dropdown (main = approved, branches = drafts).
- **Inline comments**: highlight text → comment (self-notes). Mark-anchored, sidecar-stored (see ARCHITECTURE.md). Resolve/delete.
- **Sync**: auto pull/rebase on interval, window focus, and before editing — never draft against a stale copy.

## v2 scope (hosted, multi-user)

- Same binary deployed to a cloud box hooked to the repo.
- GitHub OAuth (Device Flow) — edits attributed to real GitHub users (author=user).
- GitHub collaborator permissions = access control. No user management built.
- Draft review = PRs; PR review comments used natively.
- Webhook-driven sync.

## Expansion (roadmap, order TBD)

- **MCP server**: agents look up, reference, and update docs through the same core library.
- **CLI import**: import from Notion export, Confluence, etc.
- **Agent-in-the-UI**: chat panel with BYOK (bring your own key/subscription, OpenCode/Hermes style) for drafting, updating, reviewing docs.

## Principles

- Free forever for the obvious use; open source; community-driven.
- GitHub does the heavy lifting: storage, history, auth, permissions, review.
- Every feature must survive the question: "does git/GitHub already do this?"

## Non-goals

- Being "open-source Notion" — feature parity with Notion is explicitly not the aim.
- Notion databases (relations, rollups, kanban).
- CMS features (publishing pipelines, site generation, content modeling).
- Real-time cursors/CRDT.
- Hosting user content anywhere but the user's repo.
- Enterprise features (SSO, audit logs) — enterprises can keep paying Notion.

## Resolved questions

- Project name: **fragmt**.
- License: **MIT**.
- Editor: **Tiptap** (spike, see docs/SPIKE.md).
