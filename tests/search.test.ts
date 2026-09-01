import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { searchDocs } from "../src/core/search.js";

// The flat worktree scan (#14) against real tmp repos (meta.test.ts pattern):
// title/body substring hits, ordering, snippet windowing, the short-query and
// cap rules.

const dirs: string[] = [];

afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function run(root: string, args: string[]): string {
	return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

/** Fresh tmp repo on main; autocrlf off keeps bytes stable. */
function repo(): string {
	const root = mkdtempSync(join(tmpdir(), "fragmt-search-"));
	run(root, ["init", "-q", "-b", "main"]);
	run(root, ["config", "user.name", "Search Test"]);
	run(root, ["config", "user.email", "search@example.com"]);
	run(root, ["config", "core.autocrlf", "false"]);
	dirs.push(root);
	return root;
}

function commit(root: string): void {
	run(root, ["add", "-A"]);
	run(root, ["commit", "-q", "-m", "seed"]);
}

function write(root: string, path: string, body: string): void {
	const abs = join(root, ...path.split("/"));
	mkdirSync(dirname(abs), { recursive: true });
	writeFileSync(abs, body);
}

test("title-only and body-only substring hits, case-insensitive", async () => {
	const root = repo();
	write(
		root,
		"docs/titled.md",
		"---\ntitle: Zebra Notes\n---\n# z\n\nplain intro\n",
	);
	write(root, "docs/body.md", "# w\n\nthe quokka roams\n");
	write(root, "docs/none.md", "# n\n\nnothing here\n");
	commit(root);

	// ZEBRA hits only the frontmatter title (case-insensitive); the snippet
	// is the body's opening clamp.
	expect(await searchDocs(root, "docs", "ZEBRA")).toEqual([
		{ path: "titled.md", title: "Zebra Notes", snippet: "# z plain intro" },
	]);
	// Quokka hits only a body; the title falls back to the name sans .md.
	expect(await searchDocs(root, "docs", "Quokka")).toEqual([
		{ path: "body.md", title: "body", snippet: "# w the quokka roams" },
	]);
	expect(await searchDocs(root, "docs", "walrus")).toEqual([]);
});

test("ordering: title hits first, then body-only, tree order within groups", async () => {
	const root = repo();
	write(
		root,
		"docs/a-body.md",
		"---\ntitle: Alpha\n---\n# a\n\nhas the xyzzy word\n",
	);
	write(
		root,
		"docs/b-title.md",
		"---\ntitle: Xyzzy Central\n---\n# b\n\nintro\n",
	);
	write(
		root,
		"docs/folder/c-title.md",
		"---\ntitle: The Xyzzy File\n---\n# c\n\nopener\n",
	);
	write(root, "docs/folder/d-body.md", "# d\n\nxyzzy deep in the body\n");
	commit(root);

	const hits = await searchDocs(root, "docs", "xyzzy");
	// Tree order = depth-first, dirs before root docs: folder/{c,d}, a, b.
	// Title group keeps it (c, b); the body-only group follows (d, a).
	expect(hits.map((h) => h.path)).toEqual([
		"folder/c-title.md",
		"b-title.md",
		"folder/d-body.md",
		"a-body.md",
	]);
});

test("snippet: ~110-char window around the first match, ellipsized when clamped", async () => {
	const root = repo();
	write(root, "docs/s.md", `# s\n\nneedle ${"a".repeat(200)}\n`); // match at the start
	write(
		root,
		"docs/m.md",
		`# m\n\n${"b".repeat(100)} needle ${"c".repeat(200)}\n`,
	); // mid
	write(root, "docs/e.md", `# e\n\n${"d".repeat(300)} needle\n`); // at the end
	commit(root);

	const byPath = Object.fromEntries(
		(await searchDocs(root, "docs", "needle")).map((h) => [h.path, h.snippet]),
	);
	// Start: no leading ellipsis, clamped at 110 chars.
	expect(byPath["s.md"]).toBe(`# s needle ${"a".repeat(99)}…`);
	// Middle: clamped on both sides – 39 chars of lead-in, the match, context.
	expect(byPath["m.md"]).toBe(`…${"b".repeat(39)} needle ${"c".repeat(63)}…`);
	// End: leading ellipsis only, runs to the last char.
	expect(byPath["e.md"]).toBe(`…${"d".repeat(39)} needle`);
});

test("trimmed queries shorter than 2 chars return [] (not an error)", async () => {
	const root = repo();
	write(root, "docs/a.md", "---\ntitle: Ab\n---\n# a\n");
	commit(root);
	for (const q of ["", "a", " ", "  a  "]) {
		expect(await searchDocs(root, "docs", q)).toEqual([]);
	}
});

test("cap: at most 50 hits, tree order preserved up to the cap", async () => {
	const root = repo();
	for (let i = 0; i < 60; i++)
		write(
			root,
			`docs/d${String(i).padStart(2, "0")}.md`,
			"# d\n\nneedle here\n",
		);
	commit(root);

	const hits = await searchDocs(root, "docs", "needle");
	expect(hits).toHaveLength(50);
	expect(hits[0]?.path).toBe("d00.md");
	expect(hits[49]?.path).toBe("d49.md");
});
