import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import matter from "gray-matter";
import { commitAs } from "./commit.js";
import {
	canonicalBody,
	DocNotFoundError,
	DocPathError,
	resolveDocPath,
} from "./docs.js";
import { git } from "./git.js";
import { localUser } from "./identity.js";
import {
	DEFAULT_TYPE,
	docPaths,
	extractRefs,
	generateIndexes,
	isReservedBase,
	okfEnabled,
	propagateRefs,
	refsList,
	saveWithRefs,
} from "./okf.js";

/** Target path already exists – the server maps this to 409. */
export class PathExistsError extends Error {}

/**
 * Worktree mutations here are fs-level (writeFileSync/renameSync/rmSync), not
 * `git mv`/`git rm`: commitAs stages with `git add -- <files>` and commits with
 * a pathspec-limited `git commit -- <files>`, and `git add` fails outright on a
 * path `git rm`/`git mv` already dropped from the index – while after a plain
 * fs removal the index entry is still there, so `git add` stages the deletion
 * and the pathspec commit records it. Same result either way: one commit per
 * op, R100 renames, `git log --follow` intact. As in writeDoc, the identity is
 * read BEFORE anything touches disk so a missing identity leaves the tree
 * untouched. Every op takes a trailing `user` (serve --auth): when given it is
 * the commit author directly (no localUser spawn); when omitted the repo's
 * git identity is read as before.
 */

/** Repo-root-relative POSIX path – the shape commitAs stages and commits. */
function repoRel(repoRoot: string, abs: string): string {
	return relative(repoRoot, abs).split(sep).join("/");
}

/** Unwind a failed move: the fs rename back, plus unstaging – `git add`
 *  stages what it can before refusing an ignored path, so the source
 *  deletion would otherwise sit in the index (a keep-`.gitkeep` staged in
 *  the same failed commit unwinds the same way). Best-effort: never masks
 *  the original error. */
async function rollbackMove(
	repoRoot: string,
	fromAbs: string,
	toAbs: string,
	extraPaths: string[] = [],
): Promise<void> {
	try {
		renameSync(toAbs, fromAbs);
		await git(repoRoot, [
			"reset",
			"--quiet",
			"--",
			repoRel(repoRoot, fromAbs),
			repoRel(repoRoot, toAbs),
			...extraPaths,
		]);
	} catch {
		// rollback is best-effort; the original error is the story
	}
}

/**
 * M4-4 dogfood round: when a move empties a folder of its last markdown, the
 * M1 prune rule would drop it from every tree-derived surface – including as
 * a drop target, so the move could not be undone in the UI (the 2026-08-20
 * corpus.md dogfood: tests/fixtures vanished mid-drag-back). Same contract
 * as createFolder: a committed `.gitkeep` keeps the folder visible. Returns
 * the repo-relative keep path to fold into the move's commit, or null when
 * the folder still has docs, already has a keep, or is the docsRoot root.
 */
function keepEmptiedFolder(
	repoRoot: string,
	docsRoot: string,
	emptiedAbs: string,
): string | null {
	if (emptiedAbs === resolve(repoRoot, docsRoot)) return null;
	const keep = join(emptiedAbs, ".gitkeep");
	if (existsSync(keep)) return null;
	const mdLeft = readdirSync(emptiedAbs).some((e) => e.endsWith(".md"));
	if (mdLeft) return null;
	writeFileSync(keep, "");
	return repoRel(repoRoot, keep);
}

/**
 * Create a doc (LF, exactly one trailing newline) in one commit. In OKF mode
 * the file is born conformant: `---\ntype: concept\n---\n` (§4.1) plus the
 * derived `references` when the seed body links existing docs, the linked
 * docs' `referenced-by` lists settle in the same commit, the affected
 * indexes regenerate on it, and a reserved basename is refused (§3.1 –
 * DocPathError, the server's 400).
 */
export async function createDoc(
	repoRoot: string,
	docsRoot: string,
	docPath: string,
	body = "",
	user?: { name: string; email: string },
): Promise<{ sha: string }> {
	const abs = resolveDocPath(repoRoot, docsRoot, docPath);
	if (existsSync(abs)) {
		throw new PathExistsError(`already exists: ${docPath}`);
	}
	const okf = okfEnabled(repoRoot);
	if (okf && isReservedBase(docPath)) {
		throw new DocPathError(`reserved filename: ${docPath}`);
	}
	const who = user ?? (await localUser(repoRoot));
	mkdirSync(dirname(abs), { recursive: true });
	const normalized = canonicalBody(body);
	const files = new Set([repoRel(repoRoot, abs)]);
	if (okf) {
		const targets = extractRefs(
			normalized,
			docPath,
			await docPaths(repoRoot, docsRoot),
		);
		// saveWithRefs over the seed body itself: the type block + references.
		// Its null (fenceless + nothing to carry) is a save-path contract; a
		// create still owes the type block, so the fallback is not `normalized`.
		writeFileSync(
			abs,
			saveWithRefs(normalized, targets, normalized) ??
				`---\ntype: ${DEFAULT_TYPE}\n---\n${normalized}`,
		);
		for (const p of await propagateRefs(
			repoRoot,
			docsRoot,
			docPath,
			[],
			targets,
		))
			files.add(p);
		for (const p of await generateIndexes(repoRoot, docsRoot)) files.add(p);
	} else {
		writeFileSync(abs, normalized);
	}
	const sha = await commitAs(
		who,
		{ files: [...files], message: `Create ${docPath}` },
		repoRoot,
	);
	return { sha };
}

