# PR create / review in the UI (#27)

Round spec, decisions locked in the 2026-09-22 review round (two annotation
passes; the second reshaped D5, D6 and D7). Target: v0.10.0. Branch
`feat/pr-wiring`.

## Where we stand

The #20 auth foundation (v0.7.0) shipped the prerequisite layer: the GitHub
OAuth web flow, in-memory per-user token sessions (server-side only), the
`/api/*` gate, collaborator permissions, and per-user commit *authors*.
`parseGithubSlug` / `githubSlug` already parse origin URLs. What the round
actually adds:

- `commitAs` sets only `--author` – committer and pusher still ride the
  machine identity, so GitHub attributes the push to the operator's
  credentials, not the signed-in user.
- No GitHub API client (three ad-hoc REST calls live in `auth.ts`, nothing
  shared, nothing for pulls), no PR routes, no PR surface in the UI.
- `sync()` pushes only the checked-out branch; a draft with no upstream is a
  silent no-op, so drafts live only on the local disk until pushed by hand.

## Decisions

**D1 – per-user push authentication.** `git push` to an explicit HTTPS URL
(`https://github.com/<o>/<r>.git`, derived from the slug – never origin's
URL) with the session token as
`http.https://github.com/.extraheader = AUTHORIZATION: basic base64(x-access-token:TOKEN)`,
passed through `GIT_CONFIG_COUNT / _KEY_0 / _VALUE_0` environment (the
git-credential-manager pattern). The credential never sits in argv, never
touches disk or repo config, and the explicit URL means ssh origins are fine
– fetch/pull keep riding origin's transport while per-user pushes go over
HTTPS. Requires git ≥ 2.31. A `scrub()` rewrites every GitError stream and
message before rethrow: the header value is a credential and must never
survive an error (test-locked). There is no token in local mode, ever – the
PR surface exists only under `serve --auth`; a solo operator wanting PRs runs
`serve --auth` (loopback binding is its default).

**D2 – committer identity.** `git()` gains an optional `env` merge;
`commitAs` passes `GIT_COMMITTER_NAME / _EMAIL` from the same `user` it
takes as author. Local mode passes `localUser()` – the machine identity – so
its commits are byte-for-byte unchanged. Under auth, author = committer =
the signed-in user.

**D3 – GitHub API client.** `src/core/github.ts`: `ghApi()` plus one function
per endpoint, the exact headers `auth.ts` already sends, JSON in/out,
injectable fetch (the `ServerContext.githubFetch` pattern). No octokit.

**D4 – review surface.** The slideout's fourth mode (besides comments,
preview, references): PR list → review. The review shows the PR head, state
chip, `branch → base` pair, and unified patch rows in the merge-conflict
view's visual language. Files are **paged 20 per request**
(`GET /api/prs/:n?files_page=k` proxies GitHub's file pages at
`per_page=20`); the UI renders one page at a time, so an agent-generated OKF
PR with hundreds of files never floods the DOM. Rendered-doc diffs (the
draft-gutter mapping) stay a follow-up.

**D5 – sync() mirrors every branch** (review round). `sync()` becomes
`pullRebase` + `git push --all` (never `--force`): every local branch –
every draft – reaches origin on every sync trigger, so no work lives only on
the local disk. Under auth the mirror rides the signed-in user's token (same
D1 mechanism, no refspec); local mode pushes with machine credentials.
Nuance: under auth, the syncing user's push event covers every branch riding
that sync – commits keep their authors, only the push event says who synced.
Fetch-side mirroring (pulling collaborators' branches into local) stays out.

**D6 – merge the PR from fragmt** (review round). The review's Merge button
calls `PUT /repos/{o}/{r}/pulls/{n}/merge` with the signed-in user's token,
no method override – the repo's own rules decide. A conflicted PR gets an
in-place conflicted state plus the link out to GitHub's conflict resolution;
that is the only defer-to-GitHub moment. After a fragmt-side merge the
server fast-forwards local main (`git fetch <url> main:main` with the token
env; a refusal – main checked out, or non-ff – is skipped and the next sync
handles it), which immediately opens the branch's delete gate (D7). The
local Merge button is untouched. Resolving PR conflicts locally through
fragmt's own conflict engine is the noted follow-up.

**D7 – branch delete gated on merged** (review round). The BranchMenu trash
acts only when the branch is merged: `git branch --merged main` – git-native,
not PR-based, because the local Merge button produces merged branches with
no PR involved. Unmerged = disabled trash with a "not merged yet" tooltip;
the menu's force-delete affordance goes away (the server keeps the
capability). `GET /api/branches` gains a `merged[]` list; a repo with no
`main` keeps the gate open.

## API surface

