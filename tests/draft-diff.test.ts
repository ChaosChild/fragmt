import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, test } from "vitest";
import {
	abortMerge,
	draftDiffLines,
	mergeToMain,
	parseDiffNewLines,
} from "../src/core/drafts.js";

// #18: the draft gutter's core half – `git diff -U0` hunk parsing, and the
// body-relative ranges for one doc on the current draft branch.

test("parseDiffNewLines: hunks → new-side inclusive ranges, context ignored", () => {
	expect(
		parseDiffNewLines(
			[
				"diff --git a/a.md b/a.md",
				"index 111..222 100644",
				"--- a/a.md",
				"+++ b/a.md",
				"@@ -1,4 +1,5 @@",
				" ctx",
				"-removed",
				"+added a",
				"+added b",
				"@@ -20 +21,2 @@",
				"-tail",
				"+tail one",
				"+tail two",
				"",
			].join("\n"),
		),
	).toEqual([
		{ start: 1, end: 5 },
		{ start: 21, end: 22 },
	]);
});

test("parseDiffNewLines: pure deletion (d=0) collapses to the join line", () => {
	expect(parseDiffNewLines("@@ -5,3 +5,0 @@\n-gone\n")).toEqual([
		{ start: 5, end: 5 },
	]);
});

test("parseDiffNewLines: one-line hunks, new files, hunkless diffs", () => {
	expect(parseDiffNewLines("@@ -3 +3 @@\n+swapped\n")).toEqual([
		{ start: 3, end: 3 },
	]);
	expect(parseDiffNewLines("@@ -0,0 +1,7 @@\n+new file body\n")).toEqual([
		{ start: 1, end: 7 },
	]);
	expect(parseDiffNewLines("nothing here\n+++ b/not a hunk\n")).toEqual([]);
});

// draftDiffLines against real tmp repos (drafts.test.ts pattern) – every git
// call outside the code under test is raw execFileSync.

const dirs: string[] = [];

afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function run(root: string, args: string[]): string {
	return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

/** Fresh tmp repo on main with an identity; autocrlf off keeps bytes stable. */
function repo(): string {
	const root = mkdtempSync(join(tmpdir(), "fragmt-gutter-"));
	run(root, ["init", "-q", "-b", "main"]);
	run(root, ["config", "user.name", "Gutter Test"]);
	run(root, ["config", "user.email", "gutter@example.com"]);
	run(root, ["config", "core.autocrlf", "false"]);
	dirs.push(root);
	return root;
}

function write(root: string, path: string, body: string): void {
	const abs = join(root, ...path.split("/"));
	mkdirSync(dirname(abs), { recursive: true });
	writeFileSync(abs, body);
}

function commit(root: string, message: string): void {
	run(root, ["add", "-A"]);
	run(root, ["commit", "-q", "-m", message]);
}

// File lines: 1-3 the frontmatter fence pair, 4 the gap, 5+ the body. Body
// lines: "block one a/b" 1-2, "block two" 4, "block three" 6.
const DOC =
	"---\ntitle: T\n---\n\nblock one a\nblock one b\n\nblock two\n\nblock three\n";

test("draftDiffLines: frontmatter and gap shifted out, two edited blocks body-relative", async () => {
	const root = repo();
	write(root, "docs/a.md", DOC);
	commit(root, "seed");
	run(root, ["checkout", "-q", "-b", "drafts/x"]);
	write(
		root,
		"docs/a.md",
		DOC.replace("block two", "block two edited").replace(
			"block three",
			"block three edited",
		),
	);
	commit(root, "edit two separated blocks");

	expect(await draftDiffLines(root, "docs", "a.md")).toEqual([
		{ start: 4, end: 4 },
		{ start: 6, end: 6 },
	]);
});

test("draftDiffLines: [] on main, and on a draft branch with no diff", async () => {
	const root = repo();
	write(root, "docs/a.md", DOC);
	commit(root, "seed");
	expect(await draftDiffLines(root, "docs", "a.md")).toEqual([]);

	run(root, ["checkout", "-q", "-b", "drafts/empty"]);
	expect(await draftDiffLines(root, "docs", "a.md")).toEqual([]);
});

test("draftDiffLines: [] while a merge stands", async () => {
	const root = repo();
	write(root, "docs/a.md", DOC);
	commit(root, "seed");
	run(root, ["checkout", "-q", "-b", "drafts/c"]);
	write(root, "docs/a.md", DOC.replace("block one a", "draft edit"));
	commit(root, "draft edit");
	run(root, ["checkout", "-q", "main"]);
	write(root, "docs/a.md", DOC.replace("block one a", "main edit"));
	commit(root, "main edit");
	run(root, ["checkout", "-q", "drafts/c"]);
	const r = await mergeToMain(root, "docs");
	expect(r.merged).toBe(false); // stood on main, MERGE_HEAD present
	expect(await draftDiffLines(root, "docs", "a.md")).toEqual([]);
	await abortMerge(root);
});

test("draftDiffLines: a doc the draft added covers its whole body", async () => {
	const root = repo();
	write(root, "docs/a.md", "# a\n");
	commit(root, "seed");
	run(root, ["checkout", "-q", "-b", "drafts/n"]);
	write(root, "docs/new.md", DOC);
	commit(root, "add new");

	expect(await draftDiffLines(root, "docs", "new.md")).toEqual([
		{ start: 1, end: 6 },
	]);
});
