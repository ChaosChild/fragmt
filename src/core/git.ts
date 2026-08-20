import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Typed git failure — carries the exit code and both streams for diagnosis. */
export class GitError extends Error {
	constructor(
		message: string,
		readonly exitCode: number,
		readonly stderr: string,
		readonly stdout = "",
	) {
		super(message);
		this.name = "GitError";
	}
}

/**
 * The whole git layer: `execFile("git", args, { cwd })`, no shell, ever.
 * Resolves trimmed stdout; rejects with GitError on non-zero exit.
 */
export async function git(repoRoot: string, args: string[]): Promise<string> {
	try {
		const { stdout } = await execFileAsync("git", args, { cwd: repoRoot });
		return stdout.trim();
	} catch (e) {
		const err = e as {
			code?: number;
			stdout?: string;
			stderr?: string;
			message?: string;
		};
		throw new GitError(
			`git ${args.join(" ")} failed: ${err.stderr?.trim() || err.message}`,
			typeof err.code === "number" ? err.code : 1,
			err.stderr ?? "",
			err.stdout ?? "",
		);
	}
}

/** Name of the checked-out branch ("main"; "HEAD" when detached). */
export async function currentBranch(repoRoot: string): Promise<string> {
	return git(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
}

/** All local branch names (empty before the first commit). */
export async function listBranches(repoRoot: string): Promise<string[]> {
	const out = await git(repoRoot, [
		"for-each-ref",
		"refs/heads",
		"--format=%(refname:short)",
	]);
	return out ? out.split("\n") : [];
}

/** Create a branch at HEAD without switching to it. */
export async function createBranch(
	repoRoot: string,
	name: string,
): Promise<void> {
	await git(repoRoot, ["branch", name]);
}

/** Switch the working tree to an existing branch. */
export async function checkoutBranch(
	repoRoot: string,
	name: string,
): Promise<void> {
	await git(repoRoot, ["checkout", name]);
}

/** `git log` with caller-owned format/filters — raw trimmed stdout. */
export async function logCommits(
	repoRoot: string,
	args: string[],
): Promise<string> {
	return git(repoRoot, ["log", ...args]);
}

/** `git show <ref>` — file content by ref. */
export async function showRef(repoRoot: string, ref: string): Promise<string> {
	return git(repoRoot, ["show", ref]);
}

/** Merge a branch into the current one; --no-edit keeps the default message. */
export async function mergeBranch(
	repoRoot: string,
	name: string,
): Promise<void> {
	await git(repoRoot, ["merge", name, "--no-edit"]);
}

/** Delete a local branch; force skips the merged check (`-D`). */
export async function deleteBranch(
	repoRoot: string,
	name: string,
	force = false,
): Promise<void> {
	await git(repoRoot, ["branch", force ? "-D" : "-d", name]);
}
