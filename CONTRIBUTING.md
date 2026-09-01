# Contributing

Thanks for looking. The project is early and milestone-shaped – read
[docs/PLAN.md](docs/PLAN.md) first, then the spec for the milestone you're
touching under [docs/milestones/](docs/milestones/). Those specs are
implementation-exact on purpose; if the code and the spec disagree, that's a bug
in one of them, so say which.

**Open an issue before a large PR.** Scope is deliberately tight – see the "Cut
from v1" table in the plan before proposing a feature. Small fixes, tests, and
spec corrections need no ceremony.

## Setup

Node 22+.

```sh
npm ci
```

## Dev loop

Two terminals – the API server and the Vite dev server, which proxies `/api` to
port 4400:

```sh
npm run dev:server   # API on :4400
npm run dev:ui       # UI on :5173
```

`dev:server` deliberately does **not** watch: the server runs inside the very
repo it manages, so any branch switch or merge checkout changes the files
under `src/` – a watching restart would kill in-flight requests mid-op (the
UI merge button died exactly this way during dogfooding: "Failed to fetch"
with the merge actually completed). Restart it manually after editing server
code, or use `npm run dev:server:watch` when developing `src/` and not
dogfooding branch operations.

Run the CLI directly with `npx tsx src/cli/index.ts <command>`.

## Before you push

CI runs exactly these:

```sh
npm run typecheck
npx biome ci .
npm test
```

`npm run format` applies Biome's formatting. Tabs, double quotes, LF endings –
all enforced by Biome, none of it worth arguing about.

On Windows: the repo pins LF via `.gitattributes`. If `biome ci` reports every
file as needing formatting, your clone predates that file – `git rm --cached -r
. && git reset --hard` will re-check-out with the right endings.

## Layout

```
src/core/     filesystem, config, git – no HTTP, no process I/O
src/server/   Hono routes: parse request → call core → serialize
src/cli/      argv parsing and process exit codes
ui/           React + Vite; talks to the server only over /api
tests/        Vitest, against real temp dirs (no fs mocks)
docs/         requirements, architecture, design, milestone specs
spikes/       throwaway experiments; excluded from lint and typecheck
```

The layering is the point: the UI never touches the filesystem, and `core`
never knows about HTTP. Keep new code on the right side of those lines.

## Tests

Vitest, `npm test`. Tests use real temporary directories rather than mocked
filesystems – a test that passes against a mock and fails against a disk is
worth nothing here, especially given the Windows path and line-ending risks this
project carries.

Non-trivial logic ships with a test. Anything touching the doc-path trust
boundary (`resolveDocPath`) ships with a test for the rejection case too.

## Commits

One logical change per commit. Prefix with the milestone or area when it
applies:

```
M2: round-trip editing – Tiptap wired up, frontmatter strip/reattach
docs: correct the M3 branch-switch spec
fix: reject encoded traversal in the doc-path guard
```

## Releases & versioning

- **Semver, milestone = minor** while in 0.x: M5 ships as v0.5.0, 1.0.0
  lands when M6 closes v1. Minors may break during 0.x – that's what 0.x
  means here.
- **The ritual is one command.** On merged main:
  `npm version <v> -m "<milestone>: <title>"` (creates the bump commit and
  the tag), then `git push origin <tag>`. The
  [release workflow](.github/workflows/release.yml) runs the full CI gate,
  builds, publishes to npm with provenance, and cuts the GitHub Release with
  auto-generated notes – paste the milestone's "Shipped" entry from
  [docs/PLAN.md](docs/PLAN.md) into the release body when a summary matters.
- **NPM_TOKEN and 2FA.** npm's security model requires **2FA or a granular
  token with the "Bypass two-factor authentication" checkbox enabled** for
  publishing – the checkbox is unchecked by default when minting a token,
  and an account set to "Authorization only" does not lift the requirement.
  The `NPM_TOKEN` secret must hold a token minted with that checkbox
  checked; it then bypasses 2FA for package publishing regardless of account
  settings, and expires after at most 90 days. Troubleshooting a failed
  release: **EOTP** = the token lacks the bypass (mint a new granular token
  with it checked); **401** = the token expired or was revoked (mint a new
  one). Either way, update the secret and re-run the failed workflow. Note:
  npm removes direct publishing with bypass tokens in January 2027 – the
  repo migrates to trusted publishing (OIDC) before then; see the
  [backlog](docs/BACKLOG.md).
- **SAST.** CodeQL runs via Default setup (Settings → Advanced Security) –
  every PR and main push is scanned; there is no workflow YAML to maintain.

## License

Contributions are accepted under the MIT license – see [LICENSE](LICENSE).
