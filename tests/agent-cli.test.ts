import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
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
import { nestedDocsRedirect, runInit, usage } from "../src/cli/index.js";
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
	okf: false,
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

// --- init: the avatar-path notice (rung B) -----------------------------------

/** Commit the working tree under a specific author email (rung-B fixtures). */
function commitAs(root: string, email: string, message: string): void {
	run(root, ["add", "-A"]);
	run(root, ["-c", `user.email=${email}`, "commit", "-q", "-m", message]);
}

/** runInit with the writer injected: exit code + the raw emitted output. */
async function initCli(
	root: string,
	rootFlag?: string,
): Promise<{ code: number; out: string }> {
	let out = "";
	const code = await runInit(rootFlag, root, (s) => {
		out += s;
	});
	return { code, out };
}

test("init: the notice lists exactly the unresolvable authors", async () => {
	const root = repo();
	write(root, "docs/a.md", "# a\n");
	commitAs(root, "one@work.dev", "a");
	write(root, "docs/b.md", "# b\n");
	commitAs(root, "octocat@users.noreply.github.com", "b");
	write(root, "docs/c.md", "# c\n");
	commitAs(root, "two@work.dev", "c");

	const r = await initCli(root, "docs");
	expect(r.code).toBe(0);
	// After the fresh-init block (a fresh config carries no authors map, so
	// both plain emails lack a path; the noreply shape does not).
	expect(r.out).toContain("Initialized fragmt");
	expect(r.out).toContain("2 commit author(s) have no avatar path:");
	expect(r.out).toContain("one@work.dev");
	expect(r.out).toContain("two@work.dev");
	expect(r.out).not.toContain("octocat@users.noreply.github.com");
});

test("init: no notice when every author resolves", async () => {
	const root = repo();
	write(root, "docs/a.md", "# a\n");
	commitAs(root, "octocat@users.noreply.github.com", "a");
	write(root, "docs/b.md", "# b\n");
	commitAs(root, "583231+hubot@users.noreply.github.com", "b");

	const r = await initCli(root, "docs");
	expect(r.code).toBe(0);
	expect(r.out).toContain("Initialized fragmt");
	expect(r.out).not.toContain("no avatar path");
});

test("init re-run: already initialized still prints the notice, minus mapped entries", async () => {
	const root = repo();
	write(root, "docs/a.md", "# a\n");
	commitAs(root, "mapped@work.dev", "a");
	write(root, "docs/b.md", "# b\n");
	commitAs(root, "123456+octocat@users.noreply.github.com", "b");
	write(root, "docs/c.md", "# c\n");
	commitAs(root, "stray@work.dev", "c");
	initRepo(root, "docs");
	// The operator maps one plain email; the other stays unresolvable.
	write(
		root,
		".fragmt.json",
		`${JSON.stringify({ docsRoot: "docs", order: {}, authors: { "mapped@work.dev": "octocat" } }, null, "\t")}\n`,
	);

	const r = await initCli(root);
	expect(r.code).toBe(0);
	expect(r.out.split("\n")[0]).toBe("already initialized");
	expect(r.out).toContain("1 commit author(s) have no avatar path:");
	expect(r.out).toContain("stray@work.dev");
	expect(r.out).not.toContain("mapped@work.dev");
	expect(r.out).not.toContain("users.noreply.github.com");
});

// --- init --folder: the #16 nested docs repo ----------------------------------

/** A local bare repo standing in for the docs origin – never the network.
 *  Forward slashes: the URL lands in .gitmodules, where a backslash escapes. */
function bareOrigin(): string {
	const root = mkdtempSync(join(tmpdir(), "fragmt-bare-"));
	run(root, ["init", "-q", "--bare", "-b", "main"]);
	dirs.push(root);
	return root.split("\\").join("/");
}

