import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { createApp, startServer } from "../src/server/index.js";

// PUT /api/docs/* — the write path. Needs a real git repo with an identity,
// unlike the read-only tests in server.test.ts.

let root: string;
let server: Server;
let port: number;

beforeEach(async () => {
	root = mkdtempSync(join(tmpdir(), "fragmt-put-"));
	execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
	execFileSync("git", ["config", "user.name", "Put Test"], { cwd: root });
	execFileSync("git", ["config", "user.email", "put@example.com"], {
		cwd: root,
	});
	writeFileSync(join(root, "a.md"), "---\ntitle: A\n---\n# body\n");
	execFileSync("git", ["add", "-A"], { cwd: root });
	execFileSync("git", ["commit", "-q", "-m", "seed"], { cwd: root });

	const app = createApp({ repoRoot: root, docsRoot: "." });
	port = await new Promise<number>((resolve) => {
		server = startServer(app, 0, resolve);
	});
});

afterEach(() => {
	server.close();
	rmSync(root, { recursive: true, force: true });
});

function put(path: string, body: unknown): Promise<Response> {
	return fetch(`http://localhost:${port}/api/docs/${path}`, {
		method: "PUT",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

test("GET now carries a hash that PUT accepts as baseHash", async () => {
	const res = await fetch(`http://localhost:${port}/api/docs/a.md`);
	const doc = (await res.json()) as { markdown: string; hash: string };
	expect(doc.hash).toMatch(/^[0-9a-f]{64}$/);

	const saved = await put("a.md", {
		markdown: "# body, edited\n",
		baseHash: doc.hash,
	});
	expect(saved.status).toBe(200);
	const body = (await saved.json()) as { sha: string; hash: string };
	expect(body.sha).toMatch(/^[0-9a-f]{40}$/);
	expect(body.hash).toMatch(/^[0-9a-f]{64}$/);
	expect(body.hash).not.toBe(doc.hash);

	// The commit actually happened, with the local identity.
	const log = execFileSync("git", ["log", "-1", "--format=%an|%s"], {
		cwd: root,
		encoding: "utf8",
	}).trim();
	expect(log).toBe("Put Test|Update a.md");
});

test("a stale baseHash is 409 and does not overwrite", async () => {
	const res = await put("a.md", {
		markdown: "# overwrite\n",
		baseHash: "deadbeef".repeat(8),
	});
	expect(res.status).toBe(409);
	const body = (await res.json()) as { error: string };
	expect(body.error).toContain("reload");
});

test("traversal is 400 on the write path too", async () => {
	const res = await put("..%2fsecret.md", {
		markdown: "# no\n",
		baseHash: "x",
	});
	expect(res.status).toBe(400);
});

test("a missing doc is 404", async () => {
	const res = await put("nope.md", { markdown: "# x\n", baseHash: "x" });
	expect(res.status).toBe(404);
});

test("a malformed body is 400", async () => {
	const res = await fetch(`http://localhost:${port}/api/docs/a.md`, {
		method: "PUT",
		headers: { "content-type": "application/json" },
		body: "{ not json",
	});
	expect(res.status).toBe(400);
});
