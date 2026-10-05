# Sync a served checkout that fell behind origin (#54)

Backlog round, 2026-10-05. Issue: [ChaosChild/fragmt#54](https://github.com/ChaosChild/fragmt/issues/54). Triage sharpened the report's mechanism: `sync()` pulled only the **current branch** but pushed `--all`, so any non-current branch – `main` while a `drafts/<doc>` branch is checked out (syncs fire on focus, interval, and edit entry) – was pushed without ever being pulled; a `main` without upstream tracking additionally no-oped its pull even when checked out. A rejected push was classified as `{conflict:true}` and the UI appended "Resolve the file in your editor" – misleading when the checkout is merely stale. Filed from a live incident: 0 ahead / 83 behind, the UI blocked until a manual `git fetch && git merge --ff-only origin/main`.

## What ships

1. **Core** – `src/core/sync.ts`, `sync()` integrates origin before pushing, at the same scope it pushes:
	- `main` current: plain `git pull --rebase=merges` when tracking config exists (unchanged); explicit `git pull --rebase=merges <remote> <main>` when it does not (the variant that silently no-oped). A missing remote ref (never-pushed repo) stays a no-op.
	- `main` not current (a draft is checked out): `git fetch <remote> <main>:<main>` – fetch's own fast-forward-only semantics update a strictly-behind `main` and refuse a diverged one. Refusals and missing remote refs are swallowed; divergence is classified at push. Commits fast-forwarded are counted (`rev-list --count <old>..main`) and returned.
	- The mirror skips empty `drafts/*` branches (tip == main's tip): a draft pointer carries no work, so edit-entry's freshly created branch never lands on origin and an abandoned one stops being re-mirrored. Branches and tips come from one `for-each-ref refs/heads --format="%(refname:short) %(objectname)"` spawn; the push rides explicit refspecs (`<name>:refs/heads/<name>`) through the existing `pushRefs`/machine-credential paths.
	- One retry: a non-fast-forward push rejection re-runs the `main` fast-forward (heals a race with another writer between fetch and push) and pushes once more.
	- A second rejection classifies as divergence: `SyncDivergedError` (branches parsed from git's `! [rejected]` lines, one honest sentence per shape – `main` gets "switch to main and sync", which is verifiably true there: the explicit pull rebases). A clean sync that fast-forwarded returns `{conflict:false, ff:{branch:"main",commits:N}}` – "synced behind remote" as data, not an error.
2. **Server** – `src/server/index.ts`: `/api/sync` maps `SyncDivergedError` to `409 {error, diverged:true, branches}`; the now-dead route-level non-fast-forward catch is deleted. `POST /api/merge` and `/api/merge/conclude` pass the session's slug/token into the merge so the post-merge auto-cleanup can reach origin.
3. **Remote drafts cleanup** – `deleteRemoteBranch(repoRoot, name, as?)` in `src/core/sync.ts`: under auth the explicit-URL token push (`:refs/heads/<name>`), locally `git push <remote> --delete <name>`; the remote is the branch's tracking remote, else origin, else the first remote. `mergeToMain`/`concludeMerge` thread the optional `as` into `cleanupDraftBranch`; the `DELETE /api/branches/:name` route best-effort-deletes the origin copy after the local delete. Failures stay best-effort (the local intent already succeeded) – prevention comes from the mirror skip.

The UI needs no change: a divergence arrives as a thrown 409 and lands in the existing red-LED detail (`ledDetail`); the conflict banner keeps serving true rebase conflicts, where "resolve the file" is correct.

## Excluded

- A short fetch poll while serving – the existing focus/interval/edit-entry triggers now fetch-integrate on every run.
- Auto-rebase of a diverged non-current `main` (local commits exist while origin moved on): rare, and rebasing someone's `main` behind their back crosses the data-safety line the sync mirror drew (never force, never rewrite another writer's state). The 409 tells the user to switch to `main` and sync, where the existing rebase self-heal runs.
- Regenerating OKF artifacts after a rebase integration – the existing `pull --rebase=merges` path's pre-existing condition, unchanged here.
- Prune-style remote mirroring (`push --prune`) – it deletes every remote branch the local checkout lacks, which in a multi-writer repo deletes other writers' branches. Never.

## Tests

Added in `tests/sync.test.ts` (bare-origin fixtures): behind-main fast-forward while a draft is checked out (the reported incident end to end, including the empty draft staying off origin), explicit pull with no upstream tracking, diverged non-current main throws `SyncDivergedError` and never force-pushes, empty-draft mirror skip, `deleteRemoteBranch` mechanics; in `tests/server-m3.test.ts`: the `/api/sync` 409 divergence shape and the `ff` field on success. Full count in the PR body.
