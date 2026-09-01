# M0 – Environment prep

**Goal:** a repo where `npm run typecheck`, `npm run lint`, and `npm test` pass locally and in CI, with the dev loop (tsx + Vitest + Biome) working. No product code yet.

**The package root is this repo's root.** `fragmt` is developed in this repo; its own `docs/` folder is the dogfood content. `spikes/roundtrip/` keeps its independent `package.json` – don't touch it.

## Layout to create

```
/ (repo root)
├── package.json          # name "fragmt", the only package
├── package-lock.json     # committed
├── tsconfig.json         # dev/typecheck (noEmit)
├── tsconfig.build.json   # emit to dist/ (node code only; ui builds itself in M1)
├── biome.json
├── .github/workflows/ci.yml
├── src/
│   ├── core/index.ts     # placeholder export – repo ops, docs, git, config live here later
│   ├── cli/index.ts      # entry point; parses commands (stub)
│   └── server/index.ts   # placeholder export – Hono app lives here later
├── tests/
│   └── smoke.test.ts     # proves the runner; replaced by real tests from M1 on
└── ui/                   # empty until M1; omit entirely rather than committing a .gitkeep
```

`docs/`, `spikes/`, `LICENSE`, `README.md` already exist – leave them alone.

## package.json (exact requirements)

- `"name": "fragmt"`, `"version": "0.0.0"`, `"license": "MIT"`, `"type": "module"`
- `"engines": { "node": ">=22" }`
- `"bin": { "fragmt": "./dist/cli/index.js" }` (points at build output; publish concerns are M5's problem)
- Scripts – exactly these, no extras:
  - `"dev": "tsx watch src/cli/index.ts serve"` (will error until M1 implements `serve`; fine)
  - `"typecheck": "tsc --noEmit"`
  - `"lint": "biome check ."`
  - `"format": "biome format --write ."`
  - `"test": "vitest run"`
  - `"build": "tsc -p tsconfig.build.json"`
- devDependencies (latest stable at install time): `typescript` ^5, `tsx`, `vitest`, `@biomejs/biome`, `@types/node`
- **No runtime dependencies in M0.** Hono, React, gray-matter etc. land in the milestone that uses them.

## CLI stub (src/cli/index.ts)

Use **`node:util` `parseArgs`** – no commander/yargs, ever, for this CLI. Structure:

- Export the usage string (so the smoke test can import it).
- First positional = command. Recognized: `init`, `serve` – both print `"<command>: not implemented yet"` and exit 1 for now.
- No command / `--help`: print usage (`fragmt init [--root <path>]`, `fragmt serve [--port <n>]`) and exit 0.
- Unknown command: print usage to stderr, exit 1.

## tsconfig.json (key compiler options)

`"strict": true`, `"module": "nodenext"`, `"moduleResolution": "nodenext"`, `"target": "es2022"`, `"noEmit": true`, `"skipLibCheck": true`; include `src` and `tests`; exclude `ui`, `spikes`, `dist`. `tsconfig.build.json` extends it: `"noEmit": false`, `"outDir": "dist"`, include only `src`.

## biome.json

- `"vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true }` so gitignored paths (`.lavish/`, `node_modules/`, `dist/`) are skipped automatically.
- Additionally exclude `spikes/**` (committed but not ours to reformat) and `docs/**` (markdown, hand-formatted).
- Default recommended rules; default formatter settings. Do not hand-tune rules in M0.

## CI (.github/workflows/ci.yml)

Single job on `push` to `main` and `pull_request`:
ubuntu-latest → checkout → setup-node (node 22, cache npm) → `npm ci` → `npm run typecheck` → `npx biome ci .` → `npm test`. Nothing else – no matrix, no release steps.

## Smoke test (tests/smoke.test.ts)

One test that imports the usage string from `src/cli/index.ts` and asserts it mentions both `init` and `serve`. Not `expect(true)` – the test must fail if the CLI entry breaks.

## Other

- Append `dist/` to the root `.gitignore`.
- Commit `package-lock.json`.

## Acceptance (all must pass before M0 is done)

1. `npm ci && npm run typecheck && npm run lint && npm test` – all green locally.
2. `npx tsx src/cli/index.ts` prints usage, exit 0; `npx tsx src/cli/index.ts bogus` exits 1.
3. CI workflow green on the M0 commit.
4. `git status` clean – no untracked build artifacts.

## Guardrails for implementers

- Do not add any dependency not listed above. If something seems missing, stop and ask – don't substitute.
- Do not scaffold the UI, the server, routes, or config handling – that's M1 (see M1-read-only.md).
- Do not restructure existing folders (`docs/`, `spikes/`).
