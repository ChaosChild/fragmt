import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export interface Config {
	docsRoot: string;
}

/** Repo-level config file (always at the git repo root). */
const CONFIG_FILE = ".fragmt.json";

export class ConfigError extends Error {}

/** Absolute path to the repo's `.fragmt.json`. Used by load/write/init. */
export function configPath(repoRoot: string): string {
	return join(repoRoot, CONFIG_FILE);
}

/** Walk up from `from` to the nearest directory containing `.git`. */
export function findRepoRoot(from: string): string {
	let dir = resolve(from);
	while (true) {
		if (existsSync(join(dir, ".git"))) return dir;
		const parent = dirname(dir);
		if (parent === dir) {
			throw new ConfigError("not inside a git repository");
		}
		dir = parent;
	}
}

/** Parse `.fragmt.json`. Fails loudly (with the file path) — no silent defaults. */
export function loadConfig(repoRoot: string): Config {
	const file = configPath(repoRoot);
	if (!existsSync(file)) {
		throw new ConfigError("not initialized — run fragmt init");
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(file, "utf8"));
	} catch (e) {
		throw new ConfigError(`failed to parse ${file}: ${(e as Error).message}`);
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new ConfigError(`${file}: expected a JSON object`);
	}
	const docsRoot = (parsed as Record<string, unknown>).docsRoot;
	if (typeof docsRoot !== "string") {
		throw new ConfigError(`${file}: missing or invalid "docsRoot"`);
	}
	return { docsRoot };
}

/** Write a fresh config. `order` is reserved, always `{}` in v1. */
export function writeConfig(repoRoot: string, docsRoot: string): void {
	const body = `${JSON.stringify({ docsRoot, order: {} }, null, "\t")}\n`;
	writeFileSync(configPath(repoRoot), body);
}
