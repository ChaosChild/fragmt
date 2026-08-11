# M1 — Read-only

**Goal:** `fragmt init` adopts this repo, `fragmt serve` starts a local server, and the browser shows the folder tree and rendered docs. Nothing writes yet.
**Proves:** repo adoption + the API boundary (the UI talks HTTP only — it never touches the filesystem; see ARCHITECTURE.md §5).

Prerequisite: M0 complete (see M0-environment-prep.md).

## New dependencies (only these)

- Runtime: `hono`, `@hono/node-server`, `gray-matter`
- UI (also regular deps, single package): `react`, `react-dom`, `react-markdown`, `remark-gfm`
- Dev: `vite`, `@vitejs/plugin-react`, `@types/react`, `@types/react-dom`

`react-markdown` is the **view-mode** renderer and stays after M2 (view = react-markdown, edit = Tiptap).

## Config: `.fragmt.json` (repo root)

```json
{
  "docsRoot": ".",
  "order": {}
}
```

- `docsRoot`: path relative to repo root whose markdown is adopted. Default `"."`.
- `order`: reserved, always written as `{}` in v1, never read. Do not implement ordering.
- Unknown fields: preserved on read, never written. Parse errors: fail loudly with the file path — no silent default.

## CLI

**`fragmt init [--root <path>]`**
1. Must run inside a git repo (walk up for `.git`; error + exit 1 if none: `"fragmt init must run inside a git clone"`).
2. If `.fragmt.json` exists at repo root: print `"already initialized"` and exit 0. Never overwrite.
3. Write `.fragmt.json` with `docsRoot` = `--root` value or `"."`. Validate the root exists and is inside the repo; error otherwise.
4. Print a summary: docs root + count of adopted `.md` files. No interactive prompts — agents and CI call this.

**`fragmt serve [--port <n>]`**
1. Requires `.fragmt.json` (error: `"not initialized — run fragmt init"`).
2. Starts the Hono app via `@hono/node-server`. `--port` default `0` (OS-assigned free port); print the actual URL `http://localhost:<port>` once listening.
3. Serves the built UI from `ui/dist` at `/` **when it exists**; API under `/api`. (Dev flow uses the Vite dev server instead — see below.)

## Core (src/core/) — exact contracts

```ts
// config.ts
loadConfig(repoRoot: string): { docsRoot: string }   // parses .fragmt.json
findRepoRoot(from: string): string                    // walks up to .git; throws if none

// tree.ts
listTree(repoRoot: string, docsRoot: string): TreeNode
type TreeNode = {
  name: string;               // basename; root node: "."
  path: string;               // POSIX, relative to docsRoot ("" for root)
  type: "dir" | "doc";
  children?: TreeNode[];      // dirs only; dirs first, then docs, each alphabetical (case-insensitive)
}
// Only *.md files (exactly .md, lowercase). Skip: .git, node_modules, dist,
// and any path segment starting with "." — one hardcoded list in one place.
// Prune dirs with no .md anywhere beneath them.

// docs.ts
readDoc(repoRoot: string, docsRoot: string, docPath: string): {
  path: string;               // echoed docPath
  frontmatter: Record<string, unknown>;  // gray-matter .data; {} if none
  markdown: string;           // gray-matter .content (body WITHOUT frontmatter)
  rawFrontmatter: string;     // gray-matter .matter — raw YAML text, "" if none.
                              // Kept so M2 can reattach byte-for-byte. Not sent to the UI yet.
}
```

**Path traversal guard (trust boundary — do not skim this):** `readDoc` resolves `docsRoot + docPath` and verifies the result is inside `docsRoot` (compare real resolved paths, case-insensitively on win32) and ends with `.md`. Violations throw a typed error the server maps to 400. This gets its own unit tests (`../` escape, absolute path, backslash tricks on Windows).

## Server (src/server/) — exact routes

JSON only; every error body is `{ "error": string }`.

| Route | Returns |
|---|---|
| `GET /api/tree` | the `TreeNode` root |
| `GET /api/docs/*` | `{ path, frontmatter, markdown }` — wildcard = doc path relative to docsRoot |
| anything else under `/api` | 404 |

- Doc not found → 404. Traversal-guard violation → 400.
- The server layer is thin: parse request → call core → serialize. No fs, no git logic in route handlers.

## UI (ui/)

Vite + React, TypeScript template. Structure it minimally:

- `ui/src/App.tsx` — two-pane layout: tree sidebar (left, collapsible dirs), doc view (main).
- `ui/src/api.ts` — the only place `fetch` happens; typed wrappers `getTree()`, `getDoc(path)`.
- Doc view: `react-markdown` + `remark-gfm`, rendering the `markdown` field (frontmatter is not displayed in v1). Show the doc `path` as a breadcrumb line above.
- Any `<span data-c>` in docs renders as plain inline text for now (react-markdown drops unknown HTML by default — acceptable in M1 view mode; the editor is what must preserve it, in M2).
- No router lib — selected doc path in `useState` is enough (`ponytail:` URL routing when deep-linking matters). No state lib, no CSS framework; one plain stylesheet whose variables and layout follow **docs/DESIGN.md** (tokens, reading column, sidebar spec) — read it before writing any UI code.
- Dev flow: fixed dev port. Add scripts `"dev:server": "tsx watch src/cli/index.ts serve --port 4400"` and `"dev:ui": "vite dev ui"`; `ui/vite.config.ts` proxies `/api` → `http://localhost:4400`. Two terminals; no concurrently dep.
- `npm run build` grows to also run `vite build` for `ui/` (output `ui/dist`, add to .gitignore).

## Tests (Vitest, tests/)

- `tree.test.ts`: build a temp dir fixture (`fs.mkdtemp`) with nested md/non-md/dotfolders; assert shape, ordering, pruning, skip-list.
- `docs.test.ts`: frontmatter split (with and without frontmatter), and **every traversal case rejects**.
- `config.test.ts`: default write, `--root` validation, refusal to overwrite.
- No UI component tests in M1 (the UI is two components; dogfood covers it).

## Acceptance

1. In this repo: `npx tsx src/cli/index.ts init` → `.fragmt.json` created, summary printed; second run says already initialized.
2. `npm run dev:server` + `npm run dev:ui` → browser shows the tree (`docs/` and `README.md` present, dotfolders and non-md noise absent), clicking `docs/PLAN.md` renders it with working GFM tables and task-list checkboxes.
3. `curl localhost:4400/api/docs/../LICENSE` (and `..%2f` variants) → 400, never file content.
4. `npm run typecheck && npm run lint && npm test` green; CI green.

## Guardrails for implementers

- Dependency list above is closed. No router, no state lib, no CSS framework, no markdown-it, no express.
- Do not implement: saving, editing, git operations, branches, comments, search, ordering. M2+ owns those.
- Do not let any route handler or UI code touch `fs` — core only.
- `.fragmt.json` schema is exactly as specced; do not add fields.
