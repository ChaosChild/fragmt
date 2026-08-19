import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

export interface TreeNode {
	name: string;
	/** POSIX path relative to docsRoot; "" for the root node. */
	path: string;
	type: "dir" | "doc";
	children?: TreeNode[];
}

function buildDir(name: string, path: string, abs: string): TreeNode {
	const dirs: TreeNode[] = [];
	const docs: TreeNode[] = [];
	// Skip dot-folders (covers .git, .docs, .claude, …) plus build/dep dirs.
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
			const node = buildDir(ent.name, childPath, join(abs, ent.name));
			// Prune directories with no .md anywhere beneath them — unless the
			// dir carries a committed .gitkeep (createFolder's marker): a
			// freshly created folder holds no docs yet and must not vanish from
			// the operator's tree (M4-3 b6).
			if (countDocs(node) > 0 || existsSync(join(abs, ent.name, ".gitkeep")))
				dirs.push(node);
		} else if (ent.isFile() && ent.name.toLowerCase().endsWith(".md")) {
			docs.push({ name: ent.name, path: childPath, type: "doc" });
		}
	}
	dirs.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
	docs.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
	// Dirs first, then docs — both alphabetical (case-insensitive).
	return { name, path, type: "dir", children: [...dirs, ...docs] };
}

/** Build the folder tree rooted at docsRoot. Root node: name ".", path "". */
export function listTree(repoRoot: string, docsRoot: string): TreeNode {
	return buildDir(".", "", resolve(repoRoot, docsRoot));
}

export function countDocs(node: TreeNode): number {
	let n = 0;
	for (const c of node.children ?? []) {
		n += c.type === "doc" ? 1 : countDocs(c);
	}
	return n;
}
