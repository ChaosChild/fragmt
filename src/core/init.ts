import { existsSync, mkdirSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { writeAgentsBlock } from "./agents.js";
import { commitAs } from "./commit.js";
import { ConfigError, configPath, writeConfig } from "./config.js";
import { git } from "./git.js";
import { countDocs, listTree } from "./tree.js";

export interface InitResult {
	alreadyInitialized: boolean;
	/** Present only when init actually wrote the config. */
	count?: number;
}

/**
 * Adopt a docs root: refuse to overwrite an existing config, otherwise validate
 * the root is a directory inside the repo, write `.fragmt.json`, and count the
 * adopted markdown files. Pure – no process I/O; the CLI owns that. `okf`
 * only shapes the fresh config file (the existing-repo flip is enableOkf).
 */
export function initRepo(
	repoRoot: string,
	docsRoot: string,
	okf = false,
): InitResult {
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

	writeConfig(repoRoot, docsRoot, okf);
	// Count before the AGENTS.md write – the block is tool-owned, not an
	// adopted doc (docsRoot "." would otherwise count it).
	const count = countDocs(listTree(repoRoot, docsRoot));
	writeAgentsBlock(repoRoot);
	return {
		alreadyInitialized: false,
		count,
	};
}

/**
 * The #48 plain-init commit: the fragmt-owned files only (.fragmt.json +
 * AGENTS.md, both always at the repo root), never unrelated worktree content
 * – no add -A. The fixed fragmt identity rides commitAs's --author flag +
 * committer env, so the commit resolves with no git config anywhere (the
 * b62b060 CI lesson initNestedRepo's -c flags encode). .fragmt.json is brand
 * new on this path, so the commit is never empty; on an existing repo it
 * joins the branch, on an unborn one it is the initial commit. Resolves the
 * new sha.
 */
export async function commitInitFiles(repoRoot: string): Promise<string> {
	return commitAs(
		{ name: "fragmt", email: "fragmt@localhost" },
		{
			files: [".fragmt.json", "AGENTS.md"],
			message: "Adopt docs into fragmt repo",
		},
		repoRoot,
	);
}

/**
 * The #16 create path: turn `folder` inside the outer repo into its own
 * nested fragmt repo – `git init -b main` at the folder (markdown already
 * there is adopted), `.fragmt.json` with docsRoot "." (okf: true in OKF
 * bundles), the standard AGENTS block, then one identity-proof commit of
 * everything. The outer repo's AGENTS.md redirect is the CLI's call
 * (writeOuterAgentsBlock). Unlike initRepo this spawns git, so it is async.
 */
export async function initNestedRepo(
	outerRoot: string,
	folder: string,
	okf = false,
): Promise<{ count: number }> {
	const nestedRoot = resolve(outerRoot, folder);
	const rel = relative(outerRoot, nestedRoot);
	if (
		isAbsolute(folder) ||
		rel === "" || // the outer root itself – nothing to nest
		rel.split(sep)[0] === ".." ||
		isAbsolute(rel) ||
		(existsSync(nestedRoot) && !statSync(nestedRoot).isDirectory())
	) {
		throw new ConfigError(
			`docs folder "${folder}" is not a folder inside the repo`,
		);
	}

	mkdirSync(nestedRoot, { recursive: true });
	await git(nestedRoot, ["init", "-q", "-b", "main"]);
	writeConfig(nestedRoot, ".", okf);
	// Count before the AGENTS.md write – the block is tool-owned, not an
	// adopted doc (same rule as initRepo; docsRoot "." would count it).
	const count = countDocs(listTree(nestedRoot, "."));
	writeAgentsBlock(nestedRoot);
	// add -A always stages ≥ .fragmt.json + AGENTS.md → the commit can't be
	// empty, no skip check needed.
	await git(nestedRoot, ["add", "-A"]);
	await git(nestedRoot, [
		"-c",
		"user.name=fragmt",
		"-c",
		"user.email=fragmt@localhost",
		"commit",
		"-q",
		"-m",
		"Adopt docs into nested fragmt repo",
	]);
	return { count };
}
