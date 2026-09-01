import { GitError, git } from "./git.js";

/** Repo-local git identity is missing – the server maps this to 409. */
export class GitIdentityError extends Error {}

/**
 * `git config user.name` / `user.email`. Throws GitIdentityError when either
 * is unset anywhere git looks (repo, global, system) – committing with a
 * fabricated author is worse than refusing to save.
 */
export async function localUser(
	repoRoot: string,
): Promise<{ name: string; email: string }> {
	let name = "";
	let email = "";
	try {
		[name, email] = await Promise.all([
			git(repoRoot, ["config", "user.name"]),
			git(repoRoot, ["config", "user.email"]),
		]);
	} catch (e) {
		if (e instanceof GitError) throw new GitIdentityError(e.message);
		throw e;
	}
	if (!name || !email) {
		throw new GitIdentityError("git identity not configured");
	}
	return { name, email };
}
