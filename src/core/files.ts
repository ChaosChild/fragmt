import {
	existsSync,
	mkdirSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { commitAs } from "./commit.js";
import { canonicalBody, DocNotFoundError, resolveDocPath } from "./docs.js";
import { git } from "./git.js";
import { localUser } from "./identity.js";

/** Target path already exists — the server maps this to 409. */
export class PathExistsError extends Error {}

/**
 * Worktree mutations here are fs-level (writeFileSync/renameSync/rmSync), not
 * `git mv`/`git rm`: commitAs stages with `git add -- <files>` and commits with
 * a pathspec-limited `git commit -- <files>`, and `git add` fails outright on a
 * path `git rm`/`git mv` already dropped from the index — while after a plain
 * fs removal the index entry is still there, so `git add` stages the deletion
 * and the pathspec commit records it. Same result either way: one commit per
 * op, R100 renames, `git log --follow` intact. As in writeDoc, the identity is
 * read BEFORE anything touches disk so a missing identity leaves the tree
 * untouched.
 */

/** Repo-root-relative POSIX path — the shape commitAs stages and commits. */
function repoRel(repoRoot: string, abs: string): string {
	return relative(repoRoot, abs).split(sep).join("/");
}

/** Unwind a failed move: the fs rename back, plus unstaging — `git add`
 *  stages what it can before refusing an ignored path, so the source
 *  deletion would otherwise sit in the index. Best-effort: never masks the
 *  original error. */
async function rollbackMove(
	repoRoot: string,
	fromAbs: string,
	toAbs: string,
): Promise<void> {
	try {
		renameSync(toAbs, fromAbs);
		await git(repoRoot, [
			"reset",
			"--quiet",
			"--",
			repoRel(repoRoot, fromAbs),
			repoRel(repoRoot, toAbs),
		]);
	} catch {
		// rollback is best-effort; the original error is the story
	}
}

/** Create a doc (LF, exactly one trailing newline) in one commit. */
export async function createDoc(
	repoRoot: string,
	docsRoot: string,
	docPath: string,
	body = "",
): Promise<{ sha: string }> {
	const abs = resolveDocPath(repoRoot, docsRoot, docPath);
	if (existsSync(abs)) {
		throw new PathExistsError(`already exists: ${docPath}`);
	}
	const user = await localUser(repoRoot);
	mkdirSync(dirname(abs), { recursive: true });
	writeFileSync(abs, canonicalBody(body));
	const sha = await commitAs(
		user,
		{ files: [repoRel(repoRoot, abs)], message: `Create ${docPath}` },
		repoRoot,
	);
	return { sha };
}

/** Move/rename a doc in one commit; both ends pass the containment guard.
 *  The rename happens before the commit (the M3 seam needs the fs move), so
 *  a failed commit rolls the rename back — the doc is never stranded at its
 *  destination with no commit recording the move. */
export async function moveDoc(
	repoRoot: string,
	docsRoot: string,
	from: string,
	to: string,
): Promise<{ sha: string }> {
	const fromAbs = resolveDocPath(repoRoot, docsRoot, from);
	const toAbs = resolveDocPath(repoRoot, docsRoot, to);
	if (!existsSync(fromAbs) || !statSync(fromAbs).isFile()) {
		throw new DocNotFoundError(from);
	}
	if (existsSync(toAbs)) {
		throw new PathExistsError(`already exists: ${to}`);
	}
	const user = await localUser(repoRoot);
	mkdirSync(dirname(toAbs), { recursive: true });
	renameSync(fromAbs, toAbs);
	try {
		const sha = await commitAs(
			user,
			{
				files: [repoRel(repoRoot, fromAbs), repoRel(repoRoot, toAbs)],
				message: `Rename ${from} to ${to}`,
			},
			repoRoot,
		);
		return { sha };
	} catch (e) {
		await rollbackMove(repoRoot, fromAbs, toAbs);
		throw e;
	}
}

/** Delete a doc in one commit. Missing path → DocNotFoundError (server: 404). */
export async function deleteDoc(
	repoRoot: string,
	docsRoot: string,
	docPath: string,
): Promise<{ sha: string }> {
	const abs = resolveDocPath(repoRoot, docsRoot, docPath);
	if (!existsSync(abs) || !statSync(abs).isFile()) {
		throw new DocNotFoundError(docPath);
	}
	const user = await localUser(repoRoot);
	rmSync(abs);
	const sha = await commitAs(
		user,
		{ files: [repoRel(repoRoot, abs)], message: `Delete ${docPath}` },
		repoRoot,
	);
	return { sha };
}

/**
 * Create a folder as a committed `.gitkeep` — git tracks no empty directories,
 * and as a dotfile `.gitkeep` never shows in the M1 tree (a folder holding .md
 * files needs none, but keeping it costs nothing and survives the last doc
 * moving away).
 */
export async function createFolder(
	repoRoot: string,
	docsRoot: string,
	folderPath: string,
): Promise<{ sha: string }> {
	const abs = resolveDocPath(repoRoot, docsRoot, folderPath, "folder");
	if (existsSync(abs)) {
		throw new PathExistsError(`already exists: ${folderPath}`);
	}
	const user = await localUser(repoRoot);
	mkdirSync(abs, { recursive: true });
	const keep = join(abs, ".gitkeep");
	writeFileSync(keep, "");
	const sha = await commitAs(
		user,
		{ files: [repoRel(repoRoot, keep)], message: `Create ${folderPath}` },
		repoRoot,
	);
	return { sha };
}

/**
 * Rename a folder in one commit: a single renameSync moves the whole directory,
 * so no doc inside can be orphaned, and commitAs records the old and new trees
 * together. (`git mv <dir>` stages a move the commitAs seam cannot express —
 * see the note atop this file.)
 */
export async function renameFolder(
	repoRoot: string,
	docsRoot: string,
	from: string,
	to: string,
): Promise<{ sha: string }> {
	const fromAbs = resolveDocPath(repoRoot, docsRoot, from, "folder");
	const toAbs = resolveDocPath(repoRoot, docsRoot, to, "folder");
	if (!existsSync(fromAbs) || !statSync(fromAbs).isDirectory()) {
		throw new DocNotFoundError(from);
	}
	if (existsSync(toAbs)) {
		throw new PathExistsError(`already exists: ${to}`);
	}
	const user = await localUser(repoRoot);
	mkdirSync(dirname(toAbs), { recursive: true });
	renameSync(fromAbs, toAbs);
	try {
		const sha = await commitAs(
			user,
			{
				files: [repoRel(repoRoot, fromAbs), repoRel(repoRoot, toAbs)],
				message: `Rename ${from} to ${to}`,
			},
			repoRoot,
		);
		return { sha };
	} catch (e) {
		// Same rollback as moveDoc — the subtree returns untouched.
		await rollbackMove(repoRoot, fromAbs, toAbs);
		throw e;
	}
}

/**
 * Delete a folder and everything under it in one commit (the fs-level
 * equivalent of `git rm -r` — see the note atop this file). Missing folder →
 * DocNotFoundError (server: 404).
 */
export async function deleteFolder(
	repoRoot: string,
	docsRoot: string,
	folderPath: string,
): Promise<{ sha: string }> {
	const abs = resolveDocPath(repoRoot, docsRoot, folderPath, "folder");
	if (!existsSync(abs) || !statSync(abs).isDirectory()) {
		throw new DocNotFoundError(folderPath);
	}
	const user = await localUser(repoRoot);
	rmSync(abs, { recursive: true });
	const sha = await commitAs(
		user,
		{ files: [repoRel(repoRoot, abs)], message: `Delete ${folderPath}` },
		repoRoot,
	);
	return { sha };
}
