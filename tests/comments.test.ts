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
import matter from "gray-matter";
import { afterEach, expect, test } from "vitest";
import {
	addReply,
	addThread,
	addThreadWithDoc,
	type CommentFile,
	type CommentThread,
	canonicalBody,
	DocPathError,
	deleteThread,
	deleteThreadWithDoc,
	docHash,
	readComments,
	reconcileThreads,
	StaleDocError,
	setResolved,
	stripCommentSpan,
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

/** The files (repo-relative, sorted) touched by HEAD. */
const lastCommitFiles = (root: string) =>
	run(root, ["show", "--name-only", "--format=", "HEAD"])
		.split("\n")
		.filter(Boolean)
		.sort();

/**
 * A doc on disk + a raw-git seed commit, independent of the code under test.
 * Returns the canonical base hash the writeDoc contract hashes – of the BODY
 * (frontmatter stripped), the same split readDoc performs.
 */
function seedDoc(root: string, docPath: string, body: string): string {
	const abs = join(root, docPath);
	mkdirSync(dirname(abs), { recursive: true });
	writeFileSync(abs, body);
	run(root, ["add", "--", docPath]);
	run(root, ["commit", "-q", "-m", `seed ${docPath}`]);
	return docHash(canonicalBody(matter(body, {}).content));
}

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

test("setResolved flips resolved both ways, one commit each", async () => {
	const root = repo();
	seed(root);
	await addThread(root, "doc.md", "c-1", "q", "opening");

	await setResolved(root, "doc.md", "c-1", true);
	expect(sidecar(root, "doc.md").comments["c-1"]?.resolved).toBe(true);

	await setResolved(root, "doc.md", "c-1", false);
	expect(sidecar(root, "doc.md").comments["c-1"]?.resolved).toBe(false);

	expect(count(root)).toBe(4);
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

test("addThreadWithDoc writes doc + sidecar as ONE commit", async () => {
	const root = repo();
	seed(root);
	const baseHash = seedDoc(root, "doc.md", "# title\n\nsome text\n");

	await addThreadWithDoc(root, ".", "doc.md", {
		id: "c-1",
		quote: "some text",
		body: "opening",
		docBody: '# title\n\nsome <span data-c="c-1">text</span>\n',
		baseHash,
	});

	// Exactly one commit, both files in it, the pinned message.
	expect(count(root)).toBe(3); // seed + seedDoc + one combined commit
	expect(lastCommit(root)).toBe(`${AUTHOR}|Comment on doc.md`);
	expect(lastCommitFiles(root)).toEqual([
		".docs/comments/doc.md.json",
		"doc.md",
	]);
	// The doc got the span (frontmatter discipline: canonical body on disk).
	expect(readFileSync(join(root, "doc.md"), "utf8")).toBe(
		'# title\n\nsome <span data-c="c-1">text</span>\n',
	);
	const thread = sidecar(root, "doc.md").comments["c-1"];
	expect(thread).toMatchObject({
		id: "c-1",
		quote: "some text",
		author: "Comments Test",
		resolved: false,
		replies: [{ author: "Comments Test", body: "opening" }],
	});
	expect(run(root, ["status", "--porcelain"])).toBe("");
});

test("addThreadWithDoc reattaches frontmatter byte-for-byte", async () => {
	const root = repo();
	seed(root);
	const baseHash = seedDoc(root, "doc.md", "---\ntitle: T\n---\n\n# title\n");

	await addThreadWithDoc(root, ".", "doc.md", {
		id: "c-1",
		quote: "title",
		body: "b",
		docBody: '# <span data-c="c-1">title</span>\n',
		baseHash,
	});

	expect(readFileSync(join(root, "doc.md"), "utf8")).toBe(
		'---\ntitle: T\n---\n\n# <span data-c="c-1">title</span>\n',
	);
});

test("a stale baseHash is StaleDocError with zero disk writes", async () => {
	const root = repo();
	seed(root);
	seedDoc(root, "doc.md", "# title\n\nsome text\n");

	await expect(
		addThreadWithDoc(root, ".", "doc.md", {
			id: "c-1",
			quote: "q",
			body: "b",
			docBody: "# changed\n",
			baseHash: "deadbeef".repeat(8),
		}),
	).rejects.toThrow(StaleDocError);

	expect(readFileSync(join(root, "doc.md"), "utf8")).toBe(
		"# title\n\nsome text\n",
	);
	expect(existsSync(join(root, ".docs"))).toBe(false);
	expect(count(root)).toBe(2);
	expect(run(root, ["status", "--porcelain"])).toBe("");
});

test("deleteThreadWithDoc strips the span and entry in ONE commit", async () => {
	const root = repo();
	seed(root);
	const baseHash = seedDoc(root, "doc.md", "# title\n\nsome text\n");
	await addThreadWithDoc(root, ".", "doc.md", {
		id: "c-1",
		quote: "text",
		body: "opening",
		docBody: '# title\n\nsome <span data-c="c-1">text</span>\n',
		baseHash,
	});
	// Another span must survive the strip untouched.
	await addThreadWithDoc(root, ".", "doc.md", {
		id: "c-2",
		quote: "title",
		body: "second",
		docBody:
			'# <span data-c="c-2">title</span>\n\nsome <span data-c="c-1">text</span>\n',
		baseHash: docHash('# title\n\nsome <span data-c="c-1">text</span>\n'),
	});
	expect(count(root)).toBe(4);

	await deleteThreadWithDoc(
		root,
		".",
		"doc.md",
		"c-1",
		docHash(
			'# <span data-c="c-2">title</span>\n\nsome <span data-c="c-1">text</span>\n',
		),
	);

	// One commit, both files, the pinned message; the span (and only it) gone.
	expect(count(root)).toBe(5);
	expect(lastCommit(root)).toBe(`${AUTHOR}|Remove comment on doc.md`);
	expect(lastCommitFiles(root)).toEqual([
		".docs/comments/doc.md.json",
		"doc.md",
	]);
	expect(readFileSync(join(root, "doc.md"), "utf8")).toBe(
		'# <span data-c="c-2">title</span>\n\nsome text\n',
	);
	const remaining = sidecar(root, "doc.md").comments;
	expect(Object.keys(remaining)).toEqual(["c-2"]);
	expect(run(root, ["status", "--porcelain"])).toBe("");
});

test("stripCommentSpan: only the matching span, inner text kept", () => {
	const doc =
		'a <span data-c="x">X</span> b <span data-c="y">Y</span> c <span data-c="x">X2</span> d';

	// Only the FIRST matching span goes (ids are unique in practice).
	expect(stripCommentSpan(doc, "x")).toBe(
		'a X b <span data-c="y">Y</span> c <span data-c="x">X2</span> d',
	);
	// Adjacent spans: no residue between them.
	expect(
		stripCommentSpan('<span data-c="a">A</span><span data-c="b">B</span>', "a"),
	).toBe('A<span data-c="b">B</span>');
	// Multi-line inner text survives intact.
	expect(stripCommentSpan('<span data-c="m">one\ntwo</span>', "m")).toBe(
		"one\ntwo",
	);
	// Unknown id → unchanged, byte-for-byte.
	expect(stripCommentSpan(doc, "nope")).toBe(doc);
	expect(stripCommentSpan("no spans at all", "x")).toBe("no spans at all");
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
	// deleteThreadWithDoc also needs a live doc body (the span strip).
	const hash = seedDoc(root, "doc.md", "# x\n");

	await expect(addReply(root, "doc.md", "nope", "x")).rejects.toThrow(
		ThreadNotFoundError,
	);
	await expect(setResolved(root, "doc.md", "nope", true)).rejects.toThrow(
		ThreadNotFoundError,
	);
	await expect(
		deleteThreadWithDoc(root, ".", "doc.md", "nope", hash),
	).rejects.toThrow(ThreadNotFoundError);
	await expect(deleteThread(root, "doc.md", "nope")).rejects.toThrow(
		ThreadNotFoundError,
	);

	expect(count(root)).toBe(2); // seed + seedDoc – nothing since
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

	// Two live (resolved counts as live – resolve ≠ delete), one orphaned.
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
