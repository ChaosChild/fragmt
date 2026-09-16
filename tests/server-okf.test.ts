import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { createApp, startServer } from "../src/server/index.js";

// OKF rungs 1–2 server surface (#21): GET /api/validate, the okf flag on
// /api/meta, reserved-name 400s on create/rename, the frontmatter+index
// create commit, and the post-conclude regen. Same harness as
// server-m43.test.ts – a real git repo behind the app. The seed repo is
// legacy (no okf flag); okfOn() flips the config per test.

let root: string;
let server: Server;
let port: number;

beforeEach(async () => {
	root = mkdtempSync(join(tmpdir(), "fragmt-okf-"));
	execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
	execFileSync("git", ["config", "user.name", "OKF Test"], { cwd: root });
	execFileSync("git", ["config", "user.email", "okf@example.com"], {
		cwd: root,
	});
	execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: root });
	writeConfig(false);
	writeFileSyncLF("a.md", "---\ntype: concept\n---\n# a\n");
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

/** Write .fragmt.json (fs-read per request – no commit needed). */
function writeConfig(okf: boolean) {
	writeFileSync(
		join(root, ".fragmt.json"),
		`${JSON.stringify({ docsRoot: ".", order: {}, ...(okf ? { okf: true } : {}) }, null, "\t")}\n`,
	);
}

function writeFileSyncLF(path: string, text: string) {
	writeFileSync(join(root, path), text);
}

function api(method: string, path: string, body?: unknown): Promise<Response> {
	return fetch(`http://localhost:${port}${path}`, {
		method,
		...(body === undefined
			? {}
			: {
					headers: { "content-type": "application/json" },
					body: JSON.stringify(body),
				}),
	});
}

