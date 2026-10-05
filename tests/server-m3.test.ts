import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import type { TreeNode } from "../src/core/index.js";
import { createApp, startServer } from "../src/server/index.js";

// M3 server surface: doc/folder lifecycle, branches, sync. Same harness as
// server-write.test.ts – a real git repo with an identity behind the app.

let root: string;
let server: Server;
let port: number;

beforeEach(async () => {
	root = mkdtempSync(join(tmpdir(), "fragmt-m3-"));
	execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
	execFileSync("git", ["config", "user.name", "M3 Test"], { cwd: root });
	execFileSync("git", ["config", "user.email", "m3@example.com"], {
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

function api(method: string, path: string, body?: unknown): Promise<Response> {
	return fetch(`http://localhost:${port}${path}`, {
		method,
		headers: body === undefined ? {} : { "content-type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
}

async function tree(): Promise<TreeNode> {
	return (await (await api("GET", "/api/tree")).json()) as TreeNode;
}

// --- #54: /api/sync against a real origin ----------------------------------

/** A bare origin with root's main pushed, plus a twin clone that can move
 *  origin/main forward the way another writer would. */
function withOrigin(): { origin: string; twin: string } {
	const origin = mkdtempSync(join(tmpdir(), "fragmt-m3-origin-"));
	execFileSync("git", ["init", "-q", "--bare", "-b", "main"], { cwd: origin });
	execFileSync("git", ["remote", "add", "origin", origin], { cwd: root });
	execFileSync("git", ["push", "-q", "-u", "origin", "main"], { cwd: root });
	const twin = mkdtempSync(join(tmpdir(), "fragmt-m3-twin-"));
	execFileSync(
		"git",
		["-c", "core.autocrlf=false", "clone", "-q", origin, "."],
		{
			cwd: twin,
		},
	);
	for (const args of [
		["config", "user.name", "Twin"],
		["config", "user.email", "twin@example.com"],
		["config", "core.autocrlf", "false"],
	])
		execFileSync("git", args, { cwd: twin });
	return { origin, twin };
}

/** Twin commits and pushes one file – origin/main is one ahead of root. */
function twinPushes(twin: string): void {
	writeFileSync(join(twin, "twin.md"), "# twin\n");
	execFileSync("git", ["add", "-A"], { cwd: twin });
	execFileSync("git", ["commit", "-q", "-m", "twin commit"], { cwd: twin });
	execFileSync("git", ["push", "-q", "origin", "main"], { cwd: twin });
}

test("#54: /api/sync fast-forwards a behind main while a draft is checked out", {
	timeout: 20_000,
}, async () => {
	execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: root });
	const { origin, twin } = withOrigin();
	twinPushes(twin);
	// The edit-entry dance: an empty drafts branch checked out, main stale.
	execFileSync("git", ["checkout", "-q", "-b", "drafts/doc"], { cwd: root });

	const res = await api("POST", "/api/sync");
	expect(res.status).toBe(200);
	expect(await res.json()).toEqual({
		conflict: false,
		ff: { branch: "main", commits: 1 },
	});

	const originMain = execFileSync("git", ["rev-parse", "refs/heads/main"], {
		cwd: origin,
		encoding: "utf8",
	}).trim();
	expect(
		execFileSync("git", ["rev-parse", "main"], {
			cwd: root,
			encoding: "utf8",
		}).trim(),
	).toBe(originMain);
});

test("#54: /api/sync answers 409 {diverged:true} when main diverged behind a draft", {
	timeout: 20_000,
}, async () => {
	execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: root });
	const { origin, twin } = withOrigin();
	twinPushes(twin);
	// root: a local-only main commit, then a draft checked out.
	writeFileSync(join(root, "mine.md"), "# mine\n");
	execFileSync("git", ["add", "-A"], { cwd: root });
	execFileSync("git", ["commit", "-q", "-m", "mine"], { cwd: root });
	execFileSync("git", ["checkout", "-q", "-b", "drafts/doc"], { cwd: root });

	const res = await api("POST", "/api/sync");
	expect(res.status).toBe(409);
	const body = (await res.json()) as {
		error?: string;
		diverged?: boolean;
		branches?: string[];
	};
	expect(body.diverged).toBe(true);
	expect(body.branches).toEqual(["main"]);
	expect(body.error).toContain("Switch to main and sync");

	// origin still holds the twin's side – nothing was force-pushed.
	const originMain = execFileSync("git", ["rev-parse", "refs/heads/main"], {
		cwd: origin,
		encoding: "utf8",
	}).trim();
	expect(originMain).toBe(
		execFileSync("git", ["rev-parse", "HEAD"], {
			cwd: twin,
			encoding: "utf8",
		}).trim(),
	);
});

/** Raw HTTP status – `fetch` collapses `..` before it reaches the server guard. */
function rawStatus(method: string, path: string): Promise<number> {
	return new Promise((resolve, reject) => {
		const socket = connect(port, "127.0.0.1", () => {
			socket.write(
				`${method} ${path} HTTP/1.1\r\nHost: t\r\nConnection: close\r\n\r\n`,
			);
		});
		let raw = "";
		socket.on("data", (chunk) => {
			raw += chunk;
		});
		socket.on("error", reject);
		socket.on("end", () => {
			resolve(Number(raw.split(" ")[1]));
		});
	});
}

test("a raw ..%2f escape under /api/folders/* is 400 before normalization", async () => {
	expect(await rawStatus("PATCH", "/api/folders/..%2fx")).toBe(400);
	expect(await rawStatus("DELETE", "/api/folders/..%2fsecret")).toBe(400);
});

test("POST /api/docs creates a doc in one commit; a duplicate is 409", async () => {
	const res = await api("POST", "/api/docs", {
		path: "new.md",
		body: "# fresh\n",
	});
	expect(res.status).toBe(200);
	const { sha } = (await res.json()) as { sha: string };
	expect(sha).toMatch(/^[0-9a-f]{40}$/);

	expect((await api("GET", "/api/docs/new.md")).status).toBe(200);
	const commits = execFileSync("git", ["rev-list", "--count", "HEAD"], {
		cwd: root,
		encoding: "utf8",
	}).trim();
	expect(commits).toBe("2"); // seed + exactly one create commit

	expect((await api("POST", "/api/docs", { path: "new.md" })).status).toBe(409);
});

test("PATCH /api/docs/* moves; the old path 404s, the new one reads; traversal `to` is 400", async () => {
	const res = await api("PATCH", "/api/docs/a.md", { to: "moved/b.md" });
	expect(res.status).toBe(200);
	expect(((await res.json()) as { sha: string }).sha).toMatch(/^[0-9a-f]{40}$/);

	expect((await api("GET", "/api/docs/a.md")).status).toBe(404);
	expect((await api("GET", "/api/docs/moved/b.md")).status).toBe(200);

	const evil = await api("PATCH", "/api/docs/moved/b.md", { to: "../evil.md" });
	expect(evil.status).toBe(400);
	expect((await api("GET", "/api/docs/moved/b.md")).status).toBe(200);
});

test("DELETE /api/docs/* removes the doc", async () => {
	const res = await api("DELETE", "/api/docs/a.md");
	expect(res.status).toBe(200);
	expect(((await res.json()) as { sha: string }).sha).toMatch(/^[0-9a-f]{40}$/);
	expect((await api("GET", "/api/docs/a.md")).status).toBe(404);
});

test("folder lifecycle via /api/folders carries its docs along; .gitkeep never lists", async () => {
	expect((await api("POST", "/api/folders", { path: "notes" })).status).toBe(
		200,
	);
	expect(
		(await api("POST", "/api/docs", { path: "notes/n.md", body: "# n\n" }))
			.status,
	).toBe(200);

	expect(JSON.stringify(await tree())).not.toContain(".gitkeep");
	expect((await tree()).children?.map((n) => n.path)).toContain("notes");

	expect(
		(await api("PATCH", "/api/folders/notes", { to: "journal" })).status,
	).toBe(200);
	expect((await api("GET", "/api/docs/notes/n.md")).status).toBe(404);
	expect((await api("GET", "/api/docs/journal/n.md")).status).toBe(200);

	expect((await api("DELETE", "/api/folders/journal")).status).toBe(200);
	expect((await api("GET", "/api/docs/journal/n.md")).status).toBe(404);
	expect((await tree()).children?.map((n) => n.path)).toEqual(["a.md"]);
});

test("branch endpoints: list, create+switch (with base), switch back", async () => {
	const list = await api("GET", "/api/branches");
	expect(list.status).toBe(200);
	expect(await list.json()).toEqual({
		current: "main",
		branches: ["main"],
		merged: ["main"],
	});

	const created = await api("POST", "/api/branches", { name: "drafts/x" });
	expect(created.status).toBe(200);
	expect(await created.json()).toEqual({ current: "drafts/x" });
	expect(await (await api("GET", "/api/branches")).json()).toEqual({
		current: "drafts/x",
		branches: ["drafts/x", "main"],
		merged: ["drafts/x", "main"],
	});

	const based = await api("POST", "/api/branches", {
		name: "from-main",
		base: "main",
	});
	expect(based.status).toBe(200);
	expect(await based.json()).toEqual({ current: "from-main" });

	const back = await api("POST", "/api/checkout", { name: "main" });
	expect(back.status).toBe(200);
	expect(await back.json()).toEqual({ current: "main" });
});

test.each(["", "has space", "a..b", "-lead"])(
	"POST /api/branches rejects %j with 400",
	async (name) => {
		const res = await api("POST", "/api/branches", { name });
		expect(res.status).toBe(400);
	},
);

test("POST /api/checkout without a name is 400", async () => {
	expect((await api("POST", "/api/checkout", {})).status).toBe(400);
});

test("POST /api/sync on a repo with no remote is a clean no-op", async () => {
	const res = await api("POST", "/api/sync");
	expect(res.status).toBe(200);
	expect(await res.json()).toEqual({ conflict: false });
});

test("concurrent writes queue: three syncs at once against a moved origin all succeed", {
	timeout: 30_000,
}, async () => {
	const git = (cwd: string, args: string[]) =>
		execFileSync("git", args, { cwd, encoding: "utf8" });
	const origin = mkdtempSync(join(tmpdir(), "fragmt-m3-origin-"));
	const other = mkdtempSync(join(tmpdir(), "fragmt-m3-other-"));
	try {
		git(origin, ["init", "-q", "--bare", "-b", "main"]);
		git(root, ["remote", "add", "origin", origin]);
		git(root, ["push", "-q", "-u", "origin", "main"]);
		git(other, ["clone", "-q", origin, "."]);
		git(other, ["config", "user.name", "Other"]);
		git(other, ["config", "user.email", "other@example.com"]);
		for (let i = 0; i < 3; i++) {
			writeFileSync(join(other, `o${i}.md`), `# o${i}\n`);
			git(other, ["add", "-A"]);
			git(other, ["commit", "-q", "-m", `o${i}`]);
			git(other, ["push", "-q"]);
			// Unserialized, the second pull sees the first one's rebase
			// mid-flight: "cannot pull with rebase: You have unstaged changes".
			const res = await Promise.all(
				[1, 2, 3].map(() => api("POST", "/api/sync")),
			);
			expect(res.map((r) => r.status)).toEqual([200, 200, 200]);
		}
		expect(git(root, ["status", "--porcelain"]).trim()).toBe("");
	} finally {
		rmSync(origin, { recursive: true, force: true });
		rmSync(other, { recursive: true, force: true });
	}
});
