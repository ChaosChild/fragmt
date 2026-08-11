import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { createApp, startServer } from "../src/server/index.js";

let root: string;
let server: Server;
let port: number;

beforeEach(async () => {
	root = mkdtempSync(join(tmpdir(), "fragmt-srv-"));
	mkdirSync(join(root, "docs"), { recursive: true });
	writeFileSync(join(root, "docs", "a.md"), "---\ntitle: A\n---\n# body\n");
	writeFileSync(join(root, "secret.txt"), "do not serve me");

	const app = createApp({ repoRoot: root, docsRoot: "docs" });
	port = await new Promise<number>((resolve) => {
		server = startServer(app, 0, resolve);
	});
});

afterEach(() => {
	server.close();
	rmSync(root, { recursive: true, force: true });
});

/**
 * Raw HTTP request — `fetch` collapses `..` in the path before it leaves the
 * client, so it can never reach (or test) the traversal guard in startServer.
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
			const status = Number(raw.split(" ")[1]);
			resolve({
				status,
				body: raw.split("\r\n\r\n").slice(1).join("\r\n\r\n"),
			});
		});
	});
}

test("GET /api/tree returns the docsRoot tree", async () => {
	const res = await fetch(`http://localhost:${port}/api/tree`);
	expect(res.status).toBe(200);
	expect(await res.json()).toMatchObject({
		name: ".",
		path: "",
		children: [{ name: "a.md", path: "a.md", type: "doc" }],
	});
});

test("GET /api/docs/<path> splits frontmatter and withholds rawFrontmatter", async () => {
	const res = await fetch(`http://localhost:${port}/api/docs/a.md`);
	expect(res.status).toBe(200);
	const body = (await res.json()) as Record<string, unknown>;
	expect(body.frontmatter).toEqual({ title: "A" });
	expect(body.markdown).toContain("# body");
	// v1 holds this back from the UI; M2 reattaches it server-side on save.
	expect(body).not.toHaveProperty("rawFrontmatter");
});

test("a missing doc is 404", async () => {
	const res = await fetch(`http://localhost:${port}/api/docs/nope.md`);
	expect(res.status).toBe(404);
});

test("an unknown /api route is 404", async () => {
	const res = await fetch(`http://localhost:${port}/api/bogus`);
	expect(res.status).toBe(404);
});

// Trust boundary. These four must stay 400 — a 404 here means the raw-URL guard
// was lost to a refactor and the framework silently normalized the path instead.
test.each([
	["parent escape", "/api/docs/../secret.txt"],
	["nested parent escape", "/api/docs/sub/../../secret.txt"],
	["encoded parent escape", "/api/docs/%2e%2e/secret.txt"],
	["encoded separator escape", "/api/docs/..%2fsecret.txt"],
	["malformed percent-encoding", "/api/docs/%zz../secret.txt"],
	["non-markdown extension", "/api/docs/secret.txt"],
])("%s is rejected with 400", async (_label, path) => {
	const res = await rawGet(path);
	expect(res.status).toBe(400);
	expect(res.body).toContain("invalid doc path");
});
