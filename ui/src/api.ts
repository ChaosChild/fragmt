export interface TreeNode {
	name: string;
	/** POSIX path relative to docsRoot; "" for the root node. */
	path: string;
	type: "dir" | "doc";
	children?: TreeNode[];
}

export interface DocResponse {
	path: string;
	frontmatter: Record<string, unknown>;
	markdown: string;
}

export async function getTree(): Promise<TreeNode> {
	const res = await fetch("/api/tree");
	if (!res.ok) throw new Error(`failed to load tree (${res.status})`);
	return (await res.json()) as TreeNode;
}

export async function getDoc(path: string): Promise<DocResponse> {
	const res = await fetch(`/api/docs/${encodeURI(path)}`);
	if (!res.ok) throw new Error(`failed to load ${path} (${res.status})`);
	return (await res.json()) as DocResponse;
}
