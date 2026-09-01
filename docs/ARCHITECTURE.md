# Architecture

Git-native documentation environment with Notion-style *editing UX* – explicitly **not** a Notion clone, and not a CMS (see positioning in REQUIREMENTS.md; nearest relative is Wiki.js, differentiated by being agentic-ready from the ground up). GitHub repos are the storage backend – no hosted database, no server-side storage. Working title: TBD.

## Core decisions

### 1. Markdown is the canonical storage format

- Docs are plain CommonMark + YAML frontmatter, readable and renderable on GitHub, editable by any tool (vim, agents, Obsidian).
- ProseMirror JSON is the **editor's runtime model only** – never persisted.
- Rationale: storing editor JSON would kill readable diffs, `git blame`, PR review, and GitHub-native rendering – the entire point of using GitHub as the backend.
- Folder structure = navigation tree. A repo-level config file (e.g. `.fragmt.json`) holds ordering/metadata that folders can't express.

### 2. Comments

Two types, two mechanisms:

**Inline comments (self-notes, lightweight annotations):**

- Anchoring: a ProseMirror **mark** carrying only an ID, serialized into the markdown as a minimal inline wrapper (e.g. `<span data-c="abc123">text</span>`). Marks travel with text through edits via ProseMirror position mapping – same mechanism Notion/Linear use.
- Thread content (author, body, replies, resolved) lives in a sidecar file per doc: `.docs/comments/<doc-path>.json`, keyed by mark ID. Committed like any other change – versioned, syncable, multi-user-safe, readable by MCP/CLI for free.
- Snapshot the quoted text once at creation (in the sidecar) purely for orphan display, not anchoring.
- Known limit: edits outside the editor can delete the span → comment orphans. Degradation: show orphan thread + quote snapshot + git history. Agents editing via our CLI/MCP are instructed to preserve spans.

**Review comments (drafts under review):**

- GitHub PR review comments, used as-is. We build nothing.

### 3. Git layer: local clone, not the GitHub API

- Server operates on a local checkout. Save = write file + `git commit`. Sync = pull/push. Branch switch = checkout.
- Free: offline editing, no rate limits, no API abstraction.
- Drafts = branches. Approved docs = main. PRs = review workflow.
- v2 multi-user note: concurrent users on different branches → git **worktrees** per active branch. Confined to the git layer as long as the core API is "read doc X on branch Y", never "read file from cwd".

### 4. Sync: one function, three triggers

- `sync()` = `git pull --rebase` + push pending commits.
- Triggers: `setInterval`, browser focus event, before opening a doc for editing.
- v2 hosted: add a GitHub webhook route that calls the same `sync()`. Nothing else changes.
- Conflicts: markdown merges well; on real conflict surface "resolve on branch" in UI. Fancy merge UI deferred until it hurts.

### 5. Identity/auth seams

- Every mutation flows through one function shaped like `commitAs(user, change)`.
  - Auth off (`fragmt serve`): `user` from local git config; no gate – today's
    single-user mode, bound to 127.0.0.1.
  - Auth on (`fragmt serve --auth --port <n>`): `user` from the GitHub OAuth
    web-flow session (the 2026-09-01 round replaced the old device-flow
    sketch; the callback needs a repeatable port, which `--auth` therefore
    requires). Commit with author = signed-in user (GitHub noreply email),
    committer = the machine's git identity – how GitHub's own web editor
    attributes edits.
- The gate: with `--auth`, every `/api/*` route needs a session except
  `/api/auth/*`; sessions are in-memory (a restart signs everyone out),
  cookies HttpOnly + SameSite=Lax, tokens never leave the server process.
- No users table, no roles: **GitHub repo collaborator permissions are the
  authorization system**, checked with the signed-in user's own token
  (cached ~5 min). admin/maintain/write edit, read reads, everyone else gets
  403; a non-github.com origin fails closed. True per-user push identity
  arrives with PR wiring (#27).

### 6. One core library, thin heads

```
core/        repo ops, doc read/write, comments, sync, search
  ├── cli/       init, import, serve
  ├── server/    HTTP API + web UI
  └── mcp/       MCP server exposing the same core functions as tools
```

The MCP server is nearly free once core exists. Because everything is markdown in a git repo, agents can already operate on it with git + grep; MCP makes it ergonomic.

### 7. Editor

- **Decision: Tiptap** + a custom comment mark (\~35 lines: parseHTML `span[data-c]`, renderHTML keeps `data-c`) + `tiptap-markdown` (`html: true`).
- BlockNote was rejected: it round-trips general content fine but strips `<span data-c>` comment spans on markdown export – disqualifying, since comments must live inline in canonical markdown (see §2).
- Evidence: round-trip spike against a full markdown corpus – see `docs/SPIKE.md`.
- Caveats carried forward: YAML frontmatter must be stripped before parse and reattached after (neither editor round-trips it); GFM table column alignment is lost in both editors and accepted for now; headless Tiptap in Node needs a DOM shim (`happy-dom`); StarterKit needs `@tiptap/extension-list`, `-table`, and `-image` added for full GFM coverage.

## Non-goals

- Notion **databases** (tables-as-DB, kanban, relations, rollups). This is where open-source Notion replicas die. We are docs + drafts + comments, git-native, agent-native.
- Real-time collaborative cursors (CRDT/Yjs) – branches are the collaboration model.
- Storing anything server-side that isn't in the repo.

## v1 → v2 path

|  | v1 (single user, local) | v2 (hosted, multi-user) |
| --- | --- | --- |
| Auth | none (local git identity) | GitHub OAuth Device Flow |
| Commits | local git config | author=user, committer=app |
| Branches | checkout | worktrees per active branch |
| Sync | poll + focus + pre-edit | \+ GitHub webhook |
| Permissions | n/a | GitHub collaborator access |
