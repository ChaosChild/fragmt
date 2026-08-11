# M5 — Dogfood hardening

**Goal:** the definition of done, literally exercised — the author maintains this repo's docs in fragmt daily, and the package is publish-ready.
**Proves:** v1 is done.

Prerequisite: M0–M4 complete. M5 adds no product features — it hardens, packages, and proves.

## New dependencies (only these)

None.

## Deliverables

**Dogfood (the acceptance test):**
- Run fragmt on this repo's own `docs/` daily — including editing these milestone docs in the tool (eat your own dogfood).
- Keep `docs/dogfood.md`: dated entries for what bit and the fix. Close an entry when its fix ships.

**README quickstart (`README.md`):**
- One paragraph: what fragmt is, with the "this is not Notion" one-liner and a link to `docs/REQUIREMENTS.md` for positioning.
- Install + first run: inside a clone, `npx fragmt init` → `npx fragmt serve` → open the printed URL.
- Dev: `npm run dev:server` + `npm run dev:ui`.
- Link to `docs/ARCHITECTURE.md` for the design.

**Publish readiness:**
- **Shebang:** `#!/usr/bin/env node` at the top of the emitted `dist/cli/index.js` (TypeScript won't emit one — add it via a build step that prepends, or a tiny `prebuild`). Verify `fragmt --help` runs from the installed bin.
- **`"files"` allowlist** in `package.json`: ship `dist/` only (NOT `src/`, `ui/`, `docs/`, `tests/`, `spikes/`). Prefer the allowlist over `.npmignore`.
- **`npm publish --dry-run` clean:** no missing-repo-field warnings, no stray files, correct `bin` + `engines`. Inspect the tarball with `npm pack`.

**Hardening pass (triaged from the dogfood log, not speculative):**
- Fix the real papercuts dogfooding surfaces. Each fix is an ordinary commit; log it in `docs/dogfood.md`.
- Accessibility re-audit against DESIGN §9 (contrast ≥ 4.5:1 in BOTH themes, visible focus rings, semantic landmarks, ≥ 32px hit targets) across every M1–M4 surface.
- **Windows path/line-ending check** (the PLAN.md Risk — the author dogfoods on Windows day one): verify create/move/delete + sync over paths with spaces and backslashes, and confirm LF-on-write regardless of platform.

## Acceptance (v1 is done when ALL hold)

1. The author has updated `docs/` via fragmt (not a text editor) for a run of consecutive working days, with `docs/dogfood.md` to show for it.
2. `npm publish --dry-run` exits clean; `npm pack` contains `dist/`, `README.md`, `LICENSE`, `package.json` — nothing else.
3. A fresh `npx fragmt@<version> init && npx fragmt@<version> serve` on a clean clone works end-to-end: tree, edit → save → commit, branch, comment.
4. `npm ci && npm run typecheck && npm run lint && npx biome ci . && npm test` green; CI green on `main`.
5. Every milestone's acceptance (M0–M4) re-verified green.

## Guardrails for implementers

- M5 adds **no** product features. Dogfooding that reveals a missing feature puts it on the v1.x/roadmap list — it does not expand v1 scope.
- Do not change the storage format, the API boundary, or the `commitAs` seam in M5; M0–M4 lock those.
- README is the only sizeable new doc; the milestone set is already complete (M0–M4 + this one).
