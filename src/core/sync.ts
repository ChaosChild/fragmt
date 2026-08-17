import { GitError, git } from "./git.js";

export type SyncResult = { conflict: boolean; message?: string };

/** Local-only repo (no remotes) — sync is a no-op success. */
async function hasRemote(repoRoot: string): Promise<boolean> {
	return (await git(repoRoot, ["remote"])) !== "";
}

/**
 * `git pull --rebase`. A repo with no remote, or a branch with no upstream
 * tracking, is a no-op success — many dogfood repos are local-only. On a
 * rebase conflict the rebase is aborted (HEAD and working tree back to the
 * pre-pull state) and `{conflict: true}` is returned; any other failure
 * rethrows as GitError. Never force-pushes, never leaves a rebase in progress.
 */
export async function pullRebase(repoRoot: string): Promise<SyncResult> {
	if (!(await hasRemote(repoRoot))) return { conflict: false };
	try {
		await git(repoRoot, ["pull", "--rebase"]);
		return { conflict: false };
	} catch (e) {
		if (!(e instanceof GitError)) throw e;
		// git prints "There is no tracking information..." (exit 1) when the
		// branch tracks nothing; CONFLICT lines land on stdout, not stderr.
		const output = `${e.stdout}\n${e.stderr}`;
		if (/no tracking information/i.test(output)) return { conflict: false };
		if (/CONFLICT/i.test(output)) {
			await git(repoRoot, ["rebase", "--abort"]);
			const line = output.split("\n").find((l) => l.includes("CONFLICT"));
			return { conflict: true, message: line?.trim() };
		}
		throw e;
	}
}

/** `git push` — never force. No remote or no upstream tracking: no-op. */
export async function push(repoRoot: string): Promise<void> {
	if (!(await hasRemote(repoRoot))) return;
	try {
		await git(repoRoot, ["push"]);
	} catch (e) {
		if (
			e instanceof GitError &&
			/no upstream branch/i.test(e.stderr) // "fatal: The current branch …"
		)
			return;
		throw e;
	}
}

/**
 * One function, three triggers (ARCHITECTURE §4): pullRebase then push. Saves
 * already commit in M2, so the working tree is clean between user actions and
 * sync never races an uncommitted buffer. A conflict skips the push.
 */
export async function sync(repoRoot: string): Promise<SyncResult> {
	const pulled = await pullRebase(repoRoot);
	if (pulled.conflict) return pulled;
	await push(repoRoot);
	return pulled;
}
