// OKF rung 5 core (#21): deriveGraph over the shared enumeration – body
// links as edges, reserved files out in both directions, broken links and
// unreadable docs skipped, isolated docs kept, exact parity with the
// frontmatter fields after a fix – plus the three renderers (positional
// Mermaid ids, JSON.stringify'd titles, deterministic ordering). Plain tmp
// dirs for the walks; the parity test needs a real repo (files.test.ts
// pattern).
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import {
	type DocGraph,
	deriveGraph,
	graphToDot,
	graphToJson,
	graphToMermaid,
} from "../src/core/graph.js";
import { fixOkf, readDoc, refsList } from "../src/core/index.js";

let root: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "fragmt-graph-"));
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

const write = (rel: string, text: string) => {
	mkdirSync(dirname(join(root, rel)), { recursive: true });
	writeFileSync(join(root, rel), text);
};

// --- deriveGraph (plain tmp dirs: the allow-list walk falls back) -----------

test("edges match the references/referenced-by fields fixOkf populated", async () => {
	const r = mkdtempSync(join(tmpdir(), "fragmt-graph-git-"));
	for (const args of [
		["init", "-q", "-b", "main"],
		["config", "user.name", "Graph Test"],
		["config", "user.email", "graph@example.com"],
		["config", "core.autocrlf", "false"],
	])
		execFileSync("git", args, { cwd: r });
	const put = (rel: string, text: string) => {
		mkdirSync(dirname(join(r, rel)), { recursive: true });
		writeFileSync(join(r, rel), text);
	};
	// Both §6.1 forms ride along: bundle-absolute from a.md, relative from c.
	put(
		"a.md",
		"---\ntype: Concept\n---\n\n# A\n\nSee [B](/b.md) and [C](/sub/c.md).\n",
	);
	put("b.md", "---\ntype: Concept\n---\n\n# B\n");
	put("sub/c.md", "---\ntype: Concept\n---\n\n# C\n\nBack to [A](../a.md).\n");
	execFileSync("git", ["add", "-A"], { cwd: r });
	execFileSync("git", ["commit", "-q", "-m", "seed"], { cwd: r });

	await fixOkf(r, ".");

	const g = await deriveGraph(r, ".");
	expect(g.nodes.map((n) => n.path)).toEqual(["a.md", "b.md", "sub/c.md"]);
	expect(g.edges).toEqual([
		{ from: "a.md", to: "b.md" },
		{ from: "a.md", to: "sub/c.md" },
		{ from: "sub/c.md", to: "a.md" },
	]);
	// The same edge set both directions, read from the frontmatter the fix
	// wrote – the graph derives from the bodies, and the fields agree.
	for (const n of g.nodes) {
		const fm = readDoc(r, ".", n.path).frontmatter;
		expect(g.edges.filter((e) => e.from === n.path).map((e) => e.to)).toEqual(
			refsList(fm.references),
		);
		expect(g.edges.filter((e) => e.to === n.path).map((e) => e.from)).toEqual(
			refsList(fm["referenced-by"]),
		);
	}
	rmSync(r, { recursive: true, force: true });
});

test("reserved files are excluded in both directions: an index.md full of links makes no edges", async () => {
	write("a.md", "---\ntype: Concept\n---\n\n[idx](/index.md)\n");
	write("index.md", "# Index\n\n* [A](/a.md)\n* [gone](/nope.md)\n");
	const g = await deriveGraph(root, ".");
	expect(g.nodes.map((n) => n.path)).toEqual(["a.md"]);
	expect(g.edges).toEqual([]);
});

test("broken links are skipped; isolated docs stay in as nodes", async () => {
	write("a.md", "---\ntype: Concept\n---\n\n[gone](/gone.md), [b](/b.md)\n");
	write("b.md", "---\ntype: Concept\n---\n\n# B\n");
	const g = await deriveGraph(root, ".");
	expect(g.nodes.map((n) => n.path)).toEqual(["a.md", "b.md"]);
	expect(g.edges).toEqual([{ from: "a.md", to: "b.md" }]);
});

test("an unreadable doc vanishes from nodes AND edges", async () => {
	write("a.md", "---\ntype: Concept\n---\n\n[broken](/broken.md)\n");
	write("broken.md", "---\ntitle: [unclosed\n---\n# body\n");
	const g = await deriveGraph(root, ".");
	expect(g.nodes.map((n) => n.path)).toEqual(["a.md"]);
	expect(g.edges).toEqual([]);
});

