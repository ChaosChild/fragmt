import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import type { Server } from "node:http";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { createApp, startServer } from "../src/server/index.js";

// M4-3 server surface: DELETE /api/branches/:name, PATCH /api/docs/* {title}.
// Same harness as server-m42.test.ts – a real git repo with an identity
// behind the app.

let root: string;
let server: Server;
let port: number;

beforeEach(async () => {
	root = mkdtempSync(join(tmpdir(), "fragmt-m43-"));
	execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
	execFileSync("git", ["config", "user.name", "M43 Test"], { cwd: root });
	execFileSync("git", ["config", "user.email", "m43@example.com"], {
		cwd: root,
	});
	execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: root });
	writeFileSync(join(root, "a.md"), "# body\n");
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

function api(method: string, path: string): Promise<Response> {
	return fetch(`http://localhost:${port}${path}`, { method });
}

/** PATCH with a JSON body – the doc route's two-way dispatch ({to}/{title}). */
function patchDoc(path: string, body: unknown): Promise<Response> {
	return fetch(`http://localhost:${port}${path}`, {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

/** Raw git against the server's repo, independent of the code under test. */
function gitOut(args: string[]): string {
	return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

/**
 * Raw HTTP request (server.test.ts's pattern) – `fetch` collapses `..` in the
 * path client-side, so the traversal guard needs a socket to be reached.
 */
function rawGet(path: string): Promise<{ status: number; body: string }> {
	return new Promise((resolve, reject) => {
		const socket = connect(port, "127.0.0.1", () => {
			socket.write(
				`GET ${path} HTTP/1.1\r\nHost: t\r\nConnection: close\r\n\r\n`,
			);
		});
		let raw = "";
		socket.on("data", (chunk) => {
			raw += chunk;
		});
		socket.on("error", reject);
		socket.on("end", () => {
			resolve({
				status: Number(raw.split(" ")[1]),
				body: raw.split("\r\n\r\n").slice(1).join("\r\n\r\n"),
			});
		});
	});
}

test("DELETE /api/branches: merged branch gone, still on current; slashed names OK", async () => {
	gitOut(["branch", "feature"]);
	gitOut(["branch", "drafts/a"]);

	const res = await api("DELETE", "/api/branches/feature");
	expect(res.status).toBe(200);
	expect(await res.json()).toEqual({ ok: true });

	// Slashed names arrive percent-encoded – one router segment, decoded
	// back by the param (the api.ts helper always encodeURIComponent's).
	const slashed = await api("DELETE", "/api/branches/drafts%2Fa");
	expect(slashed.status).toBe(200);
	expect(await slashed.json()).toEqual({ ok: true });

	expect((await (await api("GET", "/api/branches")).json()).branches).toEqual([
		"main",
	]);
	expect(gitOut(["rev-parse", "--abbrev-ref", "HEAD"])).toBe("main");
});

test("DELETE /api/branches: current branch → 400 switch away first", async () => {
	const res = await api("DELETE", "/api/branches/main");
	expect(res.status).toBe(400);
	const body = (await res.json()) as { error: string };
	expect(body.error).toBe("switch away first");
	expect(gitOut(["branch", "--list", "main"])).not.toBe("");
});

test("DELETE /api/branches: bad name → 400", async () => {
	// Space and embedded ".." never reach git (badBranchName rejects both).
	expect((await api("DELETE", "/api/branches/a%20b")).status).toBe(400);
	expect((await api("DELETE", "/api/branches/a..b")).status).toBe(400);
	expect(
		gitOut(["for-each-ref", "refs/heads", "--format=%(refname:short)"]),
	).toBe("main"); // nothing was created
});

test("DELETE /api/branches: unmerged → 409 {unmerged:true}; force → 200", async () => {
	gitOut(["checkout", "-q", "-b", "drafts/w"]);
	writeFileSync(join(root, "b.md"), "# b\n");
	gitOut(["add", "-A"]);
	gitOut(["commit", "-q", "-m", "draft work"]);
	gitOut(["checkout", "-q", "main"]);

	const blocked = await api("DELETE", "/api/branches/drafts%2Fw");
	expect(blocked.status).toBe(409);
	const body = (await blocked.json()) as { unmerged: boolean; error: string };
	expect(body.unmerged).toBe(true);
	expect(body.error).toMatch(/not fully merged/i);
	// Refused without force – the branch survives to be force-deleted.
	expect(gitOut(["branch", "--list", "drafts/w"])).not.toBe("");

	const forced = await api("DELETE", "/api/branches/drafts%2Fw?force=1");
	expect(forced.status).toBe(200);
	expect(await forced.json()).toEqual({ ok: true });
	expect(gitOut(["branch", "--list", "drafts/w"])).toBe("");
	expect(gitOut(["rev-parse", "--abbrev-ref", "HEAD"])).toBe("main");
});

// --- PATCH /api/docs/*: the {title} branch (M4-3 b4) -----------------------

test("PATCH /api/docs/*: {title} writes the frontmatter title, path unchanged", async () => {
	const res = await patchDoc("/api/docs/a.md", { title: "Renamed Doc" });
	expect(res.status).toBe(200);
	const body = (await res.json()) as { sha: string };
	expect(body.sha).toBe(gitOut(["rev-parse", "HEAD"]));
	// Frontmatter created around the untouched body; the file path is the
	// same (a title write never renames).
	expect(readFileSync(join(root, "a.md"), "utf8")).toBe(
		'---\ntitle: "Renamed Doc"\n---\n# body\n',
	);
	expect(gitOut(["log", "-1", "--format=%s"])).toBe(
		"Rename a.md to Renamed Doc",
	);
});

test("PATCH /api/docs/*: {to} still moves (the dispatch keeps its other arm)", async () => {
	const res = await patchDoc("/api/docs/a.md", { to: "moved.md" });
	expect(res.status).toBe(200);
	expect(readFileSync(join(root, "moved.md"), "utf8")).toBe("# body\n");
});

test("PATCH /api/docs/*: exactly one of to/title – both/neither/blank → 400", async () => {
	const both = await patchDoc("/api/docs/a.md", { title: "T", to: "b.md" });
	expect(both.status).toBe(400);
	const neither = await patchDoc("/api/docs/a.md", {});
	expect(neither.status).toBe(400);
	const blank = await patchDoc("/api/docs/a.md", { title: "   " });
	expect(blank.status).toBe(400);
	// Nothing was written by any rejected shape.
	expect(readFileSync(join(root, "a.md"), "utf8")).toBe("# body\n");
	expect(gitOut(["rev-list", "--count", "HEAD"])).toBe("1");
});

// --- GET /api/raw/* (M4-3 b6) ------------------------------------------------

test("GET /api/raw: 200 with the mapped content-type (md text, image binary-safe)", async () => {
	// Non-UTF8-safe bytes prove the route never decodes to a string.
	const pngBytes = Buffer.from([
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
	]);
	writeFileSync(join(root, "img.png"), pngBytes);

	const md = await api("GET", "/api/raw/a.md");
	expect(md.status).toBe(200);
	expect(md.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
	expect(await md.text()).toBe("# body\n");

	const png = await api("GET", "/api/raw/img.png");
	expect(png.status).toBe(200);
	expect(png.headers.get("content-type")).toBe("image/png");
	expect(Buffer.from(await png.arrayBuffer())).toEqual(pngBytes);
});

test("GET /api/raw: svg and html serve as text/plain – never execute in the app origin", async () => {
	writeFileSync(join(root, "pic.svg"), '<svg onload="alert(1)"/>');
	writeFileSync(join(root, "page.html"), "<script>alert(1)</script>");
	const svg = await api("GET", "/api/raw/pic.svg");
	expect(svg.status).toBe(200);
	expect(svg.headers.get("content-type")).toBe("text/plain; charset=utf-8");
	const html = await api("GET", "/api/raw/page.html");
	expect(html.headers.get("content-type")).toBe("text/plain; charset=utf-8");
});

test("GET /api/raw: unknown extension → octet-stream download", async () => {
	writeFileSync(join(root, "blob.bin"), "xyz");
	const res = await api("GET", "/api/raw/blob.bin");
	expect(res.status).toBe(200);
	expect(res.headers.get("content-type")).toBe("application/octet-stream");
	expect(res.headers.get("content-disposition")).toBe("attachment");
});

test("GET /api/raw: missing file and directories are 404", async () => {
	expect((await api("GET", "/api/raw/nope.txt")).status).toBe(404);
	mkdirSync(join(root, "subdir"));
	expect((await api("GET", "/api/raw/subdir")).status).toBe(404);
});

test("GET /api/raw: traversal attempts are 400 (the raw-URL guard covers the prefix)", async () => {
	for (const path of [
		"/api/raw/../secret",
		"/api/raw/sub/../../secret",
		"/api/raw/%2e%2e/secret",
		"/api/raw/..%2fsecret",
	]) {
		const res = await rawGet(path);
		expect(res.status, path).toBe(400);
	}
});

// --- GET /api/tree: the .gitignore filter (M4-3 b7) --------------------------

test("GET /api/tree: ignored paths never render; tracked and untracked-not-ignored do", async () => {
	writeFileSync(join(root, ".gitignore"), "scratch/\nignored.md\n");
	writeFileSync(join(root, "ignored.md"), "# i"); // untracked + ignored
	writeFileSync(join(root, "new.md"), "# n"); // untracked, NOT ignored
	mkdirSync(join(root, "scratch"), { recursive: true });
	writeFileSync(join(root, "scratch", "note.md"), "# s"); // ignored dir
	execFileSync("git", ["add", "-A"], { cwd: root });
	execFileSync("git", ["commit", "-q", "-m", "gitignore"], { cwd: root });

	const res = await api("GET", "/api/tree");
	expect(res.status).toBe(200);
	const body = (await res.json()) as {
		name: string;
		children?: { name: string }[];
	};
	// a.md (tracked seed) + new.md; the scratch/ dir and ignored.md are gone –
	// every tree-derived surface (sidebar, @ menu, move picker) reads this
	// route, so the filter is inherited everywhere at once.
	expect(body.name).toBe(".");
	expect(body.children?.map((c) => c.name)).toEqual(["a.md", "new.md"]);
});
