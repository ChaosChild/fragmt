import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { mainBranch, repoMeta } from "../src/core/meta.js";

// repoMeta's three walks against real multi-branch tmp repos (comments.test.ts
// pattern): versions/authors from HEAD history, per-branch draft statuses,
// main-branch detection, and the recycle bin.

const dirs: string[] = [];

afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function run(root: string, args: string[]): string {
	return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

/** Fresh tmp repo on the given init branch; autocrlf off keeps bytes stable. */
function repo(branch: string): string {
	const root = mkdtempSync(join(tmpdir(), "fragmt-meta-"));
	run(root, ["init", "-q", "-b", branch]);
	run(root, ["config", "user.name", "Meta Test"]);
	run(root, ["config", "user.email", "meta@example.com"]);
	run(root, ["config", "core.autocrlf", "false"]);
	dirs.push(root);
	return root;
}

/** Stage + commit everything with an explicit author; returns the sha.
 *  --allow-empty keeps seed commits (mainBranch test) working. */
function commit(root: string, author: string, message: string): string {
	run(root, ["add", "-A"]);
	run(root, [
		"commit",
		"-q",
		"--allow-empty",
		`--author=${author}`,
		"-m",
		message,
	]);
	return run(root, ["rev-parse", "HEAD"]);
}

function write(root: string, path: string, body: string): void {
	const abs = join(root, ...path.split("/"));
	mkdirSync(dirname(abs), { recursive: true });
	writeFileSync(abs, body);
}

function remove(root: string, path: string): void {
	rmSync(join(root, ...path.split("/")));
}

test("docs: version counts, newest author/email/date, docsRoot .md filtering", async () => {
	const root = repo("main");
	const longLine = `${"x".repeat(120)} end`;
	write(root, "docs/a.md", "# a\n\nfirst body line of a\n");
	write(root, "docs/b.md", `# b\n\n${longLine}\n| table | row |\n`);
	write(root, "docs/img.png", "png");
	write(root, "README.md", "# readme\n");
	const sha1 = commit(
		root,
		"Alice One <alice@example.com>",
		"two docs + noise",
	);
	write(root, "docs/a.md", "# a v2\n\nsecond body line\n");
	const sha2 = commit(root, "Bob Two <bob@example.com>", "edit a");

	const meta = await repoMeta(root, "docs");
	// Non-md and outside-docsRoot paths never enter the record.
	expect(Object.keys(meta.docs).sort()).toEqual(["a.md", "b.md"]);
	expect(meta.docs["a.md"]).toEqual({
		author: "Bob Two",
		authorEmail: "bob@example.com",
		date: run(root, ["show", "-s", "--format=%aI", sha2]),
		version: 2,
		// First non-heading/non-empty/non-table line; a.md's re-edit swaps it.
		snippet: "second body line",
	});
	expect(meta.docs["b.md"]).toEqual({
		author: "Alice One",
		authorEmail: "alice@example.com",
		date: run(root, ["show", "-s", "--format=%aI", sha1]),
		version: 1,
		// Headings and table lines skipped; the body line clamped to 110 chars.
		snippet: longLine.slice(0, 110),
	});

	// docsRoot "." adopts repo-relative paths as-is.
	const flat = await repoMeta(root, ".");
	expect(Object.keys(flat.docs).sort()).toEqual([
		"README.md",
		"docs/a.md",
		"docs/b.md",
	]);
	expect(flat.docs["docs/a.md"].version).toBe(2);
});

test("drafts: A/M/D per non-main branch, latest status wins, docsRoot only", async () => {
	const root = repo("main");
	write(root, "docs/a.md", "# a\n");
	write(root, "docs/keep.md", "# keep\n");
	commit(root, "Base <base@example.com>", "seed");

	run(root, ["checkout", "-q", "-b", "drafts/one"]);
	write(root, "docs/c.md", "# c\n");
	commit(root, "Drafter <d@example.com>", "add c"); // c: new…
	write(root, "docs/a.md", "# a edited\n");
	commit(root, "Drafter <d@example.com>", "edit a"); // a: edited
	remove(root, "docs/c.md");
	commit(root, "Drafter <d@example.com>", "delete c"); // …c: latest = deleted
	write(root, "README.md", "# readme\n");
	commit(root, "Drafter <d@example.com>", "outside docsRoot"); // ignored

	run(root, ["checkout", "-q", "main"]);
	run(root, ["checkout", "-q", "-b", "drafts/two"]);
	write(root, "docs/a.md", "# a again\n");
	commit(root, "Drafter <d@example.com>", "edit a on two");

	run(root, ["checkout", "-q", "main"]);
	const meta = await repoMeta(root, "docs");
	expect(meta.main).toBe("main");
	expect(meta.current).toBe("main");
	expect(meta.drafts).toEqual({
		"a.md": [
			{ branch: "drafts/one", status: "edited" },
			{ branch: "drafts/two", status: "edited" },
		],
		"c.md": [{ branch: "drafts/one", status: "deleted" }],
	});
});

test("mainBranch: master falls back, main preferred when both exist", async () => {
	const root = repo("master");
	commit(root, "A <a@example.com>", "seed");
	expect(await mainBranch(root)).toBe("master");

	run(root, ["branch", "main"]);
	expect(await mainBranch(root)).toBe("main");
});

test("null main: no draft model — drafts empty, HEAD walks still run", async () => {
	const root = repo("trunk");
	write(root, "docs/only.md", "# only\n");
	commit(root, "A <a@example.com>", "seed");
	run(root, ["checkout", "-q", "-b", "work"]);
	write(root, "docs/only.md", "# only edited\n");
	commit(root, "A <a@example.com>", "edit on work");
	run(root, ["checkout", "-q", "trunk"]);

	const meta = await repoMeta(root, "docs");
	expect(meta.main).toBeNull();
	expect(meta.current).toBe("trunk");
	expect(meta.drafts).toEqual({});
	expect(meta.docs["only.md"].version).toBe(1);
});

test("deleted: delete-commit sha + date, latest first, deduped by path", async () => {
	const root = repo("main");
	write(root, "docs/x.md", "# x\n");
	write(root, "docs/y.md", "# y\n");
	write(root, "docs/note.txt", "txt\n");
	commit(root, "A <a@example.com>", "create x, y");

	remove(root, "docs/x.md");
	commit(root, "A <a@example.com>", "delete x (first)");
	remove(root, "docs/y.md");
	const delY = commit(root, "A <a@example.com>", "delete y");

	write(root, "docs/x.md", "# x restored\n");
	commit(root, "A <a@example.com>", "restore x");
	remove(root, "docs/x.md");
	const delX = commit(root, "A <a@example.com>", "delete x (again)");
	remove(root, "docs/note.txt");
	commit(root, "A <a@example.com>", "delete non-md"); // filtered

	const meta = await repoMeta(root, "docs");
	expect(meta.deleted).toEqual([
		{
			path: "x.md",
			sha: delX,
			date: run(root, ["show", "-s", "--format=%aI", delX]),
		},
		{
			path: "y.md",
			sha: delY,
			date: run(root, ["show", "-s", "--format=%aI", delY]),
		},
	]);
});
