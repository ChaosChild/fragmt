# M5 — Distributables & install

**Goal:** fragmt installs without cloning this repo — a published npm package, GitHub Releases on tags, and a quickstart that starts from `npx fragmt`.
**Proves:** anyone can run v1 on their own clone in under a minute, no build step.

Recorded 2026-08-20 (owner direction, same session that renumbered dogfood hardening to M6); the publish-readiness deliverable migrated here from that spec. The implementation-exact detail gets locked in a Lavish round when the milestone is picked up.

## Scope (owner-stated)

- **npm package, really published** — `npx fragmt@latest init && npx fragmt@latest serve` works on a clean clone of any docs repo.
- **GitHub Releases** — tagging a release publishes it: a CI workflow builds, and the release carries notes from the milestone record.
- **Install without cloning this repo** — global install (`npm i -g fragmt`) and `npx` both first-class; from-source remains the contributor path.
- **README quickstart rewritten for the installed path** — `npx` first, from-source second.

## Publish readiness (migrated verbatim from the dogfood-hardening spec)

- **Shebang:** `#!/usr/bin/env node` at the top of the emitted `dist/cli/index.js` (TypeScript won't emit one — add it via a build step that prepends, or a tiny `prebuild`). Verify `fragmt --help` runs from the installed bin.
- **`"files"` allowlist** in `package.json`: ship `dist/` + `ui/dist/` only (NOT `src/`, `ui/` sources, `docs/`, `tests/`, `spikes/`). Prefer the allowlist over `.npmignore`.
- **`npm publish --dry-run` clean:** no missing-repo-field warnings, no stray files, correct `bin` + `engines`. Inspect the tarball with `npm pack`.
- Acceptance (moved from M6's list): a fresh `npx fragmt@<version> init && serve` on a clean clone works end-to-end — tree, edit → save → commit, branch, comment.
