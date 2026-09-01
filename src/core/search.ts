import { basename } from "node:path";
import { readDoc } from "./docs.js";
import { gitAllowList, listTree, type TreeNode } from "./tree.js";

export interface SearchHit {
	/** docsRoot-relative POSIX path – the identity everywhere else too. */
	path: string;
	/** Display title: frontmatter `title`, else the file name sans .md. */
	title: string;
	/** ~110-char flattened-body window around the first match (the opening
	 *  clamp when only the title matched), "…" marking each clamp. */
	snippet: string;
}

/** docsRoot-relative paths in tree order (the sidebar's order): depth-first,
 *  listTree's dirs-then-docs children order as-is. */
function treeDocPaths(node: TreeNode, out: string[] = []): string[] {
	for (const child of node.children ?? []) {
		if (child.type === "doc") out.push(child.path);
		else treeDocPaths(child, out);
	}
	return out;
}

/** The display-name rule (ui/display.ts's twin – the server never imports
 *  ui): frontmatter `title` when a non-empty string, else the name sans .md. */
function displayTitle(title: unknown, name: string): string {
	return typeof title === "string" && title.trim()
		? title
		: name.replace(/\.md$/i, "");
}

/** Window ~110 chars around `idx` in the already-flattened body (0 = the
 *  opening clamp); "…" marks a clamp, meta's snippet clamp spirit. */
function snippet(flat: string, idx: number): string {
	const start = Math.max(0, idx - 40);
	const end = Math.min(flat.length, start + 110);
	const head = start > 0 ? "…" : "";
	const tail = end < flat.length ? "…" : "";
	return `${head}${flat.slice(start, end)}${tail}`;
}

/**
 * Flat substring scan over the CURRENT worktree's allow-listed docs (#14):
 * case-insensitive `q` against frontmatter title + body – no history walk, no
 * index. Title hits first, then body-only hits, tree order within each group.
 * A trimmed query shorter than 2 chars is a non-error empty result.
 */
export async function searchDocs(
	repoRoot: string,
	docsRoot: string,
	q: string,
): Promise<SearchHit[]> {
	const needle = q.trim().toLowerCase();
	if (needle.length < 2) return [];
	const allow = await gitAllowList(repoRoot, docsRoot);
	const paths = treeDocPaths(listTree(repoRoot, docsRoot, allow ?? undefined));
	const titleHits: SearchHit[] = [];
	const bodyHits: SearchHit[] = [];
	for (const path of paths) {
		let frontmatterTitle: unknown;
		let body: string;
		try {
			const doc = readDoc(repoRoot, docsRoot, path);
			frontmatterTitle = doc.frontmatter.title;
			body = doc.markdown;
		} catch {
			continue; // vanished between the tree walk and the read – not a hit
		}
		const title = displayTitle(frontmatterTitle, basename(path));
		// The match and the window both live on the flattened body (one
		// whitespace-collapsed line), so the index and the snippet always agree.
		const flat = body.replace(/\s+/g, " ").trim();
		const bodyIdx = flat.toLowerCase().indexOf(needle);
		if (title.toLowerCase().includes(needle))
			titleHits.push({
				path,
				title,
				snippet: snippet(flat, bodyIdx >= 0 ? bodyIdx : 0),
			});
		else if (bodyIdx !== -1)
			bodyHits.push({ path, title, snippet: snippet(flat, bodyIdx) });
	}
	// ponytail: flat scan + cap 50 – add an index when a real repo measurably
	// hurts (measure first, same discipline as /api/meta's walks).
	return [...titleHits, ...bodyHits].slice(0, 50);
}
