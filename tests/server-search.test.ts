import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { createApp, startServer } from "../src/server/index.js";

// The /api/search surface (#14) — same harness as server-m3.test.ts: a real
// git repo behind the app.

let root: string;
let server: Server;
let port: number;

beforeEach(async () => {
	root = mkdtempSync(join(tmpdir(), "fragmt-srch-"));
	execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
	execFileSync("git", ["config", "user.name", "Search Test"], { cwd: root });
	execFileSync("git", ["config", "user.email", "search@example.com"], {
		cwd: root,
	});
	mkdirSync(join(root, "docs"), { recursive: true });
	writeFileSync(
		join(root, "docs", "z.md"),
		"---\ntitle: Zebra Notes\n---\n# z\n\nplain intro\n",
	);
	writeFileSync(join(root, "docs", "other.md"), "# o\n\nunrelated\n");
	execFileSync("git", ["add", "-A"], { cwd: root });
	execFileSync("git", ["commit", "-q", "-m", "seed"], { cwd: root });

	const app = createApp({ repoRoot: root, docsRoot: "docs" });
	port = await new Promise<number>((resolve) => {
		server = startServer(app, 0, resolve);
	});
});

afterEach(() => {
	server.close();
	rmSync(root, { recursive: true, force: true });
});

function api(method: string, path: string): Promise<Response> {
	return fetch(`http://localhost:${port}${path}`, { method });
}

test("GET /api/search?q= returns the hits; short q is a 200 empty array", async () => {
	const res = await api("GET", "/api/search?q=ZEBRA");
	expect(res.status).toBe(200);
	expect(await res.json()).toEqual([
		{ path: "z.md", title: "Zebra Notes", snippet: "# z plain intro" },
	]);

	const short = await api("GET", "/api/search?q=z");
	expect(short.status).toBe(200);
	expect(await short.json()).toEqual([]);
});

test("GET /api/search without q is 400", async () => {
	const res = await api("GET", "/api/search");
	expect(res.status).toBe(400);
	expect(await res.json()).toEqual({ error: "q is required" });
});
