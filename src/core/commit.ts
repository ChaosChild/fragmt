import { git } from "./git.js";

/**
 * THE mutation seam (ARCHITECTURE §5). Every write in fragmt ends here —
 * v1 commits as the local git identity; v2 will pass the authenticated user.
 *
 * `files` are repo-root-relative POSIX paths, staged and committed together.
 * Resolves the new commit sha. An identical-content save is not an error:
 * git refuses to commit an empty change, so detect the staged no-op first
 * and return current HEAD instead.
 */
export async function commitAs(
	user: { name: string; email: string },
	change: { files: string[]; message: string },
	repoRoot: string,
): Promise<string> {
	const { files, message } = change;
	await git(repoRoot, ["add", "--", ...files]);

	// Exit 0 = nothing staged → content identical, save is a no-op.
	// Works on unborn HEAD too: diff-against-empty reports the new files.
	const dirty = await git(repoRoot, ["diff", "--cached", "--quiet"]).then(
		() => false,
		() => true,
	);
	if (!dirty) {
		return git(repoRoot, ["rev-parse", "HEAD"]);
	}

	await git(repoRoot, [
		"commit",
		`--author=${user.name} <${user.email}>`,
		"-m",
		message,
		"--",
		...files,
	]);
	return git(repoRoot, ["rev-parse", "HEAD"]);
}
