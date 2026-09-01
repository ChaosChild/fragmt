import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
	DocNotFoundError,
	DocPathError,
	readDoc,
	resolveDocPath,
	setTitle,
} from "../src/core/index.js";

let root: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "fragmt-docs-"));
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

test("readDoc splits frontmatter from the body", () => {
	writeFileSync(
		join(root, "with.md"),
		"---\ntitle: T\nauthor: a\n---\n# body\n",
	);
	const doc = readDoc(root, ".", "with.md");
	expect(doc.path).toBe("with.md");
	expect(doc.frontmatter).toEqual({ title: "T", author: "a" });
	expect(doc.markdown.trim()).toBe("# body");
	expect(doc.rawFrontmatter).toContain("title: T");
});

test("readDoc handles a doc without frontmatter", () => {
	writeFileSync(join(root, "plain.md"), "# just body\n");
	const doc = readDoc(root, ".", "plain.md");
	expect(doc.frontmatter).toEqual({});
	expect(doc.rawFrontmatter).toBe("");
	expect(doc.markdown.trim()).toBe("# just body");
});

test("resolveDocPath accepts a nested path inside docsRoot", () => {
	mkdirSync(join(root, "docs"), { recursive: true });
	writeFileSync(join(root, "docs", "x.md"), "# x");
	const doc = readDoc(root, ".", "docs/x.md");
	expect(doc.markdown.trim()).toBe("# x");
});

test.each([
	["parent escape", "../LICENSE"],
	["nested parent escape", "docs/../../LICENSE"],
	["absolute path", "/etc/passwd"],
	["non-markdown extension", "notes.txt"],
])("resolveDocPath rejects %s", (_label, bad) => {
	expect(() => resolveDocPath(root, ".", bad)).toThrow(DocPathError);
});

test("readDoc maps a missing doc to a thrown error (not a fs crash)", () => {
	writeFileSync(join(root, "a.md"), "# a");
	// Valid path shape, but the file is absent – readDoc must throw, not resolve
	// to an unrelated location.
	expect(() => readDoc(root, ".", "missing.md")).toThrow();
});

// --- setTitle (M4-3 b4): the display-name write – path never changes ------

const AUTHOR = "Docs Test|docs@example.com";
const gitDirs: string[] = [];

afterEach(() => {
	for (const d of gitDirs.splice(0))
		rmSync(d, { recursive: true, force: true });
});

/** Fresh tmp git repo with an identity; autocrlf off keeps bytes stable. */
function gitRepo(): string {
	const r = mkdtempSync(join(tmpdir(), "fragmt-docs-git-"));
	for (const args of [
		["init", "-q", "-b", "main"],
		["config", "user.name", "Docs Test"],
		["config", "user.email", "docs@example.com"],
		["config", "core.autocrlf", "false"],
	])
		execFileSync("git", args, { cwd: r });
	gitDirs.push(r);
	return r;
}

function gitOut(r: string, args: string[]): string {
	return execFileSync("git", args, { cwd: r, encoding: "utf8" }).trim();
}

describe("setTitle", () => {
	test("creates a title on a title-less doc, keeping other frontmatter and the path", async () => {
		const r = gitRepo();
		writeFileSync(join(r, "with.md"), "---\nauthor: a\n---\n\n# body\n");
		gitOut(r, ["add", "-A"]);
		gitOut(r, ["commit", "-q", "-m", "seed"]);

		const { sha } = await setTitle(r, ".", "with.md", "Notes: draft");

		// One commit, the rename message, the file path untouched.
		expect(gitOut(r, ["rev-list", "--count", "HEAD"])).toBe("2");
		expect(gitOut(r, ["log", "-1", "--format=%an|%ae|%s"])).toBe(
			`${AUTHOR}|Rename with.md to Notes: draft`,
		);
		expect(sha).toBe(gitOut(r, ["rev-parse", "HEAD"]));
		// Byte discipline: `author` keeps its line verbatim, the title
		// appends at the fence's end, body + gap unchanged.
		expect(readFileSync(join(r, "with.md"), "utf8")).toBe(
			'---\nauthor: a\ntitle: "Notes: draft"\n---\n\n# body\n',
		);
		const doc = readDoc(r, ".", "with.md");
		expect(doc.frontmatter).toEqual({ author: "a", title: "Notes: draft" });
		expect(doc.markdown).toBe("# body\n");
	});

	test("updates an existing title in place; nothing else moves", async () => {
		const r = gitRepo();
		writeFileSync(join(r, "t.md"), "---\ntitle: Old\nauthor: a\n---\n# body\n");
		gitOut(r, ["add", "-A"]);
		gitOut(r, ["commit", "-q", "-m", "seed"]);

		await setTitle(r, ".", "t.md", "New");

		// The title line keeps its position (first), the author line its bytes.
		expect(readFileSync(join(r, "t.md"), "utf8")).toBe(
			'---\ntitle: "New"\nauthor: a\n---\n# body\n',
		);
		expect(gitOut(r, ["rev-list", "--count", "HEAD"])).toBe("2");
	});

	test("adds frontmatter to a bare doc (none existed)", async () => {
		const r = gitRepo();
		writeFileSync(join(r, "plain.md"), "# body\n");
		gitOut(r, ["add", "-A"]);
		gitOut(r, ["commit", "-q", "-m", "seed"]);

		await setTitle(r, ".", "plain.md", "Titled");

		expect(readFileSync(join(r, "plain.md"), "utf8")).toBe(
			'---\ntitle: "Titled"\n---\n# body\n',
		);
	});

	test("whitespace-only title throws, commits nothing", async () => {
		const r = gitRepo();
		writeFileSync(join(r, "a.md"), "# a\n");
		gitOut(r, ["add", "-A"]);
		gitOut(r, ["commit", "-q", "-m", "seed"]);

		await expect(setTitle(r, ".", "a.md", "   ")).rejects.toThrow(DocPathError);
		expect(gitOut(r, ["rev-list", "--count", "HEAD"])).toBe("1");
		expect(readFileSync(join(r, "a.md"), "utf8")).toBe("# a\n");
	});

	test("missing doc throws DocNotFoundError; traversal throws DocPathError", async () => {
		const r = gitRepo();
		await expect(setTitle(r, ".", "nope.md", "T")).rejects.toThrow(
			DocNotFoundError,
		);
		await expect(setTitle(r, ".", "../out.md", "T")).rejects.toThrow(
			DocPathError,
		);
	});
});
