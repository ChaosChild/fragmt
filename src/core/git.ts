import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Typed git failure — carries the exit code and stderr for diagnosis. */
export class GitError extends Error {
	constructor(
		message: string,
		readonly exitCode: number,
		readonly stderr: string,
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
		const err = e as { code?: number; stderr?: string; message?: string };
		throw new GitError(
			`git ${args.join(" ")} failed: ${err.stderr?.trim() || err.message}`,
			typeof err.code === "number" ? err.code : 1,
			err.stderr ?? "",
		);
	}
}
