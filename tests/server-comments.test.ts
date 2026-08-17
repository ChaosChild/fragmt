import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import type { CommentFile, CommentThread } from "../src/core/index.js";
import { createApp, startServer } from "../src/server/index.js";

// M4 server surface: the comment sidecar routes. Same harness as
// server-m3.test.ts — a real git repo with an identity behind the app.

let root: string;
let server: Server;
let port: number;

beforeEach(async () => {
	root = mkdtempSync(join(tmpdir(), "fragmt-m4-"));
	execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
	execFileSync("git", ["config", "user.name", "M4 Test"], { cwd: root });
	execFileSync("git", ["config", "user.email", "m4@example.com"], {
		cwd: root,
	});
	writeFileSync(join(root, "a.md"), "---\ntitle: A\n---\n# body\n");
	mkdirSync(join(root, "notes"), { recursive: true });
	writeFileSync(join(root, "notes/n.md"), "# nested\n");
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

/** The sidecar threads for a doc, via GET (works with no sidecar too). */
async function threads(docPath: string): Promise<CommentFile["comments"]> {
	const res = await api("GET", `/api/docs/${docPath}/comments`);
	return ((await res.json()) as CommentFile).comments;
}

async function seedThread(
	docPath = "a.md",
	id = "id-1",
): Promise<CommentThread> {
	await api("POST", `/api/docs/${docPath}/comments`, {
		id,
		quote: "marked text",
		body: "first!",
	});
	return (await threads(docPath))[id] as CommentThread;
}

test("GET comments on a doc with no sidecar is 200 {comments:{}}", async () => {
	const res = await api("GET", "/api/docs/a.md/comments");
	expect(res.status).toBe(200);
	expect(await res.json()).toEqual({ comments: {} });
});

test("POST creates a thread: sidecar on disk, one commit, readable back", async () => {
	const res = await api("POST", "/api/docs/a.md/comments", {
		id: "id-1",
		quote: "marked text",
		body: "first!",
	});
	expect(res.status).toBe(200);
	expect(((await res.json()) as { sha: string }).sha).toMatch(/^[0-9a-f]{40}$/);

	expect(existsSync(join(root, ".docs/comments/a.md.json"))).toBe(true);
	const commits = execFileSync("git", ["rev-list", "--count", "HEAD"], {
		cwd: root,
		encoding: "utf8",
	}).trim();
	expect(commits).toBe("2"); // seed + exactly one sidecar commit

	const thread = (await threads("a.md"))["id-1"];
	expect(thread).toMatchObject({
		id: "id-1",
		quote: "marked text",
		author: "M4 Test",
		resolved: false,
	});
	expect(thread?.replies).toHaveLength(1);
	expect(thread?.replies[0]).toMatchObject({
		author: "M4 Test",
		body: "first!",
	});
});

test("PATCH reply appends to the thread in one commit", async () => {
	await seedThread();
	const res = await api("PATCH", "/api/docs/a.md/comments/id-1", {
		reply: "a reply",
	});
	expect(res.status).toBe(200);
	expect(((await res.json()) as { sha: string }).sha).toMatch(/^[0-9a-f]{40}$/);
	const replies = (await threads("a.md"))["id-1"]?.replies;
	expect(replies).toHaveLength(2);
	expect(replies?.[1]).toMatchObject({ author: "M4 Test", body: "a reply" });
});

test("PATCH resolved:true resolves the thread", async () => {
	await seedThread();
	const res = await api("PATCH", "/api/docs/a.md/comments/id-1", {
		resolved: true,
	});
	expect(res.status).toBe(200);
	expect(((await res.json()) as { sha: string }).sha).toMatch(/^[0-9a-f]{40}$/);
	expect((await threads("a.md"))["id-1"]?.resolved).toBe(true);
});

test("PATCH body edits the opening comment (replies[0])", async () => {
	await seedThread();
	const res = await api("PATCH", "/api/docs/a.md/comments/id-1", {
		body: "edited opening",
	});
	expect(res.status).toBe(200);
	const replies = (await threads("a.md"))["id-1"]?.replies;
	expect(replies).toHaveLength(1); // an edit, not another reply
	expect(replies?.[0].body).toBe("edited opening");
});

test("PATCH with no field, several fields, or resolved:false is 400", async () => {
	await seedThread();
	const url = "/api/docs/a.md/comments/id-1";
	expect((await api("PATCH", url, {})).status).toBe(400);
	expect((await api("PATCH", url, { resolved: true, reply: "x" })).status).toBe(
		400,
	);
	expect((await api("PATCH", url, { body: "x", reply: "y" })).status).toBe(400);
	const res = await api("PATCH", url, { resolved: false });
	expect(res.status).toBe(400);
	expect(((await res.json()) as { error: string }).error).toContain("true");
	expect((await threads("a.md"))["id-1"]?.resolved).toBe(false);
});

test("DELETE removes the thread; a second DELETE is 404", async () => {
	await seedThread();
	const res = await api("DELETE", "/api/docs/a.md/comments/id-1");
	expect(res.status).toBe(200);
	expect(((await res.json()) as { sha: string }).sha).toMatch(/^[0-9a-f]{40}$/);
	expect(await threads("a.md")).toEqual({});
	expect((await api("DELETE", "/api/docs/a.md/comments/id-1")).status).toBe(
		404,
	);
});

test("PATCH/DELETE on a thread or sidecar that never existed is 404", async () => {
	expect(
		(await api("PATCH", "/api/docs/a.md/comments/nope", { resolved: true }))
			.status,
	).toBe(404);
	expect((await api("DELETE", "/api/docs/a.md/comments/nope")).status).toBe(
		404,
	);
});

test("a traversal docPath is 400 on the comments routes", async () => {
	expect((await api("GET", "/api/docs/..%2fsecret.md/comments")).status).toBe(
		400,
	);
	expect(
		(
			await api("POST", "/api/docs/..%2fsecret.md/comments", {
				id: "x",
				quote: "q",
				body: "b",
			})
		).status,
	).toBe(400);
});

test("an id containing a slash (or empty) is 400", async () => {
	expect(
		(await api("PATCH", "/api/docs/a.md/comments/a/b", { resolved: true }))
			.status,
	).toBe(400);
	expect((await api("DELETE", "/api/docs/a.md/comments/a/b")).status).toBe(400);
	expect((await api("DELETE", "/api/docs/a.md/comments/")).status).toBe(400);
});

test("a nested docPath reaches the comments routes, not the doc wildcard", async () => {
	expect((await api("GET", "/api/docs/notes/n.md/comments")).status).toBe(200);
	const res = await api("POST", "/api/docs/notes/n.md/comments", {
		id: "n-1",
		quote: "q",
		body: "b",
	});
	expect(res.status).toBe(200);
	expect(existsSync(join(root, ".docs/comments/notes/n.md.json"))).toBe(true);
	expect(Object.keys(await threads("notes/n.md"))).toEqual(["n-1"]);
	// The doc itself still reads through the plain wildcard.
	expect((await api("GET", "/api/docs/notes/n.md")).status).toBe(200);
});

test("POST validates its payload: missing/untyped fields, slash-bearing id", async () => {
	const url = "/api/docs/a.md/comments";
	expect((await api("POST", url, { id: "x", quote: "q" })).status).toBe(400);
	expect(
		(await api("POST", url, { id: 7, quote: "q", body: "b" })).status,
	).toBe(400);
	expect(
		(await api("POST", url, { id: "a/b", quote: "q", body: "b" })).status,
	).toBe(400);
	expect(await threads("a.md")).toEqual({}); // nothing was written
});
