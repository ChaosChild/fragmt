import {
	branchRemote,
	currentBranch,
	GitError,
	type GithubSlug,
	git,
	listBranches,
} from "./git.js";
import { mainBranch } from "./meta.js";

export type SyncResult = {
	conflict: boolean;
	message?: string;
	/** Set when a non-current main was strictly behind origin and was
	 *  fast-forwarded before the push – "synced behind remote" as data,
	 *  never an error. A rebase integration (local commits replayed) is not
	 *  an ff and stays unreported. */
	ff?: { branch: string; commits: number };
};

/** A push that stayed non-fast-forward after integration – the server maps
 *  it to 409; the UI lands the message in the sync-error LED detail. */
export class SyncDivergedError extends Error {
	constructor(
		readonly branches: string[],
		message: string,
	) {
		super(message);
		this.name = "SyncDivergedError";
	}
}

/** The signed-in user's push identity for the explicit-URL token pushes. */
export interface PushAs {
	slug: GithubSlug;
	token: string;
}

/** Local-only repo (no remotes) – sync is a no-op success. */
async function hasRemote(repoRoot: string): Promise<boolean> {
	return (await git(repoRoot, ["remote"])) !== "";
}

/** origin when it exists, else the first remote – null when there is none. */
async function defaultRemote(repoRoot: string): Promise<string | null> {
	const remotes = (await git(repoRoot, ["remote"])).split("\n").filter(Boolean);
	if (remotes.length === 0) return null;
	return remotes.includes("origin") ? "origin" : remotes[0];
}

/**
 * `git pull --rebase=merges`. A repo with no remote, or a branch with no upstream
 * tracking, is a no-op success – many dogfood repos are local-only. The
 * explicit form (remote + ref) integrates a branch whose tracking config is
 * missing – #54: a checkout's main without `branch.main.*` config never
 * pulled, so a stale main was pushed as-is. On a rebase conflict the rebase
 * is aborted (HEAD and working tree back to the pre-pull state) and
 * `{conflict: true}` is returned; any other failure rethrows as GitError.
 * Never force-pushes, never leaves a rebase in progress.
 */
