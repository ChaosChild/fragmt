# M6 – Dogfood hardening

**Goal:** the definition of done, literally exercised – the author maintains this repo's docs in fragmt daily, and the real papercuts are fixed.
**Proves:** v1 is done.

Renumbered from M5 on 2026-08-20 when distributables & install became the new [M5](M5-distributables-install.md); the publish-readiness deliverable and its two acceptance bullets moved there.

Prerequisite: M0–M5 complete. M6 adds no product features – it hardens and proves.

## New dependencies (only these)

None.

## Deliverables

**Dogfood (the acceptance test):**
- Run fragmt on this repo's own `docs/` daily – including editing these milestone docs in the tool (eat your own dogfood).
- Keep `docs/dogfood.md`: dated entries for what bit and the fix. Close an entry when its fix ships.

**README quickstart (`README.md`):**
- One paragraph: what fragmt is, with the "this is not Notion" one-liner and a link to `docs/REQUIREMENTS.md` for positioning.
- Install + first run for the installed path lands in M5; this pass keeps the from-source dev loop current: `npm run dev:server` + `npm run dev:ui`.
- Link to `docs/ARCHITECTURE.md` for the design.

**Hardening pass (triaged from the dogfood log, not speculative):**
- Fix the real papercuts dogfooding surfaces. Each fix is an ordinary commit; log it in `docs/dogfood.md`.
- Accessibility re-audit against DESIGN §9 (contrast ≥ 4.5:1 in BOTH themes, visible focus rings, semantic landmarks, ≥ 32px hit targets) across every M1–M4 surface.
- **Windows path/line-ending check** (the PLAN.md Risk – the author dogfoods on Windows day one): verify create/move/delete + sync over paths with spaces and backslashes, and confirm LF-on-write regardless of platform.

## Acceptance (v1 is done when ALL hold)

1. The author has updated `docs/` via fragmt (not a text editor) for a run of consecutive working days, with `docs/dogfood.md` to show for it.
2. `npm ci && npm run typecheck && npm run lint && npx biome ci . && npm test` green; CI green on `main`.
3. Every milestone's acceptance (M0–M5) re-verified green.

## Guardrails for implementers

- M6 adds **no** product features. Dogfooding that reveals a missing feature puts it on the v1.x/roadmap list – it does not expand v1 scope.
- Do not change the storage format, the API boundary, or the `commitAs` seam in M6; M0–M4 lock those.
- README updates only; the milestone set is already complete (M0–M4 + M5 + this one).