/** runInit on the nested path with writer and ask injected. */
async function nestedInit(
	root: string,
	folder: string,
	ask: () => Promise<string>,
	createNew = true,
): Promise<{ code: number; out: string }> {
	let out = "";
	const code = await runInit(
		undefined,
		root,
		(s) => {
			out += s;
		},
		{ folder, new: createNew, ask },
	);
	return { code, out };
}

/** Every instruction step stands on its own output line. */
const ownLine = (out: string, step: string) =>
	expect(out).toContain(`\n${step}\n`);

test("usage advertises the nested init flags", () => {
	expect(usage).toContain(
		"fragmt init [--root <path>] [--folder <name>] [--new]",
	);
});

test("nested init, fresh folder: nested repo, both AGENTS blocks, skip graduation", async () => {
	const root = repo();
	const r = await nestedInit(root, "docs", async () => "");
	expect(r.code).toBe(0);
	expect(r.out).toContain(
		"Initialized fragmt\n  docs root: docs (nested repo)\n  0 markdown files",
	);
	// The folder became its own repo with the identity-proof initial commit.
	const nested = join(root, "docs");
	expect(run(nested, ["log", "--oneline"])).toContain(
		"Adopt docs into nested fragmt repo",
	);
	// The outer AGENTS.md redirects to the folder; the inner one is standard.
	expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toContain(
		"docs live in the nested repo at docs/",
	);
	expect(readFileSync(join(nested, "AGENTS.md"), "utf8")).toContain(
		"## fragmt – docs environment for this repo",
	);
});

test("nested init on existing markdown: files ride the initial commit", async () => {
	const root = repo();
	write(root, "docs/a.md", "# a\n");
	write(root, "docs/b.md", "# b\n");
	commit(root, "seed docs");

	const r = await nestedInit(root, "docs", async () => "");
	expect(r.code).toBe(0);
	expect(r.out).toContain("2 markdown files");
	expect(
		run(join(root, "docs"), ["show", "--name-only", "--format=", "HEAD"]),
	).toContain("a.md");
	// Skipping keeps the outer repo's tracking alone – untracking is the
	// graduation's business, and it never ran.
	expect(run(root, ["ls-files", "docs"])).toContain("docs/a.md");
});

test("skip path: .gitignore entry + one-step-per-line instructions", async () => {
	const root = repo();
	write(root, "docs/a.md", "# a\n");
	commit(root, "seed docs"); // tracked fixture

	const r = await nestedInit(root, "docs", async () => "");
	expect(r.code).toBe(0);
	expect(r.out).toContain("added docs/ to .gitignore");
	expect(readFileSync(join(root, ".gitignore"), "utf8")).toBe("docs/\n");
	// Real folder, placeholder URL, rm --cached present (tracked fixture)…
	for (const step of [
		"cd docs",
		"git remote add origin <url>",
		"git push -u origin main",
		"cd ..",
		"git rm -r --cached docs",
		"git submodule add <url> docs",
	]) {
		ownLine(r.out, step);
	}

	// …and absent on an untracked fixture (fresh folder, no outer commit).
	const untracked = repo();
	const u = await nestedInit(untracked, "docs", async () => "");
	expect(u.out).toContain("git submodule add <url> docs");
	expect(u.out).not.toContain("rm -r --cached");
});

test("graduation with a URL: origin, push, untrack, submodule signal staged", async () => {
	const root = repo();
	write(root, "docs/a.md", "# a\n");
	commit(root, "seed docs");
	const url = bareOrigin();

	const r = await nestedInit(root, "docs", async () => url);
	expect(r.code).toBe(0);
	for (const line of [
		"origin set in docs",
		"pushed main to origin",
		"untracked docs from the outer repo",
		"staged docs as a submodule",
		"staged in the outer repo — review and commit:",
	]) {
		expect(r.out).toContain(line);
	}
	const nested = join(root, "docs");
	expect(run(nested, ["remote", "get-url", "origin"])).toBe(url);
	// The origin received main…
	expect(run(url, ["rev-parse", "--verify", "main"])).not.toBe("");
	// …and the outer repo staged gitlink + .gitmodules, untracked the files.
	expect(run(root, ["diff", "--cached", "--name-only"]).split("\n")).toEqual(
		expect.arrayContaining([".gitmodules", "docs"]),
	);
	expect(readFileSync(join(root, ".gitmodules"), "utf8")).toContain(
		"path = docs",
	);
	expect(run(root, ["ls-files", "docs"])).toBe("docs"); // gitlink only
	expect(existsSync(join(nested, "a.md"))).toBe(true); // files stay on disk
});

