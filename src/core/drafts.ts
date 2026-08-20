import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { type CommentFile, sidecarPath } from "./comments.js";
import { commitAs } from "./commit.js";
import {
	type ConflictPart,
	mergeSidecars,
	parseConflicts,
	type SidecarMergeSummary,
} from "./conflict.js";
import { canonicalBody, resolveDocPath } from "./docs.js";
import { PathExistsError } from "./files.js";
import {
	checkoutBranch,
	createBranch,
	currentBranch,
	deleteBranch,
	GitError,
	git,
	listBranches,
	logCommits,
	mergeBranch,
	showRef,
} from "./git.js";
import { localUser } from "./identity.js";
import { mainBranch } from "./meta.js";

/**
 * Draft naming (M4-2 spec): `drafts/<slug>` where slug = basename minus .md,
 * lowercased, every non-[a-z0-9] char → "-", edges trimmed. Collisions with
 * existing branch names append -2, -3, …
 */
export function nextDraftName(existing: string[], docPath: string): string {
	const slug = (docPath.split("/").pop() ?? "")
		.replace(/\.md$/i, "")
		.toLowerCase()
		.replace(/[^a-z0-9]/g, "-")
		.replace(/^-+|-+$/g, "");
	if (!existing.includes(`drafts/${slug}`)) return `drafts/${slug}`;
	let n = 2;
	while (existing.includes(`drafts/${slug}-${n}`)) n++;
	return `drafts/${slug}-${n}`;
}

/** Merge asked for while on main (or with no main) — the server maps to 400. */
export class OnMainBranchError extends Error {}

/** concludeMerge with unmerged paths left — the server maps this to 409. */
export class MergeUnresolvedError extends Error {}

/** docsRoot-relative doc path → the repo-relative pathspec git wants. */
function pathspec(docsRoot: string, docPath: string): string {
	const prefix =
		docsRoot === "." ? "" : docsRoot.replace(/\\/g, "/").replace(/\/+$/, "");
	return prefix === "" ? docPath : `${prefix}/${docPath}`;
}

/** docsRoot as a repo-relative prefix ("" for "."), the shape classification
 *  compares git's repo-relative paths against (meta.ts toDocPath pattern). */
function docsPrefix(docsRoot: string): string {
	return docsRoot === "."
		? ""
		: docsRoot.replace(/\\/g, "/").replace(/\/+$/, "");
}

/**
 * Start (or join) the draft for a doc: already on a non-main branch → no-op;
 * an existing drafts/* branch whose <main>..<branch> diff touches the doc →
 * check it out; else create + check out drafts/<nextDraftName>.
 */
export async function startDraft(
	repoRoot: string,
	docPath: string,
	docsRoot = ".",
): Promise<{ current: string; reused: boolean }> {
	const main = await mainBranch(repoRoot);
	const current = await currentBranch(repoRoot);
	// Already drafting, or no draft model at all (null main) → nothing to do.
	if (!main || current !== main) return { current, reused: true };

	// ponytail: one git log spawn per drafts/* branch — same ceiling as
	// repoMeta's walk 2; batch if a repo ever carries hundreds of drafts.
	const branches = await listBranches(repoRoot);
	for (const branch of branches) {
		if (branch === main || !branch.startsWith("drafts/")) continue;
		const touched = await logCommits(repoRoot, [
			"--format=",
			"--name-only",
			`${main}..${branch}`,
			"--",
			pathspec(docsRoot, docPath),
		]);
		if (touched !== "") {
			await checkoutBranch(repoRoot, branch);
			return { current: branch, reused: true };
		}
	}
	const name = nextDraftName(branches, docPath);
	await createBranch(repoRoot, name);
	await checkoutBranch(repoRoot, name);
	return { current: name, reused: false };
}

/**
 * Merge the current draft into main (the sanctioned write). A conflict where
 * EVERY unmerged path is a docsRoot doc or a comment sidecar STANDS on main
 * for in-UI resolution (M4-4); anything else aborts the merge and switches
 * back — HEAD and the draft untouched, user not stranded. A clean merge
 * deletes the branch and returns the merged sha.
 */
export async function mergeToMain(
	repoRoot: string,
	docsRoot = ".",
): Promise<
	| { merged: true; sha: string }
	| {
			merged: false;
			conflict: true;
			stood: true;
			branch: string;
			files: string[];
	  }
	| {
			merged: false;
			conflict: true;
			stood: false;
			files: string[];
			message: string;
	  }
