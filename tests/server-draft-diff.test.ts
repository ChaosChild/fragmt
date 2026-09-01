import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { createApp, startServer } from "../src/server/index.js";

// #18: GET /api/draft-diff/<doc> – 200 {lines} on a draft, [] on main, 404
// for an unknown doc. Same harness as server-m42.test.ts – a real git repo
// with an identity behind the app.

let root: string;
let server: Server;
let port: number;

beforeEach(async () => {
	root = mkdtempSync(join(tmpdir(), "fragmt-draftdiff-"));
	const git = (args: string[]) =>
		execFileSync("git", args, { cwd: root, encoding: "utf8" });
	git(["init", "-q", "-b", "main"]);
	git(["config", "user.name", "DraftDiff Test"]);
	git(["config", "user.email", "draftdiff@example.com"]);
	// Byte-exact expectations need blobs to keep what we wrote.
	git(["config", "core.autocrlf", "false"]);
	writeFileSync(join(root, "a.md"), "---\ntitle: A\n---\n\nfirst\n\nsecond\n");
	git(["add", "-A"]);
	git(["commit", "-q", "-m", "seed"]);

	const app = createApp({ repoRoot: root, docsRoot: "." });
	port = await new Promise<number>((resolve) => {
		server = startServer(app, 0, resolve);
	});
});

afterEach(() => {
	server.close();
	rmSync(root, { recursive: true, force: true });
});

function api(path: string): Promise<Response> {
	return fetch(`http://localhost:${port}${path}`);
}

/** Check out drafts/a and edit the first body block in a commit. */
function editOnDraft(): void {
	const git = (args: string[]) =>
		execFileSync("git", args, { cwd: root, encoding: "utf8" });
	git(["checkout", "-q", "-b", "drafts/a"]);
	writeFileSync(
		join(root, "a.md"),
		"---\ntitle: A\n---\n\nfirst edited\n\nsecond\n",
	);
	git(["add", "-A"]);
	git(["commit", "-q", "-m", "edit first"]);
}

test("on a draft: 200 with body-relative lines for the changed block", async () => {
	editOnDraft();
	const res = await api("/api/draft-diff/a.md");
	expect(res.status).toBe(200);
	expect(await res.json()).toEqual({
		doc: "a.md",
		lines: [{ start: 1, end: 1 }],
	});
});

test("on main: 200 with an empty lines array", async () => {
	const res = await api("/api/draft-diff/a.md");
	expect(res.status).toBe(200);
	expect(await res.json()).toEqual({ doc: "a.md", lines: [] });
});

test("unknown doc: 404", async () => {
	const res = await api("/api/draft-diff/nope.md");
	expect(res.status).toBe(404);
});
