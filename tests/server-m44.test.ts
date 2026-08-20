import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import type { CommentFile } from "../src/core/comments.js";
import type { mergeState } from "../src/core/drafts.js";
import type { RepoMeta } from "../src/core/meta.js";
import { createApp, startServer } from "../src/server/index.js";

// M4-4 b3 server surface: the write-guard middleware, GET/PUT/POST
// /api/merge* resolution routes, and the stood:false fallback. Same harness
// as server-m42/m43 — a real git repo with an identity behind the app, but
// docsRoot "docs" so a root README is an unresolvable "other" conflict.

let root: string;
let server: Server;
let port: number;

beforeEach(async () => {
	root = mkdtempSync(join(tmpdir(), "fragmt-m44-"));
	execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
	execFileSync("git", ["config", "user.name", "M44 Test"], { cwd: root });
	execFileSync("git", ["config", "user.email", "m44@example.com"], {
		cwd: root,
	});
	execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: root });

	const app = createApp({ repoRoot: root, docsRoot: "docs" });
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
function run(args: string[]): string {
	return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function write(path: string, body: string): void {
	const abs = join(root, ...path.split("/"));
	mkdirSync(dirname(abs), { recursive: true });
	writeFileSync(abs, body);
}

function commit(message: string): void {
	run(["add", "-A"]);
	run(["commit", "-q", "-m", message]);
}

/** Sidecar text in the serializer's exact format (writeComments pattern). */
const sidecarText = (file: CommentFile): string =>
	`${JSON.stringify(file, null, "\t")}\n`;

const openReply = {
	author: "Seed",
	body: "open",
	at: "2026-01-01T00:00:00.000Z",
};
const seedThread = {
	id: "t1",
	quote: "base",
	author: "Seed",
	createdAt: "2026-01-01T00:00:00.000Z",
	resolved: false,
	replies: [openReply],
};
const reply = (author: string, at: string) => ({ author, body: "reply", at });

/**
 * The stood-merge scenario (merge-resolution.test.ts's conflicted()): docs/
 * a.md's single line and the sidecar thread both diverged between main and
 * drafts/c; a README rides the seed (test 3 diverges it). Ends on drafts/c.
 */
function conflicted(): void {
	write("docs/a.md", "# base\n");
	write(
		".docs/comments/a.md.json",
		sidecarText({ comments: { t1: seedThread } }),
	);
	write("README.md", "# readme\n");
	commit("seed");
	run(["checkout", "-q", "-b", "drafts/c"]);
	write("docs/a.md", "# draft\n");
	write(
		".docs/comments/a.md.json",
		sidecarText({
			comments: {
				t1: {
					...seedThread,
					replies: [
						...seedThread.replies,
						reply("Draft", "2026-02-01T00:00:00.000Z"),
					],
				},
			},
		}),
	);
	commit("draft edit");
	run(["checkout", "-q", "main"]);
	write("docs/a.md", "# main\n");
	write(
		".docs/comments/a.md.json",
		sidecarText({
			comments: {
				t1: {
					...seedThread,
					replies: [
						...seedThread.replies,
						reply("Main", "2026-03-01T00:00:00.000Z"),
					],
				},
			},
		}),
	);
	commit("main edit");
	run(["checkout", "-q", "drafts/c"]);
}

const GUARD = { error: "a merge is in progress — finish or abort it first" };

test("stood merge: 409 shape, write guard, GET detail, resolve both kinds, conclude", async () => {
	conflicted();

	const res = await api("POST", "/api/merge");
	expect(res.status).toBe(409);
	const stood = (await res.json()) as {
		stood: boolean;
		branch: string;
		files: string[];
	};
	expect(stood).toEqual({
		merged: false,
		conflict: true,
		stood: true,
		branch: "drafts/c",
		files: [".docs/comments/a.md.json", "docs/a.md"],
	});

	// The write guard — GETs pass, every non-merge write 409s. Load-bearing:
	// commitAs git-adds unconditionally, so a stray save would stage a
	// half-resolution into an unrelated commit.
	const doc = (await (await api("GET", "/api/docs/a.md")).json()) as {
		hash: string;
	};
	const save = await api("PUT", "/api/docs/a.md", {
		markdown: "# sneaky\n",
		baseHash: doc.hash,
	});
	expect(save.status).toBe(409);
	expect(await save.json()).toEqual(GUARD);
	const blocked: [string, string, unknown?][] = [
		["POST", "/api/draft", { docPath: "a.md" }],
		["POST", "/api/checkout", { name: "main" }],
		["POST", "/api/sync"],
		["POST", "/api/docs/a.md/comments", { id: "n1", quote: "q", body: "b" }],
	];
	for (const [method, path, body] of blocked) {
		const r = await api(method, path, body);
		expect(r.status, `${method} ${path}`).toBe(409);
		expect(await r.json()).toEqual(GUARD);
	}

	// The full detail: doc hunks (ours = main, theirs = the draft) + the
	// sidecar's structural summary.
	const detail = (await (await api("GET", "/api/merge")).json()) as Awaited<
		ReturnType<typeof mergeState>
	>;
	if (!detail.inMerge) throw new Error("expected a standing merge");
	expect({
		...detail,
		files: [...detail.files].sort((a, b) => a.path.localeCompare(b.path)),
	}).toEqual({
		inMerge: true,
		branch: "drafts/c",
		remaining: 2,
		files: [
			{
				path: ".docs/comments/a.md.json",
				kind: "sidecar",
				summary: {
					keptFromOurs: 1,
					keptFromTheirs: 0,
					resolvedCarried: 0,
					repliesMerged: 1,
				},
			},
			{
				path: "docs/a.md",
				kind: "doc",
				parts: [{ ours: "# main\n", theirs: "# draft\n" }],
			},
		],
	});
	const meta = (await (await api("GET", "/api/meta")).json()) as RepoMeta;
	expect(meta.merge).toEqual({ branch: "drafts/c", remaining: 2 });

	// Resolve the doc — the assembled text lands verbatim; remaining drops.
	const docPut = await api("PUT", "/api/merge/resolve", {
		path: "docs/a.md",
		content: "# resolved\n",
	});
	expect(docPut.status).toBe(200);
	expect(await docPut.json()).toEqual({ remaining: 1 });
	expect(readFileSync(join(root, "docs/a.md"), "utf8")).toBe("# resolved\n");

	// Containment (membership in the LIVE unmerged set) and body shape.
	expect(
		(
			await api("PUT", "/api/merge/resolve", {
				path: "docs/../evil.md",
				content: "x",
			})
		).status,
	).toBe(409);
	expect(
		(
			await api("PUT", "/api/merge/resolve", {
				path: "docs/a.md",
				content: "x",
				choice: "ours",
			})
		).status,
	).toBe(400);
	expect(
		(
			await api("PUT", "/api/merge/resolve", {
				path: ".docs/comments/a.md.json",
				choice: "both",
			})
		).status,
	).toBe(400);

	// Conclude refuses while a file is left; the sidecar union finishes it.
	expect((await api("POST", "/api/merge/conclude")).status).toBe(409);
	const scPut = await api("PUT", "/api/merge/resolve", {
		path: ".docs/comments/a.md.json",
		choice: "merged",
	});
	expect(await scPut.json()).toEqual({ remaining: 0 });
	const merged = JSON.parse(
		readFileSync(join(root, ".docs/comments/a.md.json"), "utf8"),
	) as CommentFile;
	expect(merged.comments.t1.replies.map((r) => r.author)).toEqual([
		"Seed",
		"Main",
		"Draft",
	]);

	const done = await api("POST", "/api/merge/conclude");
	expect(done.status).toBe(200);
	const { sha } = (await done.json()) as { sha: string };
	expect(sha).toMatch(/^[0-9a-f]{40}$/);
	expect(run(["log", "-1", "--format=%s"])).toMatch(
		/^Merge branch 'drafts\/c'/,
	);
	expect((await (await api("GET", "/api/branches")).json()).branches).toEqual([
		"main",
	]);
	expect(run(["rev-parse", "--abbrev-ref", "HEAD"])).toBe("main");
	expect(run(["status", "--porcelain"])).toBe("");
	expect(await (await api("GET", "/api/merge")).json()).toEqual({
		inMerge: false,
	});
	expect(
		((await (await api("GET", "/api/meta")).json()) as RepoMeta).merge,
	).toBe(null);
});

test("sidecar ours/theirs choices; abort returns to the draft; no-merge 409s", async () => {
	conflicted();
	await api("POST", "/api/merge");

	// ours = stage :2: verbatim, through the serializer's exact format.
	const oursStage = JSON.parse(
		run(["show", ":2:.docs/comments/a.md.json"]),
	) as CommentFile;
	const ours = await api("PUT", "/api/merge/resolve", {
		path: ".docs/comments/a.md.json",
		choice: "ours",
	});
	expect(ours.status).toBe(200);
	expect(readFileSync(join(root, ".docs/comments/a.md.json"), "utf8")).toBe(
		`${JSON.stringify(oursStage, null, "\t")}\n`,
	);

	// Abort: back on the draft, clean tree, branch intact, nothing standing.
	const ab = await api("POST", "/api/merge/abort");
	expect(ab.status).toBe(200);
	expect(await ab.json()).toEqual({ ok: true });
	expect(run(["rev-parse", "--abbrev-ref", "HEAD"])).toBe("drafts/c");
	expect(run(["status", "--porcelain"])).toBe("");
	expect(run(["branch", "--list", "drafts/c"])).not.toBe("");
	expect(await (await api("GET", "/api/merge")).json()).toEqual({
		inMerge: false,
	});

	// No merge standing: the mutation routes say so (409), not a git error.
	expect((await api("POST", "/api/merge/conclude")).status).toBe(409);
	expect((await api("POST", "/api/merge/abort")).status).toBe(409);
	expect(
		(
			await api("PUT", "/api/merge/resolve", {
				path: "docs/a.md",
				content: "x",
			})
		).status,
	).toBe(409);

	// Re-stand the same conflict; theirs concludes cleanly too.
	await api("POST", "/api/merge");
	const theirsStage = JSON.parse(
		run(["show", ":3:.docs/comments/a.md.json"]),
	) as CommentFile;
	await api("PUT", "/api/merge/resolve", {
		path: "docs/a.md",
		content: "# draft again\n",
	});
	const theirs = await api("PUT", "/api/merge/resolve", {
		path: ".docs/comments/a.md.json",
		choice: "theirs",
	});
	expect(await theirs.json()).toEqual({ remaining: 0 });
	expect(readFileSync(join(root, ".docs/comments/a.md.json"), "utf8")).toBe(
		`${JSON.stringify(theirsStage, null, "\t")}\n`,
	);
	await api("POST", "/api/merge/conclude");
	expect((await (await api("GET", "/api/branches")).json()).branches).toEqual([
		"main",
	]);
});

test("non-resolvable conflict: 409 stood:false + message, merge aborted, draft intact", async () => {
	conflicted();
	// Diverge the seeded README (outside docsRoot) on both branches — one
	// "other" file is enough for the abort fallback.
	write("README.md", "# draft readme\n");
	commit("draft readme");
	run(["checkout", "-q", "main"]);
	write("README.md", "# main readme\n");
	commit("main readme");
	run(["checkout", "-q", "drafts/c"]);

	const res = await api("POST", "/api/merge");
	expect(res.status).toBe(409);
	const body = (await res.json()) as {
		merged: boolean;
		conflict: boolean;
		stood: boolean;
		files: string[];
		message: string;
	};
	expect(body.merged).toBe(false);
	expect(body.conflict).toBe(true);
	expect(body.stood).toBe(false);
	expect(body.files).toContain("README.md");
	expect(body.message).toMatch(/CONFLICT/);

	// Aborted server-side: nothing standing, still on the draft, tree clean,
	// the draft's README untouched.
	expect(await (await api("GET", "/api/merge")).json()).toEqual({
		inMerge: false,
	});
	expect(run(["rev-parse", "--abbrev-ref", "HEAD"])).toBe("drafts/c");
	expect(run(["status", "--porcelain"])).toBe("");
	expect(readFileSync(join(root, "README.md"), "utf8")).toBe(
		"# draft readme\n",
	);
});
