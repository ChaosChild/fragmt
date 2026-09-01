import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, test } from "vitest";
import {
	detailLines,
	parseAuthor,
	runAgent,
	statusLines,
	threadsLines,
	truncateBody,
} from "../src/cli/agent.js";
import { usage } from "../src/cli/index.js";
import {
	addThread,
	type CommentThread,
	initRepo,
	readComments,
} from "../src/core/index.js";

// M4-4 b4: the pure AXI formatters directly, then runAgent end-to-end on temp
// repos (drafts.test.ts harness – raw git outside the code under test).

// --- pure formatters -------------------------------------------------------

test("parseAuthor: git-style pair verbatim; bare name gets the machine address", () => {
	expect(parseAuthor("ZCode <z@agents.dev>")).toEqual({
		name: "ZCode",
		email: "z@agents.dev",
	});
	expect(parseAuthor("  Zed Agent ")).toEqual({
		name: "Zed Agent",
		email: "zed-agent@users.noreply.fragmt",
	});
	// slug: lowercase, non-alphanumerics → '-', edges trimmed (nextDraftName)
	expect(parseAuthor("My Agent 9").email).toBe(
		"my-agent-9@users.noreply.fragmt",
	);
	expect(parseAuthor("_Zed_").email).toBe("zed@users.noreply.fragmt");
});

test("truncateBody: 120 or fewer chars pass through; longer gets the note", () => {
	expect(truncateBody("short")).toBe("short");
	expect(truncateBody("x".repeat(120))).toBe("x".repeat(120));
	const long = "y".repeat(130);
	expect(truncateBody(long)).toBe(
		`${"y".repeat(120)} (truncated, 130 chars total – use --full)`,
	);
});

const meta = (over: {
	main?: string | null;
	current?: string;
	merge?: { branch: string | null; remaining: number } | null;
	drafts?: Record<
		string,
		{ branch: string; status: "new" | "edited" | "deleted" }[]
	>;
}) => ({
	// `??` would swallow a legitimate main: null (no draft model).
	main: over.main === undefined ? "main" : over.main,
	current: over.current ?? "main",
	docs: {},
	drafts: over.drafts ?? {},
	deleted: [],
	authors: {},
	agents: [],
	merge: over.merge ?? null,
});

test("statusLines: summary, protected mark, rows, empty state, mid-merge", () => {
	expect(
		statusLines(
			meta({ drafts: { "a.md": [{ branch: "drafts/a", status: "new" }] } }),
		),
	).toEqual([
		"branch: main (protected) · drafts: 1 · merge: clean",
		"drafts[1]{branch,doc,status}:",
		"drafts/a,a.md,new",
	]);
	// On a draft the current branch is not the protected one.
	expect(statusLines(meta({ current: "drafts/a" }))[0]).toBe(
		"branch: drafts/a · drafts: 0 · merge: clean",
	);
	expect(statusLines(meta({ drafts: {} }))[1]).toBe("drafts[0]: none");
	expect(
		statusLines(meta({ merge: { branch: "drafts/a", remaining: 2 } }))[0],
	).toBe(
		"branch: main (protected) · drafts: 0 · merge: in progress – 2 unresolved",
	);
	expect(statusLines(meta({ main: null }))[0]).toBe(
		"branch: main · drafts: 0 · merge: clean",
	);
});

const thread = (over: Partial<CommentThread> = {}): CommentThread => ({
	id: "t1",
	quote: "the marked text",
	author: "Andrei",
	createdAt: "2026-01-01T00:00:00.000Z",
	resolved: false,
	replies: [{ author: "Andrei", body: "open", at: "2026-01-01T00:00:00.000Z" }],
	...over,
});