export async function pullRebase(
	repoRoot: string,
	explicit?: { remote: string; ref: string },
): Promise<SyncResult> {
	if (!(await hasRemote(repoRoot))) return { conflict: false };
	try {
		// =merges: a local merge commit not yet pushed (the in-app merge, before
		// the next sync's push) stays a merge. Plain --rebase flattens it and
		// replays the draft's commits onto main – a conflict the merge already
		// resolved, so the merge would never reach origin.
		await git(repoRoot, [
			"pull",
			"--rebase=merges",
			...(explicit ? [explicit.remote, explicit.ref] : []),
		]);
		return { conflict: false };
	} catch (e) {
		if (!(e instanceof GitError)) throw e;
		// git prints "There is no tracking information..." (exit 1) when the
		// branch tracks nothing; CONFLICT lines land on stdout, not stderr.
		// The explicit form fails "couldn't find remote ref" against a
		// never-pushed origin – nothing to integrate, still a no-op.
		const output = `${e.stdout}\n${e.stderr}`;
		if (/no tracking information|couldn't find remote ref/i.test(output))
			return { conflict: false };
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

/** #27: fetch a ref from the explicit HTTPS URL with the user's token (used
 *  to fast-forward local main after a fragmt-side PR merge). Refuses
 *  harmlessly when main is checked out or not fast-forwardable – git's own
 *  refusal surfaces, scrubbed. */
export async function fetchRefs(
	repoRoot: string,
	url: string,
	refspec: string,
	token: string,
): Promise<void> {
	const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
	try {
		await git(repoRoot, ["fetch", url, refspec], {
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

/**
 * #54: fast-forward a non-checked-out main to origin's tip with
 * `git fetch <remote> <main>:<main>` – fetch's own fast-forward-only
 * semantics do the guarding. Returns the commits gained, or null when main
 * diverged (local commits origin lacks), origin has no such branch yet, or
 * nothing moved. A diverged main is classified at push, not here.
 */
async function ffMain(
	repoRoot: string,
	remote: string,
	main: string,
): Promise<number | null> {
	const before = await git(repoRoot, ["rev-parse", "--verify", main]);
	try {
		await git(repoRoot, ["fetch", remote, `${main}:${main}`]);
	} catch (e) {
		if (
			e instanceof GitError &&
			/non-fast-forward|couldn't find remote ref|refusing to fetch into branch/i.test(
				`${e.stdout}\n${e.stderr}`,
			)
		)
			return null;
		throw e;
	}
	const after = await git(repoRoot, ["rev-parse", "--verify", main]);
	if (after === before) return null;
	return Number(
		await git(repoRoot, ["rev-list", "--count", `${before}..${after}`]),
	);
}

/**
 * #27 (review round): the mirror – every local branch to origin, never
 * force – so no work lives only on the local disk. #54: explicit refspecs
 * instead of --all, because a `drafts/*` branch fully contained in main is
 * a pointer with no work (the edit-entry dance creates one before the first
 * keystroke); mirroring it is what stranded the abandoned draft of #54 on
 * origin. `as` rides the signed-in user's token over the explicit HTTPS
 * URL; without it the machine's own credentials push. Empty refspec list
 * (nothing to push): no-op.
 */
async function mirror(
	repoRoot: string,
	as: PushAs | undefined,
	remote: string,
	main: string | null,
): Promise<void> {
	const specs: string[] = [];
	for (const name of await listBranches(repoRoot)) {
		if (
			main !== null &&
			name.startsWith("drafts/") &&
			(await git(repoRoot, ["rev-list", "--count", `${main}..${name}`])) === "0"
		)
			continue;
		specs.push(`${name}:refs/heads/${name}`);
	}
	if (specs.length === 0) return;
	if (as) await pushRefs(repoRoot, githubPushUrl(as.slug), specs, as.token);
	else await git(repoRoot, ["push", remote, ...specs]);
}

// A genuine staleness rejection, not every push failure: a hook decline
// ("[remote rejected] … (hook declined)") is not a divergence and keeps
// surfacing as a plain GitError.
const isRejection = (e: GitError): boolean =>
	/\(non-fast-forward\)|\(fetch first\)/.test(e.stderr);

const rejectedBranches = (e: GitError): string[] =>
	[...e.stderr.matchAll(/! \[rejected\]\s+(\S+)/g)].map((m) => m[1]);

function divergedError(branches: string[]): SyncDivergedError {
	const list = branches.join(", ");
	const message = branches.includes("main")
		? "main has diverged from origin – local commits origin does not have while origin moved on. Switch to main and sync to integrate (the rebase replays its commits), then sync again to push"
		: `push rejected: ${list} diverged from origin (both sides have unique commits) – integrate the branch with origin manually, then sync again`;
	return new SyncDivergedError(branches, message);
}

/**
 * Sync = integrate origin, then mirror. #54: both halves now share a scope.
 * The current branch integrates first (the rebase self-heal); a
 * tracking-less main integrates through the explicit pull, and a non-current
 * main is fast-forwarded to origin's tip before the mirror sees it. One
 * rejected push re-heals main and retries (a race with another writer
 * between fetch and push); a second rejection is a real divergence,
 * classified as SyncDivergedError – never force-pushed, never flattened.
 */
export async function sync(repoRoot: string, as?: PushAs): Promise<SyncResult> {
	const remote = await defaultRemote(repoRoot);
	if (remote === null) return { conflict: false };
	const main = await mainBranch(repoRoot);
	const current = await currentBranch(repoRoot);

	let pulled: SyncResult;
	if (main !== null && current === main) {
		const tracked =
			(await git(repoRoot, ["config", "--get", `branch.${main}.remote`]).catch(
				() => "",
			)) !== "";
		pulled = tracked
			? await pullRebase(repoRoot)
			: await pullRebase(repoRoot, { remote, ref: main });
	} else {
		pulled = await pullRebase(repoRoot);
	}
	if (pulled.conflict) return pulled;

	let ff: SyncResult["ff"];
	if (main !== null && current !== main) {
		const commits = await ffMain(repoRoot, remote, main);
		if (commits !== null) ff = { branch: main, commits };
	}

	try {
		await mirror(repoRoot, as, remote, main);
	} catch (e) {
		if (!(e instanceof GitError) || !isRejection(e)) throw e;
		if (main !== null && current !== main) await ffMain(repoRoot, remote, main);
		try {
			await mirror(repoRoot, as, remote, main);
		} catch (e2) {
			if (e2 instanceof GitError && isRejection(e2))
				throw divergedError(rejectedBranches(e2));
			throw e2;
		}
	}
	return { conflict: false, ...(ff ? { ff } : {}) };
}

/**
 * #54: remove a branch's origin copy – the mirror never deletes, so a
 * locally deleted branch would otherwise live on remotely forever. Under
 * auth the explicit-URL token push; locally the machine's credentials, to
 * the branch's tracking remote when it has one, else the default remote.
 * Best-effort by contract: callers swallow failures (the local intent
 * already succeeded).
 */
export async function deleteRemoteBranch(
	repoRoot: string,
	name: string,
	as?: PushAs,
): Promise<void> {
	if (as) {
		await pushRefs(
			repoRoot,
			githubPushUrl(as.slug),
			[`:refs/heads/${name}`],
			as.token,
		);
		return;
	}
	const remote =
		(await branchRemote(repoRoot, name)) ?? (await defaultRemote(repoRoot));
	if (remote === null) return;
	await git(repoRoot, ["push", remote, "--delete", name]);
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
