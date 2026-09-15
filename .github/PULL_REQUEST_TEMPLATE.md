## What & why

What this changes and the reason for it. If there's an issue, "Closes #N" links it.

If the change touches behavior users or agents can see, one line on what changes for them.

## Verification

- [ ] `npx vitest run` green (add tests for new logic — the suite is the contract)
- [ ] `npx biome ci .` clean
- [ ] Docs updated if this changes behavior: README / docs/HOSTING.md / docs/BACKLOG.md (docs ride this PR — never commit them to main directly)

## Notes for the reviewer

Where to start reading, the risky seam, anything deliberately skipped.