/**
 * Move/rename a doc in one commit; both ends pass the containment guard.
 * The rename happens before the commit (the M3 seam needs the fs move), so
 * a failed commit rolls the rename back – the doc is never stranded at its
 * destination with no commit recording the move. In OKF mode the target
 * basename must not be reserved (§3.1), the moved doc's `references`
 * re-derive from its new directory (relative §6.1 links resolve differently
 * after the move) and settle their symmetric difference in the same commit,
 * and the affected indexes regenerate on it. Links other docs hold to the
 * old path become broken links – spec-tolerated, and `referenced-by` makes
 * them cheap to heal once #33 ships move-time rewriting.
 */
export async function moveDoc(
	repoRoot: string,
	docsRoot: string,
	from: string,
	to: string,
	user?: { name: string; email: string },
): Promise<{ sha: string }> {
	const fromAbs = resolveDocPath(repoRoot, docsRoot, from);
	const toAbs = resolveDocPath(repoRoot, docsRoot, to);
	if (!existsSync(fromAbs) || !statSync(fromAbs).isFile()) {
		throw new DocNotFoundError(from);
	}
	if (existsSync(toAbs)) {
		throw new PathExistsError(`already exists: ${to}`);
	}
	const okf = okfEnabled(repoRoot);
	if (okf && isReservedBase(to)) {
		throw new DocPathError(`reserved filename: ${to}`);
	}
	const who = user ?? (await localUser(repoRoot));
	let prev: string[] = [];
	if (okf) {
		try {
			prev = refsList(
				(
					matter(readFileSync(fromAbs, "utf8"), {}).data as Record<
						string,
						unknown
					>
				).references,
			);
		} catch {
			prev = []; // unparseable frontmatter – the fields ride along as-is
		}
	}
	mkdirSync(dirname(toAbs), { recursive: true });
	renameSync(fromAbs, toAbs);
	const keep = keepEmptiedFolder(repoRoot, docsRoot, dirname(fromAbs));
	try {
		const files = new Set([
			repoRel(repoRoot, fromAbs),
			repoRel(repoRoot, toAbs),
			...(keep ? [keep] : []),
		]);
		if (okf) {
			const text = readFileSync(toAbs, "utf8");
			let next: string[] = [];
			let updated: string | null = null;
			try {
				const parsed = matter(text, {});
				const body = canonicalBody(parsed.content);
				next = extractRefs(body, to, await docPaths(repoRoot, docsRoot));
				updated = saveWithRefs(text, next, body);
			} catch {
				// Unparseable frontmatter – leave the derived fields as they are.
			}
			for (const p of await propagateRefs(repoRoot, docsRoot, to, prev, next))
				files.add(p);
			if (updated !== null) writeFileSync(toAbs, updated);
			for (const p of await generateIndexes(repoRoot, docsRoot)) files.add(p);
		}
		const sha = await commitAs(
			who,
			{
				files: [...files],
				message: `Rename ${from} to ${to}`,
			},
			repoRoot,
		);
		return { sha };
	} catch (e) {
		await rollbackMove(repoRoot, fromAbs, toAbs, keep ? [keep] : []);
		if (keep) rmSync(join(dirname(fromAbs), ".gitkeep"), { force: true });
		throw e;
	}
}

/**
 * Delete a doc in one commit. Missing path → DocNotFoundError (server: 404).
 * OKF mode regenerates the affected indexes on the same commit; the deleted
 * doc's referrers keep their (now broken, spec-tolerated) body links and
 * `references` entries – #33's move/delete-time rewriting heals them.
 */
export async function deleteDoc(
	repoRoot: string,
	docsRoot: string,
	docPath: string,
	user?: { name: string; email: string },
): Promise<{ sha: string }> {
	const abs = resolveDocPath(repoRoot, docsRoot, docPath);
	if (!existsSync(abs) || !statSync(abs).isFile()) {
		throw new DocNotFoundError(docPath);
	}
	const who = user ?? (await localUser(repoRoot));
	rmSync(abs);
	const files = new Set([repoRel(repoRoot, abs)]);
	if (okfEnabled(repoRoot)) {
		for (const p of await generateIndexes(repoRoot, docsRoot)) files.add(p);
	}
	const sha = await commitAs(
		who,
		{ files: [...files], message: `Delete ${docPath}` },
		repoRoot,
	);
	return { sha };
}