> {
	const main = await mainBranch(repoRoot);
	const current = await currentBranch(repoRoot);
	if (!main || current === main)
		throw new OnMainBranchError(`nothing to merge — on ${current}`);

	await checkoutBranch(repoRoot, main);
	try {
		await mergeBranch(repoRoot, current);
	} catch (e) {
		if (!(e instanceof GitError)) throw e;
		// git prints CONFLICT lines on stdout, not stderr (pullRebase pattern).
		const output = `${e.stdout}\n${e.stderr}`;
		if (!/CONFLICT/i.test(output)) throw e;
		const files = await unmergedPaths(repoRoot);
		const prefix = docsPrefix(docsRoot);
		if (files.every((p) => classifyPath(p, prefix) !== "other")) {
			// All conflicts are docs/sidecars — the merge stands on main and
			// resolves through mergeState/resolve*/conclude.
			return {
				merged: false,
				conflict: true,
				stood: true,
				branch: current,
				files,
			};
		}
		await git(repoRoot, ["merge", "--abort"]);
		await checkoutBranch(repoRoot, current);
		return {
			merged: false,
			conflict: true,
			stood: false,
			files,
			message:
				output
					.split("\n")
					.find((l) => l.includes("CONFLICT"))
					?.trim() || e.stderr.trim(),
		};
	}
	const sha = await git(repoRoot, ["rev-parse", "HEAD"]);
	await cleanupDraftBranch(repoRoot, current);
	return { merged: true, sha };
}

/** Post-merge branch cleanup: local delete + best-effort remote delete. */
async function cleanupDraftBranch(
	repoRoot: string,
	branch: string,
): Promise<void> {
	await deleteBranch(repoRoot, branch);
	// ponytail: best-effort remote delete — any failure ignored (the local merge
	// already succeeded; push failures surface on the next sync anyway).
	try {
		const remote = await git(repoRoot, [
			"config",
			"--get",
			`branch.${branch}.remote`,
		]);
		if (remote !== "")
			await git(repoRoot, ["push", remote, "--delete", branch]);
	} catch {
		// not tracking a remote, or the delete failed — fine either way
	}
}

/** A merge is standing on disk (MERGE_HEAD exists) — the b3/b4 write guard. */
export function inMerge(repoRoot: string): boolean {
	// ponytail: repoRoot is the .git parent (the worktree root every core fn
	// assumes); no `git rev-parse --git-dir` fallback for linked worktrees.
	return existsSync(join(repoRoot, ".git", "MERGE_HEAD"));
}

/**
 * The merged branch out of .git/MERGE_MSG's `Merge branch 'X'` line, or null
 * when MERGE_MSG is missing/foreign-shaped.
 */
// ponytail: MERGE_MSG is git's message template, not an API — a hand-written
// `git merge -m` message yields null and conclude/abort just skip the
// branch niceties; raise only if that ever bites.
function mergeBranchFromMsg(repoRoot: string): string | null {
	const msg = join(repoRoot, ".git", "MERGE_MSG");
	if (!existsSync(msg)) return null;
	const m = readFileSync(msg, "utf8").match(/^Merge branch '([^']+)'/);
	return m ? m[1] : null;
}

/** Currently-unmerged paths, repo-root-relative POSIX (one spawn per call).
 *  Exported for the b3 resolve route's membership check — the unmerged set is
 *  the containment guard (paths come from git, never the user). */
export async function unmergedPaths(repoRoot: string): Promise<string[]> {
	const out = await git(repoRoot, ["diff", "--name-only", "--diff-filter=U"]);
	return out ? out.split("\n") : [];
}

/** Repo-relative unmerged path → which resolution engine owns it. */
function classifyPath(
	repoRel: string,
	prefix: string,
): "doc" | "sidecar" | "other" {
	if (repoRel.toLowerCase().endsWith(".md"))
		return prefix === "" || repoRel.startsWith(`${prefix}/`) ? "doc" : "other";
	if (repoRel.startsWith(".docs/comments/") && repoRel.endsWith(".json"))
		return "sidecar";
	return "other";
}

/** A sidecar's merge stages: :2: ours (HEAD) and :3: theirs (the draft). */
async function sidecarStages(
	repoRoot: string,
	path: string,
): Promise<{ ours: CommentFile; theirs: CommentFile }> {
	// ponytail: a missing stage (delete/modify on the sidecar) reads as an
	// empty file — the union merge then keeps whatever the other side has.
	const stage = async (n: 2 | 3): Promise<CommentFile> => {
		try {
			return JSON.parse(
				await git(repoRoot, ["show", `:${n}:${path}`]),
			) as CommentFile;
		} catch (e) {
			if (e instanceof GitError) return { comments: {} };
			throw e; // a present-but-corrupt sidecar deserves the error
		}
	};
	return { ours: await stage(2), theirs: await stage(3) };
}

export type MergeFile =
	| { path: string; kind: "doc"; parts: ConflictPart[] }
	| { path: string; kind: "sidecar"; summary: SidecarMergeSummary }
	| { path: string; kind: "other" };

/**
 * The standing merge, recomputed per call (staged files drop out of the
 * unmerged set — and out of `remaining` — naturally). Paths are
 * repo-root-relative POSIX, the one path space git reports and resolve* takes.
 */
export async function mergeState(
	repoRoot: string,
	docsRoot = ".",
): Promise<
	| { inMerge: false }
	| {
			inMerge: true;
			branch: string | null;
			files: MergeFile[];
			remaining: number;
	  }
