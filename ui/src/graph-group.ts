/**
 * The reference graph's folder structure (ui v1, phase 10) – pure: which
 * folder a doc sits in at a depth, folding folders into single nodes, and
 * the nested groups the hulls are drawn around. No DOM, no layout.
 */
import type { DocGraph, GraphEdge, GraphNode } from "./api.js";

/** A node as the view draws it: a doc, or a folded folder standing in for
 *  `count` docs (path "<folder>/", title "<name>/"). */
export type ViewNode = GraphNode & { count?: number };
/** An edge with its multiplicity – folding merges parallel edges. */
export type ViewEdge = GraphEdge & { weight: number };
export interface ViewGraph {
	nodes: ViewNode[];
	edges: ViewEdge[];
}

/** The first `depth` folder segments of a path ("" for a root-level doc;
 *  Infinity = the full folder). A folded node ("x/y/") sits in x/y's parent. */
export function folderAt(path: string, depth: number): string {
	const own = path.endsWith("/") ? path.slice(0, -1) : path;
	const folders = own.split("/").slice(0, -1);
	return (
		depth === Number.POSITIVE_INFINITY ? folders : folders.slice(0, depth)
	).join("/");
}

/** The outermost folded folder containing `path`, or null. */
function foldedAncestor(
	path: string,
	folded: ReadonlySet<string>,
): string | null {
	const folders = path.split("/").slice(0, -1);
	for (let i = 1; i <= folders.length; i++) {
		const f = folders.slice(0, i).join("/");
		if (folded.has(f)) return f;
	}
	return null;
}

/**
 * Replace every node under a folded folder with one folder node, merge the
 * edges that now share endpoints into one with a weight, and drop the edges
 * folding turned into self-loops (links inside the folder). Unfolding is
 * just calling this again without the folder – the input graph is never
 * touched.
 */
export function foldGraph(
	graph: DocGraph,
	folded: ReadonlySet<string>,
): ViewGraph {
	const map = new Map<string, string>(); // doc path → its view node path
	const nodes: ViewNode[] = [];
	const folders = new Map<string, ViewNode>();
	for (const n of graph.nodes) {
		const f = foldedAncestor(n.path, folded);
		if (f === null) {
			map.set(n.path, n.path);
			nodes.push(n);
			continue;
		}
		const key = `${f}/`;
		map.set(n.path, key);
		const existing = folders.get(key);
		if (existing) {
			existing.count = (existing.count ?? 0) + 1;
			continue;
		}
		const node: ViewNode = {
			path: key,
			title: `${f.split("/").at(-1)}/`,
			type: null,
			status: null,
			tier: "unverified",
			stale: false,
			count: 1,
		};
		folders.set(key, node);
		nodes.push(node);
	}
	const merged = new Map<string, ViewEdge>();
	for (const e of graph.edges) {
		const from = map.get(e.from);
		const to = map.get(e.to);
		if (from === undefined || to === undefined || from === to) continue;
		const key = `${from}\u0000${to}`;
		const hit = merged.get(key);
		if (hit) hit.weight++;
		else merged.set(key, { from, to, weight: 1 });
	}
	return { nodes, edges: [...merged.values()] };
}

export interface Group {
	/** The view node paths inside this folder (at any depth below it). */
	paths: string[];
	/** The enclosing group's key (level − 1), null at level 1. */
	parent: string | null;
	/** 1 = a direct child folder of the docs root. */
	level: number;
}

/** Folder groups down to `depth` levels (Infinity = all), keyed by folder
 *  path; root-level docs belong to no group. Nested: a level-2 group
 *  names its level-1 parent. */
export function groupsOf(
	nodes: readonly { path: string }[],
	depth: number,
): Map<string, Group> {
	const out = new Map<string, Group>();
	for (const n of nodes) {
		const full = folderAt(n.path, Number.POSITIVE_INFINITY);
		const levels = full === "" ? 0 : full.split("/").length;
		for (let l = 1; l <= Math.min(depth, levels); l++) {
			const key = folderAt(n.path, l);
			let g = out.get(key);
			if (!g) {
				g = {
					paths: [],
					parent: l > 1 ? folderAt(n.path, l - 1) : null,
					level: l,
				};
				out.set(key, g);
			}
			g.paths.push(n.path);
		}
	}
	return out;
}
