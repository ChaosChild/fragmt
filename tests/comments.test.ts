import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import {
	addReply,
	addThread,
	type CommentFile,
	type CommentThread,
	DocPathError,
	deleteThread,
	readComments,
	reconcileThreads,
	resolveThread,
	ThreadNotFoundError,
} from "../src/core/index.js";

// Sidecar mutations must be exactly ONE commit (author + message) through
// commitAs, canonically serialized, with traversal and missing-thread guards
// typed for the server's 400/404 mapping. Autocrlf is pinned false so
// byte-exact assertions hold on Windows (files.test.ts pattern).

const AUTHOR = "Comments Test|comments@example.com";

const dirs: string[] = [];

afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function run(root: string, args: string[]): string {
	return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

/** Fresh tmp repo with an identity; autocrlf off keeps bytes stable. */
function repo(): string {
	const root = mkdtempSync(join(tmpdir(), "fragmt-comments-"));
	run(root, ["init", "-q", "-b", "main"]);
	run(root, ["config", "user.name", "Comments Test"]);
	run(root, ["config", "user.email", "comments@example.com"]);
	run(root, ["config", "core.autocrlf", "false"]);
	dirs.push(root);
	return root;
}

/** A seed commit made with raw git, independent of the code under test. */
function seed(root: string): void {
	run(root, ["commit", "-q", "--allow-empty", "-m", "seed"]);
}

const count = (root: string) =>
	Number(run(root, ["rev-list", "--count", "HEAD"]));

const lastCommit = (root: string) =>
	run(root, ["log", "-1", "--format=%an|%ae|%s"]);

/** Parse a doc's sidecar straight off disk. */
const sidecar = (root: string, docPath: string): CommentFile =>
	JSON.parse(
		readFileSync(join(root, ".docs/comments", `${docPath}.json`), "utf8"),
	);

test("addThread writes the sidecar as exactly one commit with canonical JSON", async () => {
	const root = repo();
	seed(root);

	const { sha } = await addThread(
		root,
		"notes/plan.md",
		"c-1",
		"marked text",
		"opening body",
	);

	// docPath nests literally under .docs/comments.
	const abs = join(root, ".docs/comments/notes/plan.md.json");
	expect(existsSync(abs)).toBe(true);
	const thread = sidecar(root, "notes/plan.md").comments["c-1"];
	expect(thread).toMatchObject({
		id: "c-1",
		quote: "marked text",
		author: "Comments Test",
		resolved: false,
		replies: [{ author: "Comments Test", body: "opening body" }],
	});
	expect(thread?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
	// Canonical bytes: stable key order, tab indent, one trailing newline.
	const text = readFileSync(abs, "utf8");
	expect(text).toBe(`${JSON.stringify(JSON.parse(text), null, "\t")}\n`);
	expect(count(root)).toBe(2);
	expect(lastCommit(root)).toBe(`${AUTHOR}|Update comments for notes/plan.md`);
	expect(sha).toBe(run(root, ["rev-parse", "HEAD"]));
	expect(await readComments(root, "notes/plan.md")).toEqual(
		sidecar(root, "notes/plan.md"),
	);
});

test("addReply appends to the thread in one commit, opener stays first", async () => {
	const root = repo();
	seed(root);
	await addThread(root, "doc.md", "c-1", "q", "opening");

	await addReply(root, "doc.md", "c-1", "a reply");

	const replies = sidecar(root, "doc.md").comments["c-1"]?.replies;
	expect(replies?.map((r) => r.body)).toEqual(["opening", "a reply"]);
	expect(replies?.[1]).toMatchObject({ author: "Comments Test" });
	expect(count(root)).toBe(3);
	expect(lastCommit(root)).toBe(`${AUTHOR}|Update comments for doc.md`);
});

test("resolveThread flips resolved in one commit", async () => {
	const root = repo();
	seed(root);
	await addThread(root, "doc.md", "c-1", "q", "opening");

	await resolveThread(root, "doc.md", "c-1");

	expect(sidecar(root, "doc.md").comments["c-1"]?.resolved).toBe(true);
	expect(count(root)).toBe(3);
	expect(lastCommit(root)).toBe(`${AUTHOR}|Update comments for doc.md`);
});

test("deleteThread removes the entry in one commit", async () => {
	const root = repo();
	seed(root);
	await addThread(root, "doc.md", "c-1", "q", "opening");

	await deleteThread(root, "doc.md", "c-1");

	expect(sidecar(root, "doc.md")).toEqual({ comments: {} });
	expect(count(root)).toBe(3);
	expect(lastCommit(root)).toBe(`${AUTHOR}|Update comments for doc.md`);
	expect(run(root, ["status", "--porcelain"])).toBe("");
});

test("readComments returns {comments:{}} when no sidecar exists", async () => {
	const root = repo();
	seed(root);

	expect(await readComments(root, "never-touched.md")).toEqual({
		comments: {},
	});
	expect(existsSync(join(root, ".docs"))).toBe(false);
	expect(count(root)).toBe(1);
});

test("a ../ docPath is rejected by the sidecar guard without committing", async () => {
	const root = repo();
	seed(root);

	await expect(
		addThread(root, "../outside.md", "c-1", "q", "body"),
	).rejects.toThrow(DocPathError);
	await expect(readComments(root, "../outside.md")).rejects.toThrow(
		DocPathError,
	);

	expect(count(root)).toBe(1);
	expect(existsSync(join(root, ".docs"))).toBe(false);
});

test("reply/resolve/delete on a missing thread throw ThreadNotFoundError", async () => {
	const root = repo();
	seed(root);

	await expect(addReply(root, "doc.md", "nope", "x")).rejects.toThrow(
		ThreadNotFoundError,
	);
	await expect(resolveThread(root, "doc.md", "nope")).rejects.toThrow(
		ThreadNotFoundError,
	);
	await expect(deleteThread(root, "doc.md", "nope")).rejects.toThrow(
		ThreadNotFoundError,
	);

	expect(count(root)).toBe(1);
});

test("reconcileThreads: live iff the data-c span is present (mixed case)", () => {
	const thread = (id: string): CommentThread => ({
		id,
		quote: `quote ${id}`,
		author: "a",
		createdAt: "2026-01-01T00:00:00.000Z",
		resolved: false,
		replies: [],
	});
	const file: CommentFile = {
		comments: {
			"live-1": thread("live-1"),
			"gone-1": thread("gone-1"),
			"live-2": { ...thread("live-2"), resolved: true },
		},
	};

	// Two live (resolved counts as live — resolve ≠ delete), one orphaned.
	const doc =
		'a <span data-c="live-1">x</span> b <span data-c="live-2">y</span>';
	const { live, orphaned } = reconcileThreads(doc, file);

	expect(live.map((t) => t.id)).toEqual(["live-1", "live-2"]);
	expect(orphaned.map((t) => t.id)).toEqual(["gone-1"]);

	// Span absent everywhere → all orphaned; span present for all → all live.
	const none = reconcileThreads("no spans at all", file);
	expect(none.live).toEqual([]);
	expect(none.orphaned).toHaveLength(3);
	const all = reconcileThreads(
		'<span data-c="live-1"></span><span data-c="gone-1"></span><span data-c="live-2"></span>',
		file,
	);
	expect(all.orphaned).toEqual([]);
	expect(all.live.map((t) => t.id)).toEqual(["live-1", "gone-1", "live-2"]);
});