> {
	if (!inMerge(repoRoot)) return { inMerge: false };
	const prefix = docsPrefix(docsRoot);
	const files: MergeFile[] = [];
	for (const path of await unmergedPaths(repoRoot)) {
		const kind = classifyPath(path, prefix);
		if (kind === "doc") {
			files.push({
				path,
				kind,
				parts: parseConflicts(
					readFileSync(join(repoRoot, ...path.split("/")), "utf8"),
				),
			});
		} else if (kind === "sidecar") {
			const { ours, theirs } = await sidecarStages(repoRoot, path);
			files.push({
				path,
				kind,
				summary: mergeSidecars(ours, theirs).summary,
			});
		} else {
			files.push({ path, kind });
		}
	}
	return {
		inMerge: true,
		branch: mergeBranchFromMsg(repoRoot),
		files,
		remaining: files.length,
	};
}

/** Write a doc's assembled resolution verbatim (no canonicalization) + stage. */
export async function resolveMergeDoc(
	repoRoot: string,
	path: string,
	content: string,
): Promise<void> {
	writeFileSync(join(repoRoot, ...path.split("/")), content);
	await git(repoRoot, ["add", "--", path]);
}

/**
 * Resolve a sidecar by choice: the union merge, or one stage verbatim.
 * Written through the sidecar serializer's exact format (tab indent + one
 * trailing newline) + staged.
 */
export async function resolveMergeSidecar(
	repoRoot: string,
	path: string,
	choice: "merged" | "ours" | "theirs",
): Promise<void> {
	const stages = await sidecarStages(repoRoot, path);
	const file =
		choice === "merged"
			? mergeSidecars(stages.ours, stages.theirs).merged
			: stages[choice];
	writeFileSync(
		join(repoRoot, ...path.split("/")),
		`${JSON.stringify(file, null, "\t")}\n`,
	);
	await git(repoRoot, ["add", "--", path]);
}

/**
 * Finish a standing merge: the merge commit (`--no-edit` uses git's own
 * MERGE_MSG — the one write path that bypasses commitAs, by design: it IS
 * the merge commit), then the usual draft-branch cleanup. Unmerged paths
 * left → MergeUnresolvedError (server: 409), nothing written.
 */
export async function concludeMerge(
	repoRoot: string,
): Promise<{ sha: string }> {
	const left = await unmergedPaths(repoRoot);
	if (left.length > 0)
		throw new MergeUnresolvedError(
			`merge has ${left.length} unresolved file(s): ${left.join(", ")}`,
		);
	const branch = mergeBranchFromMsg(repoRoot); // MERGE_MSG vanishes on commit
	await git(repoRoot, ["commit", "--no-edit"]);
	const sha = await git(repoRoot, ["rev-parse", "HEAD"]);
	if (branch) await cleanupDraftBranch(repoRoot, branch);
	return { sha };
}

/** Undo a standing merge and put the user back on the draft branch. */
export async function abortMerge(repoRoot: string): Promise<void> {
	const branch = mergeBranchFromMsg(repoRoot); // read before --abort drops it
	await git(repoRoot, ["merge", "--abort"]);
	if (branch && branch !== (await currentBranch(repoRoot)))
		await checkoutBranch(repoRoot, branch);
}

/**
 * Restore a deleted doc (and its comment sidecar, when one existed at the
 * delete commit) in ONE commit: `Restore <docPath>`. Content comes from
 * `<deleteSha>^:<path>` — the last live version before the delete.
 */
export async function restoreDoc(
	repoRoot: string,
	docsRoot: string,
	docPath: string,
	deleteSha: string,
): Promise<{ sha: string }> {
	const abs = resolveDocPath(repoRoot, docsRoot, docPath);
	if (existsSync(abs)) throw new PathExistsError(`already exists: ${docPath}`);
	const user = await localUser(repoRoot); // identity before any disk write
	const repoRel = relative(repoRoot, abs).split(sep).join("/");

	// ponytail: no rename tracing — restore reads <deleteSha>^:<path> only; a
	// doc renamed before its delete restores from the old path's last content.
	const body = canonicalBody(
		await showRef(repoRoot, `${deleteSha}^:${repoRel}`),
	);
	const files = [repoRel];
	const sidecarAbs = sidecarPath(repoRoot, docPath);
	const sidecarRel = relative(repoRoot, sidecarAbs).split(sep).join("/");
	try {
		// A missing sidecar ref (the doc never had comments) just skips it.
		const sidecar = await showRef(repoRoot, `${deleteSha}^:${sidecarRel}`);
		files.push(sidecarRel);
		mkdirSync(dirname(sidecarAbs), { recursive: true });
		writeFileSync(sidecarAbs, sidecar);
	} catch {
		// no sidecar at <deleteSha>^ — the doc restores alone
	}

	mkdirSync(dirname(abs), { recursive: true });
	writeFileSync(abs, body);
	const sha = await commitAs(
		user,
		{ files, message: `Restore ${docPath}` },
		repoRoot,
	);
	return { sha };
}
