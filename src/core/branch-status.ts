import { badBranchName, GitError, git } from "./git.js";

/** One branch's standing against main – the branch menu's line (ui v1). */
export interface BranchStatus {
	name: string;
	/** Commits on the branch that main doesn't have. */
	ahead: number;
	/** Commits on main that the branch doesn't have. */
	behind: number;
	/** A merge into main would conflict; null = unknown (git < 2.38, or
	 *  merge-tree failed for another reason). */
	conflicts: boolean | null;
	/** ISO committer date of the branch tip. */
	lastCommitAt: string;
}

export class InvalidBranchNameError extends Error {
	constructor(name: string) {
		super(`invalid branch name: ${JSON.stringify(name)}`);
		this.name = "InvalidBranchNameError";
	}
}

/** `merge-tree --write-tree` (a merge without touching the worktree or
 *  index) arrived in git 2.38 – probed once per process. */
let mergeTreeProbe: Promise<boolean> | null = null;
function hasMergeTree(repoRoot: string): Promise<boolean> {
	mergeTreeProbe ??= git(repoRoot, ["--version"]).then(
		(out) => {
			const m = /(\d+)\.(\d+)/.exec(out);
			return m !== null && (+m[1] > 2 || (+m[1] === 2 && +m[2] >= 38));
		},
		() => false,
	);
	return mergeTreeProbe;
}

/**
 * Ahead/behind, conflict-with-main and tip date for `branch` (ui v1,
 * phase 7). Read-only: rev-list and merge-tree never touch the working
 * tree, the index or any ref. Both names are validated before the first
 * spawn and passed after --end-of-options.
 */
export async function branchStatus(
	repoRoot: string,
	main: string,
	branch: string,
): Promise<BranchStatus> {
	for (const name of [main, branch])
		if (badBranchName(name)) throw new InvalidBranchNameError(name);

	const counts = await git(repoRoot, [
		"rev-list",
		"--left-right",
		"--count",
		"--end-of-options",
		`${main}...${branch}`,
	]);
	const [behind, ahead] = counts.split(/\s+/).map(Number);

	let conflicts: boolean | null = null;
	if (await hasMergeTree(repoRoot)) {
		try {
			await git(repoRoot, [
				"merge-tree",
				"--write-tree",
				"--name-only",
				"--end-of-options",
				main,
				branch,
			]);
			conflicts = false;
		} catch (e) {
			// Exit 1 is merge-tree's "conflicted"; anything else is unknown.
			conflicts = e instanceof GitError && e.exitCode === 1 ? true : null;
		}
	}

	const lastCommitAt = await git(repoRoot, [
		"log",
		"-1",
		"--format=%cI",
		"--end-of-options",
		branch,
	]);
	return { name: branch, ahead, behind, conflicts, lastCommitAt };
}
