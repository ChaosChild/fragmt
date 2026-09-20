import { basename } from "node:path";
import { type Doc, readDoc } from "./docs.js";
import {
	docPaths,
	extractRefs,
	isReservedBase,
	isStale,
	trustTier,
} from "./okf.js";
import { displayTitle } from "./search.js";

/**
 * The rung-5 reference graph: a fresh read-only derivation from body links
 * (the `references`/`referenced-by` frontmatter cache is never trusted) plus
 * three pure renderers over it. Titles are free text under OKF's open
 * vocabulary, so every renderer escapes through JSON.stringify.
 */

export interface GraphNode {
	/** docsRoot-relative POSIX path – the identity everywhere else too. */
	path: string;
	/** displayTitle rule: frontmatter `title`, else the name sans .md. */
	title: string;
	/** The §4.1 extension value; absent or empty → null. */
	type: string | null;
	/** The A2 enum's current value; any non-string → null. */
	status: string | null;
	/** §5.3's advisory tier, derived and never stored. */
	tier: "unverified" | "machine-confirmed" | "human-reviewed";
	/** §5.5: `now >= stale_after`. */
	stale: boolean;
}

export interface GraphEdge {
	from: string;
	to: string;
}

export interface DocGraph {
	nodes: GraphNode[];
	edges: GraphEdge[];
}

/**
 * The repo-wide read the graph view and every export share (the read-only
 * half of okf.ts's recomputeGraph): nodes from the shared enumeration with
 * reserved files excluded as sources and targets, edges from extractRefs –
 * the exact semantics the derived frontmatter fields come from – kept only
 * when the target is a node of THIS graph (an unreadable target must not
 * dangle). A pure read: nothing is written, and an unreadable doc is
 * skipped whole (validate reports it, this walk never throws). Deterministic
 * by contract: nodes sorted by path, edges by (from, to), links deduped.
 */
export async function deriveGraph(
	repoRoot: string,
	docsRoot: string,
): Promise<DocGraph> {
	const paths = (await docPaths(repoRoot, docsRoot)).filter(
		(p) => !isReservedBase(p),
	);
	const read: { node: GraphNode; markdown: string }[] = [];
	for (const p of paths) {
		let doc: Doc;
		try {
			doc = readDoc(repoRoot, docsRoot, p);
		} catch {
			continue; // unreadable doc – validate's finding, never this walk's throw
		}
		const fm = doc.frontmatter;
		const type = fm.type;
		read.push({
			node: {
				path: p,
				title: displayTitle(fm.title, basename(p)),
				type: typeof type === "string" && type.trim() !== "" ? type : null,
				status: typeof fm.status === "string" ? fm.status : null,
				tier: trustTier(fm),
				stale: isStale(fm),
			},
			markdown: doc.markdown,
		});
	}
	const held = new Set(read.map((r) => r.node.path));
	// extractRefs dedupes per doc and each source appears once, so the pairs
	// are unique already; the sorts ARE the determinism contract.
	const edges: GraphEdge[] = [];
	for (const r of read) {
		for (const to of extractRefs(r.markdown, r.node.path, paths)) {
			if (held.has(to)) edges.push({ from: r.node.path, to });
		}
	}
	edges.sort(
		(a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to),
	);
	const nodes = read
		.map((r) => r.node)
		.sort((a, b) => a.path.localeCompare(b.path));
	return { nodes, edges };
}

/**
 * Mermaid `flowchart LR` text. Node ids are positional (n<i> = the node
 * array's index), so escaping only applies to the title: JSON.stringify's
 * output is a valid double-quoted Mermaid label and quotes/backslashes
 * survive it. The header comment carries the date and the counts.
 */
export function graphToMermaid(graph: DocGraph, generated: Date): string {
	const lines = [
		`%% fragmt reference graph — ${generated.toISOString().slice(0, 10)} — ${graph.nodes.length} docs · ${graph.edges.length} links`,
		"flowchart LR",
	];
	const id = new Map<string, string>(
		graph.nodes.map((n, i): [string, string] => [n.path, `n${i}`]),
	);
	for (const [i, n] of graph.nodes.entries()) {
		lines.push(`  n${i}[${JSON.stringify(n.title)}]`);
	}
	for (const e of graph.edges) {
		lines.push(`  ${id.get(e.from)} --> ${id.get(e.to)}`);
	}
	return `${lines.join("\n")}\n`;
}

/**
 * Graphviz DOT: paths are the node ids (unique already), JSON-escaped titles
 * the labels, `rankdir=LR` like the Mermaid shape.
 */
export function graphToDot(graph: DocGraph): string {
	const lines = ["digraph fragmt {", "  rankdir=LR;"];
	for (const n of graph.nodes) {
		lines.push(
			`  ${JSON.stringify(n.path)} [label=${JSON.stringify(n.title)}];`,
		);
	}
	for (const e of graph.edges) {
		lines.push(`  ${JSON.stringify(e.from)} -> ${JSON.stringify(e.to)};`);
	}
	lines.push("}");
	return `${lines.join("\n")}\n`;
}

/** The export JSON shape: `{ generated, nodes, edges }` – the caller
 *  stringifies; this stays a pure function returning an object. */
export function graphToJson(graph: DocGraph, generated: Date) {
	return {
		generated: generated.toISOString(),
		nodes: graph.nodes,
		edges: graph.edges,
	};
}