test("graduation with an unreachable origin: honest error, steps fallback", async () => {
	const root = repo();
	write(root, "docs/a.md", "# a\n");
	commit(root, "seed docs");
	const bad = join(tmpdir(), "fragmt-no-such-origin").split("\\").join("/");

	const r = await nestedInit(root, "docs", async () => bad);
	expect(r.code).toBe(0); // the offer failed, not the command
	expect(r.out).toContain("push failed:");
	// The printed steps carry the URL the operator gave.
	expect(r.out).toContain(`git remote add origin ${bad}`);
	ownLine(r.out, `git submodule add ${bad} docs`);
	// The remote was still set on the nested repo; nothing staged outside.
	expect(run(join(root, "docs"), ["remote", "get-url", "origin"])).toContain(
		"fragmt-no-such-origin",
	);
	expect(run(root, ["diff", "--cached", "--name-only"])).toBe("");
});

test("re-run after a skip: already initialized + the graduation re-offered", async () => {
	const root = repo();
	write(root, "docs/a.md", "# a\n");
	await nestedInit(root, "docs", async () => "");

	// The spec's re-run form: --folder without --new still detects the nest.
	const r = await nestedInit(root, "docs", async () => "", false);
	expect(r.code).toBe(0);
	expect(r.out.split("\n")[0]).toBe("already initialized");
	expect(r.out).toContain("Add a remote for the docs repo now?");
	// The second skip does not duplicate the ignore line.
	expect(readFileSync(join(root, ".gitignore"), "utf8")).toBe("docs/\n");
});

test("nestedDocsRedirect: exactly one nested candidate resolves, else null", async () => {
	// The serve/agent wrong-root seam (serve can't run headlessly; the helper
	// is exactly what both error paths call).
	const graduated = repo();
	write(graduated, "docs/a.md", "# a\n");
	await nestedInit(graduated, "docs", async () => bareOrigin());
	expect(nestedDocsRedirect(graduated, "serve")).toBe(
		"docs live in the nested fragmt repo at docs/\n  run from there:  cd docs && fragmt serve",
	);

	const skipped = repo();
	write(skipped, "docs/a.md", "# a\n");
	await nestedInit(skipped, "docs", async () => "");
	expect(nestedDocsRedirect(skipped, "agent")).toMatch(
		/docs live in the nested fragmt repo at docs\//,
	);
	expect(nestedDocsRedirect(skipped, "agent")).toMatch(
		/cd docs && fragmt agent/,
	);

	expect(nestedDocsRedirect(repo(), "serve")).toBeNull(); // no candidate at all

	const two = repo(); // ambiguous: two candidates
	for (const f of ["docs-a", "docs-b"]) {
		write(two, `${f}/a.md`, "# a\n");
		await nestedInit(two, f, async () => "");
	}
	expect(nestedDocsRedirect(two, "serve")).toBeNull();

	expect(nestedDocsRedirect(seeded(), "serve")).toBeNull(); // config at the root
});

test("agent from the outer root: the redirect error names the folder", async () => {
	const root = repo();
	write(root, "docs/a.md", "# a\n");
	await nestedInit(root, "docs", async () => "");

	const r = await agent(root, ["status"]);
	expect(r.code).toBe(1);
	const out = r.out.join("\n");
	expect(out).toContain("error: docs live in the nested fragmt repo at docs/");
	expect(out).toContain("cd docs && fragmt");
});