test("threadsLines: header aggregate inline, comma rows, definitive empty state", () => {
	expect(
		threadsLines([
			thread(),
			thread({ id: "t2", author: "ZCode", resolved: true, replies: [] }),
		]),
	).toEqual([
		"threads[2]{id,author,resolved,replies}: – 2 of 2 total, 1 open",
		"t1,Andrei,false,1",
		"t2,ZCode,true,0",
	]);
	expect(threadsLines([])).toEqual(["threads[0]: none – 0 of 0 total, 0 open"]);
});

test("detailLines: quote + replies truncated; --full untruncates", () => {
	const long = "z".repeat(130);
	const t = thread({
		replies: [
			{ author: "Andrei", body: "open", at: "2026-01-01T00:00:00.000Z" },
			{ author: "ZCode", body: long, at: "2026-02-01T00:00:00.000Z" },
		],
	});
	expect(detailLines("t1", t, false)).toEqual([
		"thread[t1]{author,resolved}: Andrei,false",
		"quote: the marked text",
		"replies[2]{author,body}:",
		"Andrei,open",
		`ZCode,${"z".repeat(120)} (truncated, 130 chars total – use --full)`,
	]);
	expect(detailLines("t1", t, true)[4]).toBe(`ZCode,${long}`);
});

// --- end-to-end on temp repos ----------------------------------------------

const dirs: string[] = [];

afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function run(root: string, args: string[]): string {
	return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

/** Fresh tmp repo on main with a git identity; autocrlf off keeps bytes stable. */
function repo(): string {
	const root = mkdtempSync(join(tmpdir(), "fragmt-agent-"));
	run(root, ["init", "-q", "-b", "main"]);
	run(root, ["config", "user.name", "Agent Test"]);
	run(root, ["config", "user.email", "agent@example.com"]);
	run(root, ["config", "core.autocrlf", "false"]);
	dirs.push(root);
	return root;
}

function write(root: string, path: string, body: string): void {
	const abs = join(root, ...path.split("/"));
	mkdirSync(dirname(abs), { recursive: true });
	writeFileSync(abs, body);
}

function commit(root: string, message: string): string {
	run(root, ["add", "-A"]);
	run(root, ["commit", "-q", "-m", message]);
	return run(root, ["rev-parse", "HEAD"]);
}

/** Repo with docs/a.md committed and .fragmt.json pointing at docs/.
 *  The config is committed too – untracked, a later `add -A` on a draft
 *  branch would carry it away from main and loadConfig would fail there. */
function seeded(): string {
	const root = repo();
	write(root, "docs/a.md", "# a\n");
	commit(root, "seed");
	initRepo(root, "docs");
	commit(root, "adopt docs root");
	return root;
}

/** runAgent with the writer injected: exit code + the emitted lines. */
async function agent(
	root: string,
	args: string[],
): Promise<{ code: number; out: string[] }> {
	const lines: string[] = [];
	const code = await runAgent(args, root, (s) => {
		lines.push(s.trimEnd());
	});
	return { code, out: lines };
}

test("usage advertises the agent namespace", () => {
	expect(usage).toMatch(/fragmt agent/);
});

test("status: one-block summary, draft rows, help hints; bare agent = status", async () => {
	const root = seeded();
	run(root, ["checkout", "-q", "-b", "drafts/a"]);
	write(root, "docs/a.md", "# a v2\n");
	commit(root, "edit a");
	run(root, ["checkout", "-q", "main"]);

	const bare = await agent(root, []);
	expect(bare.code).toBe(0);
	expect(bare.out).toEqual([
		"branch: main (protected) · drafts: 1 · merge: clean",
		"drafts[1]{branch,doc,status}:",
		"drafts/a,a.md,edited",
		"help[2]:",
		"  fragmt agent comment a.md",
		"  fragmt agent draft a.md --merge",
	]);

	// On the draft itself the current branch is not marked protected.
	run(root, ["checkout", "-q", "drafts/a"]);
	const drafting = await agent(root, ["status"]);
	expect(drafting.out[0]).toBe("branch: drafts/a · drafts: 1 · merge: clean");
});

test("status: empty draft model is definitive, hints still concrete", async () => {
	const r = await agent(seeded(), []);
	expect(r.code).toBe(0);
	expect(r.out[1]).toBe("drafts[0]: none");
	expect(r.out[2]).toBe("help[2]:");
	expect(r.out[3]).toBe("  fragmt agent comment a.md");
	expect(r.out[4]).toBe("  fragmt agent draft a.md");
});

test("comment: listing rows + aggregate; empty sidecar state", async () => {
	const root = seeded();
	await addThread(root, "a.md", "t1", "the marked text", "looks wrong");

	const r = await agent(root, ["comment", "a.md"]);
	expect(r.code).toBe(0);
	expect(r.out.slice(0, 3)).toEqual([
		"threads[1]{id,author,resolved,replies}: – 1 of 1 total, 1 open",
		"t1,Agent Test,false,1",
		"help[2]:",
	]);
	expect(r.out[3]).toBe("  fragmt agent comment a.md --thread t1 --full");

	const none = await agent(root, ["comment", "missing.md"]);
	expect(none.code).toBe(0);
	expect(none.out[0]).toBe("threads[0]: none – 0 of 0 total, 0 open");
});

test("comment --thread: detail truncates at 120; --full untruncates", async () => {
	const root = seeded();
	const long = "z".repeat(130);
	await addThread(root, "a.md", "t1", "the marked text", long);

	const detail = await agent(root, ["comment", "a.md", "--thread", "t1"]);
	expect(detail.code).toBe(0);
	expect(detail.out).toEqual([
		"thread[t1]{author,resolved}: Agent Test,false",
		"quote: the marked text",
		"replies[1]{author,body}:",
		`Agent Test,${"z".repeat(120)} (truncated, 130 chars total – use --full)`,
		"help[2]:",
		'  fragmt agent comment a.md --thread t1 --body "…"',
		"  fragmt agent comment a.md --thread t1 --resolve",
	]);

	const full = await agent(root, [
		"comment",
		"a.md",
		"--thread",
		"t1",
		"--full",
	]);
	expect(full.out[3]).toBe(`Agent Test,${long}`);
});

test("comment --thread --body --author: reply attributed in sidecar and commit", async () => {
	const root = seeded();
	await addThread(root, "a.md", "t1", "the marked text", "looks wrong");

	const r = await agent(root, [
		"comment",
		"a.md",
		"--thread",
		"t1",
		"--body",
		"fixed in drafts/a",
		"--author",
		"Zed Agent",
	]);
	expect(r.code).toBe(0);
	expect(r.out[0]).toBe(
		"ok: reply added to thread t1 · author: Zed Agent · 1 commit",
	);

	// The sidecar's author field carries the agent's display name…
	const file = await readComments(root, "a.md");
	expect(file.comments.t1?.replies.at(-1)).toMatchObject({
		author: "Zed Agent",
		body: "fixed in drafts/a",
	});
	// …and the commit record does too (name-only → machine address).
	expect(run(root, ["log", "-1", "--format=%an"]).trim()).toBe("Zed Agent");
	expect(run(root, ["log", "-1", "--format=%ae"]).trim()).toBe(
		"zed-agent@users.noreply.fragmt",
	);

	// An explicit address is used verbatim.
	await agent(root, [
		"comment",
		"a.md",
		"--thread",
		"t1",
		"--body",
		"again",
		"--author",
		"Zed Agent <zed@agents.dev>",
	]);
	expect(run(root, ["log", "-1", "--format=%ae"]).trim()).toBe(
		"zed@agents.dev",
	);
});

test("comment --thread --resolve: ok line, sidecar flag, repeat is a no-op", async () => {
	const root = seeded();
	await addThread(root, "a.md", "t1", "the marked text", "looks wrong");

	const r = await agent(root, [
		"comment",
		"a.md",
		"--thread",
		"t1",
		"--resolve",
		"--author",
		"Zed Agent",
	]);
	expect(r.code).toBe(0);
	expect(r.out[0]).toBe(
		"ok: thread t1 resolved · author: Zed Agent · 1 commit",
	);
	expect((await readComments(root, "a.md")).comments.t1?.resolved).toBe(true);

	const commitsBefore = Number(run(root, ["rev-list", "--count", "HEAD"]));
	const again = await agent(root, [
		"comment",
		"a.md",
		"--thread",
		"t1",
		"--resolve",
	]);
	expect(again.code).toBe(0);
	expect(again.out[0]).toBe("ok: thread t1 already resolved");
	expect(Number(run(root, ["rev-list", "--count", "HEAD"]))).toBe(
		commitsBefore,
	);
});

test("comment: unknown thread, mutation without --thread, bad --author", async () => {
	const root = seeded();
	await addThread(root, "a.md", "t1", "the marked text", "looks wrong");

	const noThread = await agent(root, ["comment", "a.md", "--body", "x"]);
	expect(noThread.code).toBe(1);
	expect(noThread.out[0]).toBe(
		"error: --body and --resolve need --thread <id>",
	);

	const missing = await agent(root, [
		"comment",
		"a.md",
		"--thread",
		"nope",
		"--body",
		"x",
	]);
	expect(missing.code).toBe(1);
	expect(missing.out[0]).toBe("error: no thread nope on a.md");

	const noDoc = await agent(root, ["comment"]);
	expect(noDoc.code).toBe(1);
	expect(noDoc.out[0]).toBe(
		"error: comment needs a doc path (docsRoot-relative .md)",
	);

	const badAuthor = await agent(root, [
		"comment",
		"a.md",
		"--thread",
		"t1",
		"--body",
		"x",
		"--author",
		"<only-an-address>",
	]);
	expect(badAuthor.code).toBe(1);
	expect(badAuthor.out[0]).toBe(
		"error: --author needs a display name and an address",
	);
});

test("draft: starts (created/reused), then merges clean and deletes the branch", async () => {
	const root = seeded();

	const start = await agent(root, ["draft", "a.md"]);
	expect(start.code).toBe(0);
	expect(start.out[0]).toBe("ok: on draft drafts/a (created)");
	expect(run(root, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe("drafts/a");

	// Re-running from the draft reuses it; the edit merges back to main.
	const reuse = await agent(root, ["draft", "a.md"]);
	expect(reuse.out[0]).toBe("ok: on draft drafts/a (reused existing)");
	write(root, "docs/a.md", "# a v2\n");
	commit(root, "edit a");

	const merged = await agent(root, ["draft", "a.md", "--merge"]);
	expect(merged.code).toBe(0);
	expect(merged.out[0]).toBe("ok: merged to main · branch drafts/a deleted");
	expect(run(root, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe("main");
	expect(run(root, ["branch", "--list", "drafts/a"])).toBe("");
	expect(run(root, ["show", "main:docs/a.md"])).toBe("# a v2");
});

test("draft: missing doc and missing repo config are one-line errors", async () => {
	const root = seeded();
	const noDoc = await agent(root, ["draft"]);
	expect(noDoc.code).toBe(1);
	expect(noDoc.out[0]).toBe(
		"error: draft needs a doc path (docsRoot-relative .md)",
	);
});

test("exit 2: unknown verb, unknown flag, flag foreign to the verb", async () => {
	const root = seeded();
	for (const args of [
		["frobnicate"],
		["comment", "a.md", "--frob"],
		["status", "--full"],
		["draft", "a.md", "--body", "x"],
	]) {
		const r = await agent(root, args);
		expect(r.code, args.join(" ")).toBe(2);
		expect(r.out[0], args.join(" ")).toBe("error: unknown flag or verb");
	}
});

/** main and drafts/c both edited docs/a.md AND the sidecar thread t1. */
function conflicted(): string {
	const root = seeded();
	const sidecar = (reply: { author: string; body: string; at: string }) =>
		JSON.stringify(
			{
				comments: {
					t1: {
						id: "t1",
						quote: "base",
						author: "Seed",
						createdAt: "2026-01-01T00:00:00.000Z",
						resolved: false,
						replies: [
							{ author: "Seed", body: "open", at: "2026-01-01T00:00:00.000Z" },
							reply,
						],
					},
				},
			},
			null,
			"\t",
		);
	run(root, ["checkout", "-q", "-b", "drafts/c"]);
	write(root, "docs/a.md", "# draft\n");
	write(
		root,
		".docs/comments/a.md.json",
		`${sidecar({ author: "Draft", body: "draft reply", at: "2026-02-01T00:00:00.000Z" })}\n`,
	);
	commit(root, "draft edit");
	run(root, ["checkout", "-q", "main"]);
	write(root, "docs/a.md", "# main\n");
	write(
		root,
		".docs/comments/a.md.json",
		`${sidecar({ author: "Main", body: "main reply", at: "2026-03-01T00:00:00.000Z" })}\n`,
	);
	commit(root, "main edit");
	run(root, ["checkout", "-q", "drafts/c"]);
	return root;
}

test("stood conflict: exit 1 with resolve-in-UI error; status shows the merge", async () => {
	const root = conflicted();

	const r = await agent(root, ["draft", "a.md", "--merge"]);
	expect(r.code).toBe(1);
	expect(r.out[0]).toBe(
		"error: merge conflict – 2 files; resolve in the fragmt UI",
	);

	const status = await agent(root, ["status"]);
	expect(status.code).toBe(0);
	expect(status.out[0]).toBe(
		"branch: main (protected) · drafts: 1 · merge: in progress – 2 unresolved",
	);
	expect(status.out.at(-2)).toBe(
		"  fragmt serve – finish or abort the standing merge in the UI",
	);
});

test("mid-merge: comment and draft mutations are refused with the guard text", async () => {
	const root = conflicted();
	await agent(root, ["draft", "a.md", "--merge"]); // stands the merge

	const reply = await agent(root, [
		"comment",
		"a.md",
		"--thread",
		"t1",
		"--body",
		"mid-merge",
	]);
	expect(reply.code).toBe(1);
	expect(reply.out[0]).toBe(
		"error: a merge is in progress – finish or abort it first",
	);

	const resolve = await agent(root, [
		"comment",
		"a.md",
		"--thread",
		"t1",
		"--resolve",
	]);
	expect(resolve.code).toBe(1);
	expect(resolve.out[0]).toBe(
		"error: a merge is in progress – finish or abort it first",
	);

	const draft = await agent(root, ["draft", "a.md"]);
	expect(draft.code).toBe(1);
	expect(draft.out[0]).toBe(
		"error: a merge is in progress – finish or abort it first",
	);
});

test("unresolvable conflict: aborted fallback lists the files", async () => {
	const root = seeded();
	write(root, "README.md", "# readme\n");
	commit(root, "add readme");
	run(root, ["checkout", "-q", "-b", "drafts/r"]);
	write(root, "README.md", "# branch readme\n");
	commit(root, "edit readme on branch");
	run(root, ["checkout", "-q", "main"]);
	write(root, "README.md", "# main readme\n");
	commit(root, "edit readme on main");
	run(root, ["checkout", "-q", "drafts/r"]);

	const r = await agent(root, ["draft", "a.md", "--merge"]);
	expect(r.code).toBe(1);
	expect(r.out[0]).toBe(
		"error: merge conflict – aborted, unresolvable files: README.md",
	);
	// Aborted: back on the draft, nothing standing.
	expect(run(root, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe("drafts/r");
	expect(run(root, ["branch", "--list", "drafts/r"])).not.toBe("");
});
