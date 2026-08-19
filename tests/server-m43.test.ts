import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { createApp, startServer } from "../src/server/index.js";

// M4-3 server surface: DELETE /api/branches/:name, PATCH /api/docs/* {title}.
// Same harness as server-m42.test.ts — a real git repo with an identity
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

/** PATCH with a JSON body — the doc route's two-way dispatch ({to}/{title}). */
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

test("DELETE /api/branches: merged branch gone, still on current; slashed names OK", async () => {
	gitOut(["branch", "feature"]);
	gitOut(["branch", "drafts/a"]);

	const res = await api("DELETE", "/api/branches/feature");
	expect(res.status).toBe(200);
	expect(await res.json()).toEqual({ ok: true });

	// Slashed names arrive percent-encoded — one router segment, decoded
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
	// Refused without force — the branch survives to be force-deleted.
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

test("PATCH /api/docs/*: exactly one of to/title — both/neither/blank → 400", async () => {
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
