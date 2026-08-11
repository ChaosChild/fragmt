import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { countDocs, listTree } from "../src/core/index.js";

let root: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "fragmt-tree-"));
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

/** Mixed fixture: nested md, a dotfolder, an empty dir, a non-md file, and a
 *  skipped build/dep dir. */
function fixture(): void {
	mkdirSync(join(root, "docs", "milestones"), { recursive: true });
	mkdirSync(join(root, "docs", ".hidden"), { recursive: true });
	mkdirSync(join(root, "docs", "empty"), { recursive: true });
	mkdirSync(join(root, "node_modules"), { recursive: true });
	writeFileSync(join(root, "docs", "PLAN.md"), "# plan");
	writeFileSync(join(root, "docs", "ARCHITECTURE.md"), "# arch");
	writeFileSync(join(root, "docs", "milestones", "M0.md"), "# m0");
	writeFileSync(join(root, "docs", ".hidden", "secret.md"), "# secret"); // dotfolder
	writeFileSync(join(root, "docs", "image.png"), "png"); // non-md
	writeFileSync(join(root, "node_modules", "dep.md"), "# dep"); // skipped dir
	writeFileSync(join(root, "README.md"), "# readme");
}

test("listTree builds the root node with name '.' and empty path", () => {
	fixture();
	const tree = listTree(root, ".");
	expect(tree).toMatchObject({ name: ".", path: "", type: "dir" });
});

test("dirs come first then docs, each alphabetical; skip-list and pruning hold", () => {
	fixture();
	const tree = listTree(root, ".");
	// Top level: docs (dir) before README.md (doc); node_modules skipped.
	expect(tree.children?.map((c) => c.name)).toEqual(["docs", "README.md"]);

	const docs = tree.children?.find((c) => c.name === "docs");
	// Within docs: milestones (dir) first, then docs alphabetical; empty pruned,
	// .hidden skipped, image.png skipped.
	expect(docs?.children?.map((c) => c.name)).toEqual([
		"milestones",
		"ARCHITECTURE.md",
		"PLAN.md",
	]);

	const milestones = docs?.children?.find((c) => c.name === "milestones");
	expect(milestones?.children?.map((c) => c.name)).toEqual(["M0.md"]);
});

test("countDocs totals only adopted .md files", () => {
	fixture();
	// PLAN + ARCHITECTURE + M0 + README (secret/dep skipped, png skipped).
	expect(countDocs(listTree(root, "."))).toBe(4);
});

test("a repo with no markdown yields an empty root", () => {
	mkdirSync(join(root, "emptydir"), { recursive: true });
	const tree = listTree(root, ".");
	expect(tree.children).toEqual([]);
	expect(countDocs(tree)).toBe(0);
});