test("nodes sort by path, edges by from then to, duplicate links deduped", async () => {
	write(
		"z.md",
		"---\ntype: Concept\n---\n\n[b](/b.md), [c](/sub/c.md), [b again](/b.md)\n",
	);
	write("b.md", "---\ntype: Concept\n---\n\n[a](/a.md) and [c](sub/c.md)\n");
	write("sub/c.md", "---\ntype: Concept\n---\n\n[b](../b.md)\n");
	write("a.md", "---\ntype: Concept\n---\n\n# A\n");
	const g = await deriveGraph(root, ".");
	expect(g.nodes.map((n) => n.path)).toEqual([
		"a.md",
		"b.md",
		"sub/c.md",
		"z.md",
	]);
	expect(g.edges).toEqual([
		{ from: "b.md", to: "a.md" },
		{ from: "b.md", to: "sub/c.md" },
		{ from: "sub/c.md", to: "b.md" },
		{ from: "z.md", to: "b.md" },
		{ from: "z.md", to: "sub/c.md" },
	]);
});

test("node encoding: title fallback, type/status nulls, tier, stale", async () => {
	write("plain.md", "# Plain\n");
	write("blank.md", '---\ntype: ""\nstatus: 42\n---\n# B\n');
	write(
		"reviewed.md",
		'---\ntype: Playbook\ntitle: Reviewed Doc\nstatus: "stable"\nverified:\n  - by: "human:chaos"\n    at: 2026-01-01\nstale_after: 2020-01-01\n---\n\n# R\n',
	);
	write(
		"machine.md",
		'---\ntype: Concept\nverified:\n  - by: "ci-agent/1"\n---\n\n# M\n',
	);
	const g = await deriveGraph(root, ".");
	const byPath = new Map(g.nodes.map((n) => [n.path, n]));
	expect(byPath.get("plain.md")).toEqual({
		path: "plain.md",
		title: "plain",
		type: null,
		status: null,
		tier: "unverified",
		stale: false,
	});
	expect(byPath.get("blank.md")?.type).toBe(null);
	expect(byPath.get("blank.md")?.status).toBe(null);
	expect(byPath.get("reviewed.md")).toEqual({
		path: "reviewed.md",
		title: "Reviewed Doc",
		type: "Playbook",
		status: "stable",
		tier: "human-reviewed",
		stale: true,
	});
	expect(byPath.get("machine.md")?.tier).toBe("machine-confirmed");
});

// --- renderers (pure functions over a fixture graph) -------------------------

const QUOTED = 'Quote " and \\ back';
const RENDER: DocGraph = {
	nodes: [
		{
			path: "a.md",
			title: QUOTED,
			type: "concept",
			status: "draft",
			tier: "unverified",
			stale: false,
		},
		{
			path: "b.md",
			title: "B",
			type: null,
			status: null,
			tier: "unverified",
			stale: false,
		},
		{
			path: "sub/c.md",
			title: "C",
			type: null,
			status: null,
			tier: "unverified",
			stale: false,
		},
	],
	edges: [
		{ from: "a.md", to: "b.md" },
		{ from: "a.md", to: "sub/c.md" },
	],
};

test("graphToMermaid pins the header, positional ids, and escaped titles", () => {
	expect(graphToMermaid(RENDER, new Date("2026-09-18T12:34:56.789Z"))).toBe(
		[
			"%% fragmt reference graph — 2026-09-18 — 3 docs · 2 links",
			"flowchart LR",
			'  n0["Quote \\" and \\\\ back"]',
			'  n1["B"]',
			'  n2["C"]',
			"  n0 --> n1",
			"  n0 --> n2",
			"",
		].join("\n"),
	);
});

test("graphToDot quotes paths as ids and JSON-escaped titles as labels", () => {
	expect(graphToDot(RENDER)).toBe(
		[
			"digraph fragmt {",
			"  rankdir=LR;",
			'  "a.md" [label="Quote \\" and \\\\ back"];',
			'  "b.md" [label="B"];',
			'  "sub/c.md" [label="C"];',
			'  "a.md" -> "b.md";',
			'  "a.md" -> "sub/c.md";',
			"}",
			"",
		].join("\n"),
	);
});

test("graphToJson is the plain { generated, nodes, edges } object", () => {
	const generated = new Date("2026-09-18T12:34:56.789Z");
	expect(graphToJson(RENDER, generated)).toEqual({
		generated: "2026-09-18T12:34:56.789Z",
		nodes: RENDER.nodes,
		edges: RENDER.edges,
	});
});