| Route | Gate | What runs | Answers |
| --- | --- | --- | --- |
| `GET /api/prs` | session (read ok) | `GET /pulls?state=open` folded into a branch→PR map | `{enabled, slug, prs[], byBranch{}}`; auth off → `{enabled:false}`; non-GitHub origin → `slug:null` – the server answer drives all UI hiding |
| `POST /api/prs` `{branch, body?}` | canWrite | default branch resolve → `pushAs(branch)` → `POST /pulls` (title derived from the branch name; no client title) | the PR (created or already-open) – a 422 returns the existing PR, idempotent |
| `GET /api/prs/:n` `?files_page=k` | session | `GET /pulls/{n}` + `GET /pulls/{n}/files?per_page=20&page=k` | detail + one 20-file page; `mergeable`, draft flag, totals |
| `POST /api/prs/:n/push` `{branch}` | canWrite | ahead-count via the PR's `head.sha` + `rev-list` → `pushAs(branch)` when > 0 | updated PR head; non-fast-forward surfaces git's refusal, never forced |
| `POST /api/prs/:n/merge` | canWrite | `PUT /pulls/{n}/merge`; on success ff local main | merged; a conflicted PR answers `{conflicted: true, html_url}` |

`/api/prs` is not exempt from the standing-merge write guard – a merge in
progress 409s PR writes like any other write. `ServerContext` gains
injectable `gitPush` / `gitFetch` seams (the `githubFetch` pattern) so route
tests never run a real push. `/api/sync` passes the session's slug + token
into `sync()` when auth is on.

## UI

- BranchMenu rows gain a PR chip: `PR #n` when the branch has an open PR
  (click → slideout opens on its review), dashed `open PR` when not (click →
  the create popover). One `GET /api/prs` when the menu opens (it already
  fetches branches then).
- Open-PR popover: description only – the direction is fixed by construction
  (this branch → the repo's default branch), the title derives from the
  branch name. Failures surface in the popover.
- The trash button disables on unmerged branches with a tooltip (D7).
- A PR button beside ⌕ in the brand row and the collapsed topbar opens the
  slideout's PR list. Hidden when `enabled:false` or `slug:null`.
- The review head carries Merge (write + mergeable + open), Push commits
  (local ahead > 0), and the ↗ link-out; a conflicted PR swaps Merge for the
  conflict state + link-out. The pager steps 20-file pages.
- Everything PR-shaped is hidden in local mode and on non-GitHub origins.
  The Escape chain and the dirty guard are untouched – PR mode is
  slideout-level and never navigates the editor.

## Batches

| Batch | Scope | Locked by |
| --- | --- | --- |
| b1 core | `git()` env opts + `mergedBranches`; `commitAs` committer env; `sync.ts` `pushRefs`/`pushAs`/`scrub` + mirror sync, old `push()` deleted | `%cn` fixture assert; push to a local bare repo over `file://` (refspec + `--all` mechanics); fabricated-GitError scrub test; URL-shape unit test; merged-set assert |
| b2 client + routes | `core/github.ts`; five routes; availability shapes; `/api/branches` merged[]; `/api/sync` token pass-through | `server-prs.test.ts` stubbed REST: shapes, 422-duplicate, conflicted merge, paging params, auth-off, non-GitHub, gate 403s |
| b3 UI entry | PR chips, Open-PR popover, gated delete, brand-row + topbar PR button, `api.ts` client fns | component tests (React harness): chip states, hiding rules, gate states |
| b4 review surface | `PRPane.tsx` list → detail, paged patch rows, Merge/Push/↗, conflict state; slideout 4th mode | component tests + a browser pass on :4400 (local mode: PR chrome hidden, dirty-guard matrix intact) |
| b5 docs + release | README, ARCHITECTURE, HOSTING (git ≥ 2.31, mirror push), BACKLOG (historical-record note, #20 graduation back-fill, #27 graduates), `0.10.0` | as-if-out README before any tag; `biome ci .` exact; human paragraph at release |

## Risks and ceilings

- Token leak paths: env-injected header, `scrub()` on every error, a test
  feeding a fake token through a real failure.
- git < 2.31 fails env-config with its own "unknown config" – surfaced
  as-is; HOSTING names the floor.
- Big PRs: paged end-to-end; no full file list is ever fetched for a review.
- Push rejections (protected branch, lost race): git's refusal line
  surfaces; pushes are atomic and never forced.
- Mirror attribution under auth: the syncing user's push event covers every
  branch riding the sync (stated, accepted for a collaborator-only server).
- In-memory sessions: a restart signs everyone out (the #20 ceiling,
  unchanged).
- Base branch ≠ main: PR create reads `default_branch`; D7's gate checks
  local `main` with a no-main fallback to open.
