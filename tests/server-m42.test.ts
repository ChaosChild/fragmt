import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import type { RepoMeta } from "../src/core/index.js";
import { createApp, startServer } from "../src/server/index.js";

// M4-2 server surface: /api/meta, /api/draft, /api/merge, /api/restore. Same
// harness as server-m3.test.ts — a real git repo with an identity behind the app.

let root: string;
let server: Server;
let port: number;

beforeEach(async () => {
	root = mkdtempSync(join(tmpdir(), "fragmt-m42-"));
	execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
	execFileSync("git", ["config", "user.name", "M42 Test"], { cwd: root });
	execFileSync("git", ["config", "user.email", "m42@example.com"], {
		cwd: root,
	});
	// Byte-exact assertions below need blobs to keep what we wrote
	// (comments.test.ts pattern — a host autocrlf would smudge checkouts).
	execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: root });
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

function api(method: string, path: string, body?: unknown): Promise<Response> {
	return fetch(`http://localhost:${port}${path}`, {
		method,
		headers: body === undefined ? {} : { "content-type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
}

/** Raw git against the server's repo, independent of the code under test. */
function gitOut(args: string[]): string {
	return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

test("GET /api/meta: main/current/docs/drafts/deleted, docs paths docsRoot-relative", async () => {
	const res = await api("GET", "/api/meta");
	expect(res.status).toBe(200);
	const meta = (await res.json()) as RepoMeta;
	expect(meta.main).toBe("main");
	expect(meta.current).toBe("main");
	expect(Object.keys(meta.docs)).toEqual(["a.md"]);
	expect(meta.docs["a.md"]).toMatchObject({
		author: "M42 Test",
		authorEmail: "m42@example.com",
		version: 1,
	});
	expect(meta.drafts).toEqual({});
	expect(meta.deleted).toEqual([]);
});

test("POST /api/draft: create → on-draft no-op → reuse of a touching branch from main", async () => {
	const made = await api("POST", "/api/draft", { docPath: "a.md" });
	expect(made.status).toBe(200);
	expect(await made.json()).toEqual({ current: "drafts/a", reused: false });

	// Already on the draft: any docPath is a no-op.
	const noop = await api("POST", "/api/draft", { docPath: "other.md" });
	expect(await noop.json()).toEqual({ current: "drafts/a", reused: true });

	// A real edit on the draft makes it the reuse target once back on main.
	writeFileSync(join(root, "a.md"), "# a v2\n");
	execFileSync("git", ["commit", "-qam", "draft edit"], { cwd: root });
	await api("POST", "/api/checkout", { name: "main" });
	const reuse = await api("POST", "/api/draft", { docPath: "a.md" });
	expect(await reuse.json()).toEqual({ current: "drafts/a", reused: true });
	const branches = (await (await api("GET", "/api/branches")).json()) as {
		current: string;
	};
	expect(branches.current).toBe("drafts/a");

	expect((await api("POST", "/api/draft", {})).status).toBe(400);
	expect((await api("POST", "/api/draft", { docPath: "" })).status).toBe(400);
	expect((await api("POST", "/api/draft", { docPath: 42 })).status).toBe(400);
});

test("POST /api/merge: 200 {sha}, branch gone, back on main; on main → 400", async () => {
	await api("POST", "/api/draft", { docPath: "a.md" });
	writeFileSync(join(root, "a.md"), "# a v2\n");
	execFileSync("git", ["commit", "-qam", "draft edit"], { cwd: root });

	const res = await api("POST", "/api/merge");
	expect(res.status).toBe(200);
	const { sha } = (await res.json()) as { sha: string };
	expect(sha).toMatch(/^[0-9a-f]{40}$/);
	expect(await (await api("GET", "/api/branches")).json()).toEqual({
		current: "main",
		branches: ["main"],
	});
	expect(readFileSync(join(root, "a.md"), "utf8")).toBe("# a v2\n");

	expect((await api("POST", "/api/merge")).status).toBe(400);
});

test("POST /api/merge: diverged main → 409 {conflict:true}, still on the draft, tree clean", async () => {
	await api("POST", "/api/draft", { docPath: "a.md" });
	writeFileSync(join(root, "a.md"), "# draft\n");
	execFileSync("git", ["commit", "-qam", "draft edit"], { cwd: root });
	await api("POST", "/api/checkout", { name: "main" });
	writeFileSync(join(root, "a.md"), "# main\n");
	execFileSync("git", ["commit", "-qam", "main edit"], { cwd: root });
	await api("POST", "/api/checkout", { name: "drafts/a" });

	const res = await api("POST", "/api/merge");
	expect(res.status).toBe(409);
	const body = (await res.json()) as { conflict: boolean; message?: string };
	expect(body.conflict).toBe(true);
	expect(body.message ?? "").toMatch(/CONFLICT/);
	const branches = (await (await api("GET", "/api/branches")).json()) as {
		current: string;
	};
	expect(branches.current).toBe("drafts/a");
	expect(gitOut(["status", "--porcelain"])).toBe("");
	expect(readFileSync(join(root, "a.md"), "utf8")).toBe("# draft\n");
});

test("POST /api/restore: 200 {sha} + file back on disk; 409 when it exists; 400 on traversal", async () => {
	const del = await api("DELETE", "/api/docs/a.md");
	expect(del.status).toBe(200);
	const { sha: deleteSha } = (await del.json()) as { sha: string };

	// The bin carries the delete commit restore is about to read from.
	const meta = (await (await api("GET", "/api/meta")).json()) as RepoMeta;
	expect(meta.deleted).toEqual([
		{ path: "a.md", sha: deleteSha, date: expect.any(String) },
	]);

	const res = await api("POST", "/api/restore", {
		path: "a.md",
		sha: deleteSha,
	});
	expect(res.status).toBe(200);
	const { sha } = (await res.json()) as { sha: string };
	expect(sha).toMatch(/^[0-9a-f]{40}$/);
	expect(readFileSync(join(root, "a.md"), "utf8")).toBe(
		"---\ntitle: A\n---\n# body\n",
	);
	// seed + delete + exactly one restore commit
	expect(gitOut(["rev-list", "--count", "HEAD"])).toBe("3");

	expect(
		(await api("POST", "/api/restore", { path: "a.md", sha: deleteSha }))
			.status,
	).toBe(409);
	expect(
		(await api("POST", "/api/restore", { path: "../evil.md", sha: deleteSha }))
			.status,
	).toBe(400);
});
