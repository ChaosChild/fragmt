import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { createApp, startServer } from "../src/server/index.js";

// Rung 5 server surface (#21): GET /api/graph (json default, mermaid/dot
// content types, the unknown-format 400) and GET /api/export/bundle, gated
// on okfEnabled with the {okf:false} convention. Same harness as
// server-okf.test.ts – a real git repo behind the app. Seed docs must be
// COMMITTED (the allow-list walk sees tracked files only); body edits stay
// visible uncommitted because deriveGraph reads the working tree.

let root: string;
let server: Server;
let port: number;

beforeEach(async () => {
	root = mkdtempSync(join(tmpdir(), "fragmt-graphsrv-"));
	execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
	execFileSync("git", ["config", "user.name", "Graph Test"], { cwd: root });
	execFileSync("git", ["config", "user.email", "graph@example.com"], {
		cwd: root,
	});
	execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: root });
	writeConfig(true);
	write("a.md", "---\ntype: Concept\n---\n\n# A\n\nSee [B](/b.md).\n");
	write("b.md", "---\ntype: Concept\n---\n\n# B\n");
	commit();

	const app = createApp({ repoRoot: root, docsRoot: "." });
	port = await new Promise<number>((resolve) => {
		server = startServer(app, 0, resolve);
	});
});

afterEach(() => {
	server.close();
	rmSync(root, { recursive: true, force: true });
});

/** Write .fragmt.json (fs-read per request – no commit needed). */
function writeConfig(okf: boolean) {
	writeFileSync(
		join(root, ".fragmt.json"),
		`${JSON.stringify({ docsRoot: ".", order: {}, ...(okf ? { okf: true } : {}) }, null, "\t")}\n`,
	);
}

function write(rel: string, text: string) {
	writeFileSync(join(root, rel), text);
}

function commit() {
	execFileSync("git", ["add", "-A"], { cwd: root });
	execFileSync("git", ["commit", "-q", "-m", "seed"], { cwd: root });
}

function api(method: string, path: string): Promise<Response> {
	return fetch(`http://localhost:${port}${path}`, { method });
}

// --- GET /api/graph ----------------------------------------------------------

test("GET /api/graph: the json default carries okf, generated, nodes, edges", async () => {
	const res = await api("GET", "/api/graph");
	expect(res.status).toBe(200);
	const body = (await res.json()) as {
		okf: boolean;
		generated: string;
		nodes: { path: string }[];
		edges: { from: string; to: string }[];
	};
	expect(body.okf).toBe(true);
	expect(typeof body.generated).toBe("string");
	expect(body.nodes.map((n) => n.path)).toEqual(["a.md", "b.md"]);
	expect(body.edges).toEqual([{ from: "a.md", to: "b.md" }]);
});

test("GET /api/graph?format: mermaid is plain text, dot is vnd.graphviz – bodies spot-checked", async () => {
	const mermaid = await api("GET", "/api/graph?format=mermaid");
	expect(mermaid.headers.get("content-type")).toContain("text/plain");
	const mText = await mermaid.text();
	expect(mText).toContain("%% fragmt reference graph");
	expect(mText).toContain("n0 --> n1");

	const dot = await api("GET", "/api/graph?format=dot");
	expect(dot.headers.get("content-type")).toBe(
		"text/vnd.graphviz; charset=utf-8",
	);
	expect(await dot.text()).toContain('"a.md" -> "b.md"');
});

test("GET /api/graph?format=rdf: unknown format is a 400", async () => {
	const res = await api("GET", "/api/graph?format=rdf");
	expect(res.status).toBe(400);
	expect(((await res.json()) as { error: string }).error).toContain("format");
});

test("GET /api/export/bundle: the zip rides as an attachment download", async () => {
	const res = await api("GET", "/api/export/bundle");
	expect(res.status).toBe(200);
	expect(res.headers.get("content-type")).toBe("application/zip");
	// docsRoot "." → the default name is the repo folder's own.
	const disposition = res.headers.get("content-disposition") ?? "";
	expect(disposition.startsWith('attachment; filename="fragmt-graphsrv-')).toBe(
		true,
	);
	expect(disposition.endsWith('.zip"')).toBe(true);
	const bytes = new Uint8Array(await res.arrayBuffer());
	expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([
		0x50, 0x4b, 0x03, 0x04,
	]);
});

test("non-OKF repo: {okf:false} from /api/graph, 404 from /api/export/bundle", async () => {
	writeConfig(false);
	expect(await (await api("GET", "/api/graph")).json()).toEqual({
		okf: false,
	});
	const bundle = await api("GET", "/api/export/bundle");
	expect(bundle.status).toBe(404);
	expect(await bundle.json()).toEqual({ okf: false });
});

test("freshness: an uncommitted body edit adds its edge – no git involved", async () => {
	// c.md must be tracked before the allow-list walk can see it; the a.md
	// body rewrite rides on top, uncommitted, and the next GET reads it.
	write("c.md", "---\ntype: Concept\n---\n\n# C\n");
	commit();
	write(
		"a.md",
		"---\ntype: Concept\n---\n\n# A\n\nSee [B](/b.md) and [C](/c.md).\n",
	);
	const body = (await (await api("GET", "/api/graph")).json()) as {
		edges: { from: string; to: string }[];
	};
	expect(body.edges).toEqual([
		{ from: "a.md", to: "b.md" },
		{ from: "a.md", to: "c.md" },
	]);
});