/** Raw git against the server's repo, independent of the code under test. */
function gitOut(args: string[]): string {
	return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

// --- GET /api/validate ------------------------------------------------------

test("GET /api/validate: OKF repo – findings shape with the §11 clauses", async () => {
	writeConfig(true);
	writeFileSyncLF("b.md", "# fenceless\n"); // clause (a): no frontmatter
	writeFileSyncLF("c.md", "---\ntitle: x\n---\n# no type\n"); // clause (b)
	execFileSync("git", ["add", "-A"], { cwd: root });
	execFileSync("git", ["commit", "-q", "-m", "bad docs"], { cwd: root });

	const res = await api("GET", "/api/validate");
	expect(res.status).toBe(200);
	const body = (await res.json()) as {
		okf: boolean;
		conformant: boolean;
		findings: { path: string; clause: string; detail: string }[];
	};
	expect(body.okf).toBe(true);
	expect(body.conformant).toBe(false);
	expect(body.findings).toEqual([
		expect.objectContaining({
			path: "b.md",
			clause: "frontmatter",
			detail: "missing frontmatter block",
		}),
		expect.objectContaining({ path: "c.md", clause: "type" }),
	]);
});

test("GET /api/validate: conformant OKF repo – zero findings", async () => {
	writeConfig(true);
	const body = (await (await api("GET", "/api/validate")).json()) as {
		okf: boolean;
		conformant: boolean;
		findings: unknown[];
	};
	expect(body).toEqual({ okf: true, conformant: true, findings: [] });
});

test("GET /api/validate: non-OKF repo – {okf:false}, nothing scanned", async () => {
	// The same fence-less doc exists (written uncommitted); a scan would see it.
	writeFileSyncLF("b.md", "# fenceless\n");
	const body = await (await api("GET", "/api/validate")).json();
	expect(body).toEqual({ okf: false });
});

// --- /api/meta: the okf flag -------------------------------------------------

test("GET /api/meta: okf flag follows the config live (true/false)", async () => {
	const legacy = (await (await api("GET", "/api/meta")).json()) as {
		okf: boolean;
	};
	expect(legacy.okf).toBe(false);
	writeConfig(true);
	const okf = (await (await api("GET", "/api/meta")).json()) as {
		okf: boolean;
	};
	expect(okf.okf).toBe(true);
});

// --- reserved names (§3.1) on the write routes -------------------------------

test("PATCH {to} a reserved basename in OKF mode → 400, nothing moved", async () => {
	writeConfig(true);
	for (const to of ["index.md", "log.md", "notes/Index.MD"]) {
		const res = await api("PATCH", "/api/docs/a.md", { to });
		expect(res.status, to).toBe(400);
		expect(((await res.json()) as { error: string }).error).toContain(
			"reserved",
		);
	}
	expect(readFileSync(join(root, "a.md"), "utf8")).toBe(
		"---\ntype: concept\n---\n# a\n",
	);
	expect(existsSync(join(root, "index.md"))).toBe(false);
	expect(existsSync(join(root, "log.md"))).toBe(false);
	expect(gitOut(["rev-list", "--count", "HEAD"])).toBe("1");
});

test("POST /api/docs with a reserved path in OKF mode → 400, nothing written", async () => {
	writeConfig(true);
	const res = await api("POST", "/api/docs", { path: "log.md", body: "# l" });
	expect(res.status).toBe(400);
	expect(((await res.json()) as { error: string }).error).toContain("reserved");
	expect(existsSync(join(root, "log.md"))).toBe(false);
});

// --- the OKF create commit ----------------------------------------------------

// ponytail: the seed body links a.md so the references ride the create; the
// pre-fenced seed (type + A3's status: "draft") keeps the block even on a
// link-free body (the 3646d18 gap, closed by pre-fencing).
test("POST /api/docs in OKF mode: type block + references on the file, index.md in the commit", async () => {
	writeConfig(true);
	const res = await api("POST", "/api/docs", {
		path: "new.md",
		body: "# hello\n\nSee [a](/a.md).\n",
	});
	expect(res.status).toBe(200);
	const { sha } = (await res.json()) as { sha: string };
	expect(sha).toBe(gitOut(["rev-parse", "HEAD"])); // one commit, create + all
	// The user's body rides under the server-side frontmatter verbatim.
	expect(readFileSync(join(root, "new.md"), "utf8")).toBe(
		'---\ntype: concept\nstatus: "draft"\nreferences: ["a.md"]\n---\n# hello\n\nSee [a](/a.md).\n',
	);
	// The generated index (§8) landed in the same commit, both docs listed.
	const index = gitOut(["show", "HEAD:index.md"]);
	expect(index).toContain("](/a.md)");
	expect(index).toContain("](/new.md)");
});

// --- the post-conclude regen ---------------------------------------------------

test("POST /api/merge/conclude in OKF mode: references + indexes regenerate", async () => {
	writeConfig(true);
	// A doc-only conflict: both sides edit a.md's body.
	gitOut(["checkout", "-q", "-b", "drafts/x"]);
	writeFileSyncLF("a.md", "---\ntype: concept\n---\n# draft\n");
	gitOut(["add", "-A"]);
	gitOut(["commit", "-q", "-m", "draft edit"]);
	gitOut(["checkout", "-q", "main"]);
	writeFileSyncLF("a.md", "---\ntype: concept\n---\n# main\n");
	gitOut(["add", "-A"]);
	gitOut(["commit", "-q", "-m", "main edit"]);
	gitOut(["checkout", "-q", "drafts/x"]);

	const merge = await api("POST", "/api/merge");
	expect(merge.status).toBe(409); // stood – resolution mode
	const resolve = await api("PUT", "/api/merge/resolve", {
		path: "a.md",
		content: "---\ntype: concept\n---\n# resolved\n",
	});
	expect(await resolve.json()).toEqual({ remaining: 0 });

	const done = await api("POST", "/api/merge/conclude");
	expect(done.status).toBe(200);
	// The merge commit, then the regen's own commit – with the index it owes.
	expect(gitOut(["log", "--format=%s", "-2"]).split("\n")).toEqual([
		"OKF: populate references and indexes",
		"Merge branch 'drafts/x'",
	]);
	expect(readFileSync(join(root, "index.md"), "utf8")).toContain("](/a.md)");
});
