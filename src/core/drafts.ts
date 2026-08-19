import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, sep } from "node:path";
import { sidecarPath } from "./comments.js";
import { commitAs } from "./commit.js";
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

/** docsRoot-relative doc path → the repo-relative pathspec git wants. */
function pathspec(docsRoot: string, docPath: string): string {
	const prefix =
		docsRoot === "." ? "" : docsRoot.replace(/\\/g, "/").replace(/\/+$/, "");
	return prefix === "" ? docPath : `${prefix}/${docPath}`;
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
 * Merge the current draft into main (the sanctioned write). A conflict aborts
 * the merge and switches back — HEAD and the draft untouched, user not
 * stranded. A clean merge deletes the branch and returns the merged sha.
 */
export async function mergeToMain(
	repoRoot: string,
): Promise<
	| { merged: true; sha: string }
	| { merged: false; conflict: true; message: string }
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
		await git(repoRoot, ["merge", "--abort"]);
		await checkoutBranch(repoRoot, current);
		return {
			merged: false,
			conflict: true,
			message:
				output
					.split("\n")
					.find((l) => l.includes("CONFLICT"))
					?.trim() || e.stderr.trim(),
		};
	}
	const sha = await git(repoRoot, ["rev-parse", "HEAD"]);
	await deleteBranch(repoRoot, current);
	// ponytail: best-effort remote delete — any failure ignored (the local merge
	// already succeeded; push failures surface on the next sync anyway).
	try {
		const remote = await git(repoRoot, [
			"config",
			"--get",
			`branch.${current}.remote`,
		]);
		if (remote !== "")
			await git(repoRoot, ["push", remote, "--delete", current]);
	} catch {
		// not tracking a remote, or the delete failed — fine either way
	}
	return { merged: true, sha };
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