/**
 * Create a folder as a committed `.gitkeep` – git tracks no empty directories,
 * and as a dotfile `.gitkeep` never shows in the M1 tree (a folder holding .md
 * files needs none, but keeping it costs nothing and survives the last doc
 * moving away).
 */
export async function createFolder(
	repoRoot: string,
	docsRoot: string,
	folderPath: string,
	user?: { name: string; email: string },
): Promise<{ sha: string }> {
	const abs = resolveDocPath(repoRoot, docsRoot, folderPath, "folder");
	if (existsSync(abs)) {
		throw new PathExistsError(`already exists: ${folderPath}`);
	}
	const who = user ?? (await localUser(repoRoot));
	mkdirSync(abs, { recursive: true });
	const keep = join(abs, ".gitkeep");
	writeFileSync(keep, "");
	const sha = await commitAs(
		who,
		{ files: [repoRel(repoRoot, keep)], message: `Create ${folderPath}` },
		repoRoot,
	);
	return { sha };
}

/**
 * Rename a folder in one commit: a single renameSync moves the whole directory,
 * so no doc inside can be orphaned, and commitAs records the old and new trees
 * together. (`git mv <dir>` stages a move the commitAs seam cannot express –
 * see the note atop this file.) OKF mode regenerates the indexes on the same
 * commit. ponytail: per-doc reference re-derivation after a folder rename is
 * left to the next save/--fix (only relative §6.1 links shift; absolute
 * bundle-relative links – the recommended form – never do).
 */
export async function renameFolder(
	repoRoot: string,
	docsRoot: string,
	from: string,
	to: string,
	user?: { name: string; email: string },
): Promise<{ sha: string }> {
	const fromAbs = resolveDocPath(repoRoot, docsRoot, from, "folder");
	const toAbs = resolveDocPath(repoRoot, docsRoot, to, "folder");
	if (!existsSync(fromAbs) || !statSync(fromAbs).isDirectory()) {
		throw new DocNotFoundError(from);
	}
	if (existsSync(toAbs)) {
		throw new PathExistsError(`already exists: ${to}`);
	}
	const okf = okfEnabled(repoRoot);
	const who = user ?? (await localUser(repoRoot));
	mkdirSync(dirname(toAbs), { recursive: true });
	renameSync(fromAbs, toAbs);
	const keep = keepEmptiedFolder(repoRoot, docsRoot, dirname(fromAbs));
	try {
		const files = new Set([
			repoRel(repoRoot, fromAbs),
			repoRel(repoRoot, toAbs),
			...(keep ? [keep] : []),
		]);
		if (okf) {
			for (const p of await generateIndexes(repoRoot, docsRoot)) files.add(p);
		}
		const sha = await commitAs(
			who,
			{
				files: [...files],
				message: `Rename ${from} to ${to}`,
			},
			repoRoot,
		);
		return { sha };
	} catch (e) {
		// Same rollback as moveDoc – the subtree returns untouched.
		await rollbackMove(repoRoot, fromAbs, toAbs, keep ? [keep] : []);
		if (keep) rmSync(join(dirname(fromAbs), ".gitkeep"), { force: true });
		throw e;
	}
}

/**
 * Delete a folder and everything under it in one commit (the fs-level
 * equivalent of `git rm -r` – see the note atop this file). Missing folder →
 * DocNotFoundError (server: 404). OKF mode regenerates the indexes on the
 * same commit (the deleted docs' referrers keep their broken-but-tolerated
 * links, as in deleteDoc).
 */
export async function deleteFolder(
	repoRoot: string,
	docsRoot: string,
	folderPath: string,
	user?: { name: string; email: string },
): Promise<{ sha: string }> {
	const abs = resolveDocPath(repoRoot, docsRoot, folderPath, "folder");
	if (!existsSync(abs) || !statSync(abs).isDirectory()) {
		throw new DocNotFoundError(folderPath);
	}
	const okf = okfEnabled(repoRoot);
	const who = user ?? (await localUser(repoRoot));
	rmSync(abs, { recursive: true });
	const files = new Set([repoRel(repoRoot, abs)]);
	if (okf) {
		for (const p of await generateIndexes(repoRoot, docsRoot)) files.add(p);
	}
	const sha = await commitAs(
		who,
		{ files: [...files], message: `Delete ${folderPath}` },
		repoRoot,
	);
	return { sha };
}
