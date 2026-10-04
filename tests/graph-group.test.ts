// ui v1 phase 10: the reference graph's folder structure – pure.
import { describe, expect, test } from "vitest";
import type { DocGraph, GraphNode } from "../ui/src/api.js";
import { folderAt, foldGraph, groupsOf } from "../ui/src/graph-group.js";

const node = (path: string): GraphNode => ({
	path,
	title: path,
	type: null,
	status: null,
	tier: "unverified",
	stale: false,
});

const GRAPH: DocGraph = {
	nodes: [
		node("a.md"),
		node("ref/x.md"),
		node("ref/api/y.md"),
		node("ref/api/z.md"),
		node("guides/g.md"),
	],
	edges: [
		{ from: "a.md", to: "ref/api/y.md" },
		{ from: "a.md", to: "ref/api/z.md" },
		{ from: "ref/api/y.md", to: "ref/api/z.md" },
		{ from: "guides/g.md", to: "ref/x.md" },
	],
};

describe("folderAt", () => {
	test("depth 1, 2 and all; root-level docs have no folder", () => {
		expect(folderAt("ref/api/y.md", 1)).toBe("ref");
		expect(folderAt("ref/api/y.md", 2)).toBe("ref/api");
		expect(folderAt("ref/api/y.md", Number.POSITIVE_INFINITY)).toBe("ref/api");
		expect(folderAt("a.md", 1)).toBe("");
		expect(folderAt("a.md", Number.POSITIVE_INFINITY)).toBe("");
	});

	test("a folded node sits in its folder's parent", () => {
		expect(folderAt("ref/api/", Number.POSITIVE_INFINITY)).toBe("ref");
		expect(folderAt("ref/", 1)).toBe("");
	});
});

describe("foldGraph", () => {
	test("folding merges edges into weights and drops the folder's internal ones", () => {
		const v = foldGraph(GRAPH, new Set(["ref/api"]));
		expect(v.nodes.map((n) => n.path)).toEqual([
			"a.md",
			"ref/x.md",
			"ref/api/",
			"guides/g.md",
		]);
		const folder = v.nodes.find((n) => n.path === "ref/api/");
		expect(folder).toMatchObject({ title: "api/", count: 2 });
		expect(v.edges).toEqual([
			{ from: "a.md", to: "ref/api/", weight: 2 },
			{ from: "guides/g.md", to: "ref/x.md", weight: 1 },
		]);
	});

	test("an outer fold wins over an inner one", () => {
		const v = foldGraph(GRAPH, new Set(["ref", "ref/api"]));
		expect(v.nodes.map((n) => n.path)).toEqual(["a.md", "ref/", "guides/g.md"]);
		expect(v.nodes.find((n) => n.path === "ref/")?.count).toBe(3);
	});

	test("unfolding restores the original graph", () => {
		const back = foldGraph(GRAPH, new Set());
		expect(back.nodes).toEqual(GRAPH.nodes);
		expect(back.edges).toEqual(GRAPH.edges.map((e) => ({ ...e, weight: 1 })));
		// The input was never touched by the earlier fold.
		foldGraph(GRAPH, new Set(["ref"]));
		expect(GRAPH.nodes).toHaveLength(5);
	});
});

describe("groupsOf", () => {
	test("nested groups: a level-2 group knows its level-1 parent", () => {
		const g = groupsOf(GRAPH.nodes, 2);
		expect([...g.keys()].sort()).toEqual(["guides", "ref", "ref/api"]);
		expect(g.get("ref")).toEqual({
			paths: ["ref/x.md", "ref/api/y.md", "ref/api/z.md"],
			parent: null,
			level: 1,
		});
		expect(g.get("ref/api")).toMatchObject({
			paths: ["ref/api/y.md", "ref/api/z.md"],
			parent: "ref",
			level: 2,
		});
	});

	test("depth 1 stops at the top folders; root docs join no group", () => {
		const g = groupsOf(GRAPH.nodes, 1);
		expect([...g.keys()].sort()).toEqual(["guides", "ref"]);
		expect([...g.values()].some((x) => x.paths.includes("a.md"))).toBe(false);
	});

	test("a folded folder node is a member of its parent group", () => {
		const v = foldGraph(GRAPH, new Set(["ref/api"]));
		const g = groupsOf(v.nodes, Number.POSITIVE_INFINITY);
		expect(g.get("ref")?.paths).toContain("ref/api/");
		expect(g.has("ref/api")).toBe(false);
	});
});
