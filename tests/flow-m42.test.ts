import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { createApp, startServer } from "../src/server/index.js";

// The M4-2 acceptance flow 1–2, end to end over HTTP — the exact call order
// the UI's protected-main interception produces: a doc born on main, drafted,
// edited on the draft, merged — main carries the edit, the branch is gone.

let root: string;
let server: Server;
let port: number;

beforeEach(async () => {
	root = mkdtempSync(join(tmpdir(), "fragmt-flow42-"));
	execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
	execFileSync("git", ["config", "user.name", "Flow Test"], { cwd: root });
	execFileSync("git", ["config", "user.email", "flow@example.com"], {
		cwd: root,
	});
	// Byte-exact body assertions need blobs to keep what we wrote
	// (server-m42.test.ts pattern — a host autocrlf would smudge checkouts).
	execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: root });
	writeFileSync(join(root, "seed.md"), "# seed\n");
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

test("create → draft → edit → merge lands the edit on main and drops the branch", async () => {
	// 1. The doc is born on main (the + menu's create-doc, pre-interception).
	const made = await api("POST", "/api/docs", {
		path: "docs/flow.md",
		body: "# flow\n",
	});
	expect(made.status).toBe(200);

	// 2. Draft it — the protected-main checkout the UI performs first.
	const draft = await api("POST", "/api/draft", { docPath: "docs/flow.md" });
	expect(draft.status).toBe(200);
	expect(await draft.json()).toEqual({ current: "drafts/flow", reused: false });

	// 3. Save an edit on the draft (the PUT the editor's Save sends).
	const onDraft = (await (
		await api("GET", "/api/docs/docs/flow.md")
	).json()) as { markdown: string; hash: string };
	expect(onDraft.markdown).toBe("# flow\n");
	const saved = await api("PUT", "/api/docs/docs/flow.md", {
		markdown: "# flow\nedited on the draft\n",
		baseHash: onDraft.hash,
	});
	expect(saved.status).toBe(200);

	// 4. The global Merge button's POST.
	const merged = await api("POST", "/api/merge");
	expect(merged.status).toBe(200);
	expect(((await merged.json()) as { sha: string }).sha).toMatch(
		/^[0-9a-f]{40}$/,
	);

	// 5. Main carries the edit (the post-merge doc reload reads this).
	const onMain = (await (
		await api("GET", "/api/docs/docs/flow.md")
	).json()) as { markdown: string };
	expect(onMain.markdown).toBe("# flow\nedited on the draft\n");

	// 6. The branch vanished — the dropdown lists only main.
	expect(await (await api("GET", "/api/branches")).json()).toEqual({
		current: "main",
		branches: ["main"],
	});
});
