# M5 – Distributables & install

**Goal:** fragmt installs without cloning this repo – a published npm package, GitHub Releases on tags, and a quickstart that starts from `npx fragmt`.
**Proves:** anyone can run v1 on their own clone in under a minute, no build step.

Scope recorded 2026-08-20 (owner direction); implementation-exact detail locked in two Lavish rounds, 2026-08-21. The owner cleared every external prerequisite during those rounds: npm account **@chaoschild** (2FA on), granular access token minted (90-day expiry – that type's cap), `NPM_TOKEN` repository secret added, and CodeQL Default setup enabled (Settings → Advanced Security).

## Decisions (locked, 2026-08-21)

- **First release: v0.5.0** – milestone number = minor version; M5 ships as 0.5.0, 1.0.0 lands when M6 closes v1. The first bump is explicit (`npm version 0.5.0 …`) because a plain minor from 0.0.0 yields 0.1.0. During 0.x, minors may break – stated in the versioning policy.
- **CI publishes on tag push.** Pushing `v*` runs the full gate, builds, publishes, cuts the GitHub Release. Local publish stays possible in an emergency but isn't the ritual.
- **Release notes: auto-generated** (`generate_release_notes: true`) with the PLAN.md "Shipped" paragraph pasted into the editable release body when a milestone summary matters. No PLAN.md parsing in CI.
- **Docs use plain `npx fragmt`** – npx resolves latest from the registry; `@latest` is noise.
- **SAST = CodeQL Default setup** at the CI layer (zero YAML, scans every PR and main push). A release tag points at an already-scanned main commit, so `release.yml` doesn't re-run it. Dependabot alerts are on by default for public repos.
- **M5 ships Windows-tested** – the README says so plainly; Linux/macOS verification opens M6 (owner's Linux/macOS testing pass).

## Batch 1 – Publish readiness

- **Shebang:** `#!/usr/bin/env node` as line 1 of `src/cli/index.ts`. tsc 7.0.2 preserves a source shebang into `dist/` (verified with the project compiler before speccing) – the build-prepend step considered earlier is unnecessary; tsx ignores it in dev.
- **`"prepublishOnly": "npm run build"`** in `package.json` – publishing a stale tarball becomes structurally impossible on any publish path.
- **Tarball audit:** `npm run build && npm pack` – the tarball must contain `dist/` + `ui/dist/` only (the `files` allowlist already exists; no `.npmignore`). No `src/`, `ui/` sources, `docs/`, `tests/`, `spikes/`, `build-logs/`.
- **Smoke test from the packed tarball** (never from source): install into a scratch dir, run `fragmt --help`, then `init` + `serve` against a throwaway docs clone. Windows is the verified platform for this milestone.
- **Smoke-test finding (fixed, 2026-08-21):** the CLI's direct-invocation guard (`import.meta.url === pathToFileURL(argv[1]).href`) silently skipped `main()` under symlinked install paths – nvm4w's junction (`C:\nvm4w\nodejs` → version dir) means ESM's symlink-resolved `import.meta.url` never equals the invoked path, so any version-manager user would get a silent no-op binary. The guard now compares `realpathSync` of both sides. The tsx dev path can't see this class of bug; only the tarball smoke test catches it – which is why it's in the acceptance list.
- **README quickstart rewritten for the installed path:** `npx fragmt init` → `npx fragmt serve` first, `npm i -g fragmt` as the equal variant, clone-and-build moved to Development (contributor path). Includes the honest platform note.
- **CONTRIBUTING – versioning policy:** semver; milestone = minor during 0.x; 1.0.0 at M6 close. Release ritual: `npm version <v> -m "<milestone>: <title>"` on merged main, push the tag. Token rotation (≤90-day granular-token expiry; symptom is a 401/OTP on the publish step; fix is mint → update secret → re-run) and the CodeQL setup documented alongside.
- **Docs:** PLAN.md M5 lines reflect this spec.

## Batch 2 – Release workflow

`.github/workflows/release.yml`, triggers on tag push `v*`:

- `permissions: contents: write` (GitHub Release) + `id-token: write` (npm provenance).
- Steps: checkout → setup-node@v4 (node 22, `cache: npm`, **`registry-url: https://registry.npmjs.org`**) → `npm ci` → `typecheck` → `biome ci` → `test` → `build` → `npm publish --provenance` → `softprops/action-gh-release@v2` with `generate_release_notes: true`.
- **Auth gotcha (found in review):** npm reads **`NODE_AUTH_TOKEN`**, not a bare `NPM_TOKEN` env var – the publish step sets `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}`. Without `registry-url` on setup-node the token isn't wired into npmrc either.
- **First-publish provenance quirk (hit live, 2026-08-21):** `npm publish --provenance` on a package that doesn't exist yet refuses with "Can't generate provenance for new or private package, you must set `access` to public" – even for unscoped packages that are public by default. Fixed with `"publishConfig": { "access": "public" }` in package.json (also covers any emergency local publish). The failed run published nothing (the error is pre-upload); recovery was re-pointing the unpublished tag at the fix commit and pushing it again.
- **Publish-2FA quirk (hit live, 2026-08-21, release runs 2–3):** npm's post-2025 security model requires **2FA or a granular token with the "Bypass two-factor authentication" checkbox** for creating and publishing packages – the checkbox is unchecked by default, and account-level "Authorization only" does not lift the requirement (first theory, disproven on run 3). Fix: mint the granular token with bypass checked → update the `NPM_TOKEN` secret → re-run. npm removes direct publishing via bypass tokens in **January 2027** (staged publishes with human 2FA approval replace it); the migration path is **trusted publishing (OIDC)** – token-free, `id-token: write` already granted – but it cannot perform a package's *first* publish, so it lands after v0.5.0 exists. The migration is in the backlog.
- A tag can never skip the gate: the workflow runs the exact CI triple before building and publishing.

## Batch 3 – First release (owner + acceptance)

1. Merge batches 1–2; re-run the tarball smoke test on merged main.
2. `npm version 0.5.0 -m "M5: distributables & install"` on main, push the tag – this is also the moment the name `fragmt` is claimed under @chaoschild.
3. Watch `release.yml` go green; package live.
4. **Acceptance** on a clean clone of some other docs repo: `npx fragmt init && npx fragmt serve` → tree renders, edit → save → commit lands, branch + draft works, comment thread works.
5. Re-scope the next granular token to just `fragmt` (a granular token can't name a package that doesn't exist yet – the first one necessarily covers all packages).
6. PLAN.md gets "Shipped: M5"; M6 opens with the Linux/macOS testing pass and daily dogfooding on the installed package.

## Risks

- **First publish is near-irreversible** (npm unpublish window: 72h) → tarball audit + smoke test before any tag; the workflow re-runs the gate before publishing.
- **NPM_TOKEN expires ≤90 days** → rotation in the ritual; publishes are atomic, a failed auth never half-publishes.
- **Out of scope:** changesets/auto-changelog (YAGNI – one maintainer, milestone tags), Homebrew/other channels (roadmap if asked).
