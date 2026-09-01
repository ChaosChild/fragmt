import { existsSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { writeAgentsBlock } from "./agents.js";
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
 * adopted markdown files. Pure – no process I/O; the CLI owns that.
 */
export function initRepo(repoRoot: string, docsRoot: string): InitResult {
	if (existsSync(configPath(repoRoot))) {
		// A re-run refreshes the managed AGENTS.md block (b5) to the current copy.
		writeAgentsBlock(repoRoot);
		return { alreadyInitialized: true };
	}

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
	// Count before the AGENTS.md write – the block is tool-owned, not an
	// adopted doc (docsRoot "." would otherwise count it).
	const count = countDocs(listTree(repoRoot, docsRoot));
	writeAgentsBlock(repoRoot);
	return {
		alreadyInitialized: false,
		count,
	};
}
