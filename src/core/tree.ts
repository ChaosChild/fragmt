import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { GitError, git } from "./git.js";

export interface TreeNode {
	name: string;
	/** POSIX path relative to docsRoot; "" for the root node. */
	path: string;
	type: "dir" | "doc";
	children?: TreeNode[];
}

/**
 * Everything git considers part of the repo beneath docsRoot, as
 * docsRoot-relative POSIX paths: `--cached` is the index (tracked files —
 * ignore rules never apply to them, tracked wins), `--others
 * --exclude-standard` adds the untracked files the ignore rules let through.
 * ponytail: one spawn per tree refresh, never cached — raise/batch if a repo
 * ever makes it measurable.
 *
 * null = git refused (not a repo, git missing) → the caller falls back to
 * today's unfiltered walk. An EMPTY Set is a real answer, not an error:
 * nothing tracked and everything ignored → nothing renders.
 */
export async function gitAllowList(
	repoRoot: string,
	docsRoot: string,
): Promise<Set<string> | null> {
	// docsRoot → repo-relative POSIX prefix (meta.ts's walk-1 discipline).
	const prefix =
		docsRoot === "." ? "" : docsRoot.replace(/\\/g, "/").replace(/\/+$/, "");
	let out: string;
	try {
		out = await git(repoRoot, [
			"ls-files",
			"--cached",
			"--others",
			"--exclude-standard",
			"-z",
			"--",
			resolve(repoRoot, docsRoot),
		]);
	} catch (e) {
		if (e instanceof GitError) return null; // keep-prior-state: no filter
		throw e;
	}
	const allow = new Set<string>();
	for (const entry of out.split("\0")) {
		if (entry === "") continue; // the -z stream is entry\0…entry\0
		// The pathspec pins output under docsRoot; the guard is belt-and-braces.
		let rel = entry;
		if (prefix !== "") {
			if (!rel.startsWith(`${prefix}/`)) continue;
			rel = rel.slice(prefix.length + 1);
		}
		allow.add(rel);
	}
	return allow;
}

/** Does any allowed path sit inside `dir`? (allow entries are files, so a
 *  plain prefix check suffices — the root "" is never tested against it.) */
function hasAllowedUnder(allow: Set<string>, dir: string): boolean {
	for (const p of allow) if (p.startsWith(`${dir}/`)) return true;
	return false;
}

function buildDir(
	name: string,
	path: string,
	abs: string,
	allow: Set<string> | undefined,
): TreeNode {
	const dirs: TreeNode[] = [];
	const docs: TreeNode[] = [];
	// Skip dot-folders (covers .git, .docs, .claude, …) plus build/dep dirs —
	// ALWAYS, allow-list or not: it also guards the no-git fallback walk.
	for (const ent of readdirSync(abs, { withFileTypes: true })) {
		if (
			ent.name.startsWith(".") ||
			ent.name === "node_modules" ||
			ent.name === "dist"
		) {
			continue;
		}
		const childPath = path === "" ? ent.name : `${path}/${ent.name}`;
		if (ent.isDirectory()) {
			// .gitignore filter (M4-3 b7): a dir with nothing allowed beneath it
			// is dead — a fully ignored dir disappears, unread even. (A dir whose
			// only allowed content is a tracked `dir/.gitkeep` still passes: the
			// marker itself is allow-listed.)
			if (allow !== undefined && !hasAllowedUnder(allow, childPath)) continue;
			const node = buildDir(ent.name, childPath, join(abs, ent.name), allow);
			// Prune directories with no .md anywhere beneath them — unless the
			// dir carries a committed .gitkeep (createFolder's marker, and the
			// M4-4 dogfood keep for a folder emptied by a move), or a kept
			// child folder: .gitkeep visibility must hold down the whole chain,
			// or a nested keep (tests/fixtures) prunes its own parent.
			const keptChild = (node.children ?? []).some((c) => c.type === "dir");
			if (
				countDocs(node) > 0 ||
				keptChild ||
				existsSync(join(abs, ent.name, ".gitkeep"))
			)
				dirs.push(node);
		} else if (ent.isFile() && ent.name.toLowerCase().endsWith(".md")) {
			// A file renders only when git considers it part of the repo
			// (tracked, or untracked and not ignored).
			if (allow === undefined || allow.has(childPath))
				docs.push({ name: ent.name, path: childPath, type: "doc" });
		}
	}
	dirs.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
	docs.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
	// Dirs first, then docs — both alphabetical (case-insensitive).
	return { name, path, type: "dir", children: [...dirs, ...docs] };
}

/**
 * Build the folder tree rooted at docsRoot. Root node: name ".", path "".
 * `allow` (gitAllowList's product) filters the tree down to what git tracks
 * or tolerates; absent → today's behavior (hardcoded skips + docless prune)
 * exactly — init's adopted-doc count keeps the two-arg call.
 */
export function listTree(
	repoRoot: string,
	docsRoot: string,
	allow?: Set<string>,
): TreeNode {
	return buildDir(".", "", resolve(repoRoot, docsRoot), allow);
}

export function countDocs(node: TreeNode): number {
	let n = 0;
	for (const c of node.children ?? []) {
		n += c.type === "doc" ? 1 : countDocs(c);
	}
	return n;
}
