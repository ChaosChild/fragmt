import { existsSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { ConfigError, configPath, writeConfig } from "./config.js";
import { countDocs, listTree } from "./tree.js";

export interface InitResult {
	alreadyInitialized: boolean;
	/** Present only when init actually wrote the config. */
	count?: number;
}

/**
 * Adopt a docs root: refuse to overwrite an existing config, otherwise validate
 * the root is a directory inside the repo, write `.fragmt.json`, and count the
 * adopted markdown files. Pure — no process I/O; the CLI owns that.
 */
export function initRepo(repoRoot: string, docsRoot: string): InitResult {
	if (existsSync(configPath(repoRoot))) return { alreadyInitialized: true };

	const docsAbs = resolve(repoRoot, docsRoot);
	// docsRoot may be the repo root itself ("." → rel ""); only an upward escape
	// or an absolute path is invalid.
	const rel = relative(repoRoot, docsAbs);
	const escaped = rel.split(sep)[0] === ".." || isAbsolute(rel);
	if (!existsSync(docsAbs) || !statSync(docsAbs).isDirectory() || escaped) {
		throw new ConfigError(
			`docs root "${docsRoot}" is not a directory inside the repo`,
		);
	}

	writeConfig(repoRoot, docsRoot);
	return {
		alreadyInitialized: false,
		count: countDocs(listTree(repoRoot, docsRoot)),
	};
}
