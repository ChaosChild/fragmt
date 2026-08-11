import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { DocPathError, readDoc, resolveDocPath } from "../src/core/index.js";

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
	// Valid path shape, but the file is absent — readDoc must throw, not resolve
	// to an unrelated location.
	expect(() => readDoc(root, ".", "missing.md")).toThrow();
});
