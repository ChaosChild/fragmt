import { GitError, git } from "./git.js";

export type SyncResult = { conflict: boolean; message?: string };

/** Local-only repo (no remotes) – sync is a no-op success. */
async function hasRemote(repoRoot: string): Promise<boolean> {
	return (await git(repoRoot, ["remote"])) !== "";
}

/**
 * `git pull --rebase`. A repo with no remote, or a branch with no upstream
 * tracking, is a no-op success – many dogfood repos are local-only. On a
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

/**
 * #27: push refs to an explicit URL with the signed-in user's token as a
 * per-invocation http extraheader (the git-credential-manager pattern)
 * through GIT_CONFIG env – never argv, never disk, never repo config. The
 * explicit HTTPS URL means it works even when origin is ssh (fetch keeps
 * riding origin). Requires git >= 2.31 (env config). Never force-pushes; a
 * non-fast-forward refusal surfaces as-is, scrubbed of the credential.
 */
export async function pushRefs(
	repoRoot: string,
	url: string,
	refspecs: string[],
	token: string,
): Promise<void> {
	const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
	try {
		await git(repoRoot, ["push", url, ...refspecs], {
			env: {
				GIT_CONFIG_COUNT: "1",
				GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
				GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
			},
		});
	} catch (e) {
		if (e instanceof GitError) throw scrubSecret(e, basic);
		throw e;
	}
}

/** The HTTPS push URL for a github.com slug – per-user pushes never use origin's URL. */
export function githubPushUrl(slug: { owner: string; repo: string }): string {
	return `https://github.com/${slug.owner}/${slug.repo}.git`;
}

/** #27: push ONE branch as the signed-in user – the PR-create path. */
export async function pushAs(
	repoRoot: string,
	slug: { owner: string; repo: string },
	branch: string,
	token: string,
): Promise<void> {
	await pushRefs(
		repoRoot,
		githubPushUrl(slug),
		[`${branch}:refs/heads/${branch}`],
		token,
	);
}

/**
 * #27 (review round): sync pulls the current branch, then MIRRORS – every
 * local branch to origin, never force – so no work lives only on the local
 * disk (the old push was current-branch-only and a no-upstream draft was a
 * silent no-op). `as` (serve --auth) rides the signed-in user's token over
 * the explicit HTTPS URL; without it the machine's own credentials push to
 * origin as before. Local-only repo: no-op success.
 */
export async function sync(
	repoRoot: string,
	as?: { slug: { owner: string; repo: string }; token: string },
): Promise<SyncResult> {
	const pulled = await pullRebase(repoRoot);
	if (pulled.conflict) return pulled;
	if (!(await hasRemote(repoRoot))) return pulled;
	if (as) await pushRefs(repoRoot, githubPushUrl(as.slug), ["--all"], as.token);
	else await git(repoRoot, ["push", "--all"]);
	return pulled;
}

/** The extraheader value is a credential – it must never survive an error. */
export function scrubSecret(e: GitError, secret: string): GitError {
	const clean = (s: string) =>
		secret ? s.split(secret).join("<redacted>") : s;
	return new GitError(
		clean(e.message),
		e.exitCode,
		clean(e.stderr),
		clean(e.stdout),
	);
}
