import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { countDocs, gitAllowList, listTree } from "../src/core/index.js";

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

// M4-3 b6: createFolder commits a .gitkeep — a brand-new folder must appear in
// the tree (the sidebar renders its count badge as 0); without the marker a
// docless dir still prunes per the M1 rule.
test("a .gitkeep folder stays visible with 0 docs; a bare empty dir prunes", () => {
	fixture();
	mkdirSync(join(root, "docs", "kept"), { recursive: true });
	writeFileSync(join(root, "docs", "kept", ".gitkeep"), "");
	mkdirSync(join(root, "docs", "plain"), { recursive: true });
	const docs = listTree(root, ".").children?.find((c) => c.name === "docs");
	// kept (0 docs) joins milestones; plain stays pruned.
	expect(docs?.children?.map((c) => c.name)).toEqual([
		"kept",
		"milestones",
		"ARCHITECTURE.md",
		"PLAN.md",
	]);
	const kept = docs?.children?.find((c) => c.name === "kept");
	expect(kept?.type).toBe("dir");
	expect(countDocs(kept ?? { name: "", path: "", type: "doc" })).toBe(0);
});

test("a .gitkeep folder disappears once neither docs nor the marker remain", () => {
	fixture();
	mkdirSync(join(root, "docs", "kept"), { recursive: true });
	writeFileSync(join(root, "docs", "kept", ".gitkeep"), "");
	rmSync(join(root, "docs", "kept", ".gitkeep"));
	const docs = listTree(root, ".").children?.find((c) => c.name === "docs");
	expect(docs?.children?.map((c) => c.name)).toEqual([
		"milestones",
		"ARCHITECTURE.md",
		"PLAN.md",
	]);
});

// --- M4-3 b7: the .gitignore filter (allow-list) ----------------------------
// Real repos behind the walk — ls-files semantics are the thing under test,
// so no simulation: tracked-vs-ignored is asserted against actual git.

/** Real-repo fixture (server-m43's discipline): identity, CRLF off, a seed
 *  commit, and one file per ignore scenario. */
function gitRepoFixture(): void {
	execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
	execFileSync("git", ["config", "user.name", "Tree Test"], { cwd: root });
	execFileSync("git", ["config", "user.email", "tree@example.com"], {
		cwd: root,
	});
	execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: root });
	writeFileSync(join(root, ".gitignore"), "scratch/\ntmp/\nprivate.md\n");
	mkdirSync(join(root, "docs", "scratch"), { recursive: true });
	mkdirSync(join(root, "docs", "tmp"), { recursive: true });
	mkdirSync(join(root, "docs", "empty-kept"), { recursive: true });
	writeFileSync(join(root, "docs", "kept.md"), "# kept"); // tracked
	writeFileSync(join(root, "docs", "private.md"), "# private"); // untracked + ignored
	writeFileSync(join(root, "docs", "new.md"), "# new"); // untracked, NOT ignored
	writeFileSync(join(root, "docs", "scratch", "notes.md"), "# notes"); // ignored dir
	writeFileSync(join(root, "docs", "scratch", "forced.md"), "# forced"); // force-added
	writeFileSync(join(root, "docs", "tmp", "x.md"), "# x"); // fully ignored dir
	writeFileSync(join(root, "docs", "empty-kept", ".gitkeep"), ""); // folder marker
	execFileSync("git", ["add", "-A"], { cwd: root }); // scratch/tmp/private stay out
	execFileSync("git", ["add", "-f", "docs/scratch/forced.md"], { cwd: root });
	execFileSync("git", ["commit", "-q", "-m", "seed"], { cwd: root });
}

test("gitAllowList: tracked and untracked-not-ignored in; ignored out (tracked wins)", async () => {
	gitRepoFixture();
	const allow = await gitAllowList(root, "docs");
	expect(allow).toBeInstanceOf(Set);
	// Tracked — including the force-added file inside an ignored dir: the
	// index wins over any ignore rule, and the .gitkeep folder marker.
	expect(allow?.has("kept.md")).toBe(true);
	expect(allow?.has("scratch/forced.md")).toBe(true);
	expect(allow?.has("empty-kept/.gitkeep")).toBe(true);
	// Untracked but not ignored (--others --exclude-standard lets it through).
	expect(allow?.has("new.md")).toBe(true);
	// Ignored: the file rule, the ignored dir, the fully ignored dir.
	expect(allow?.has("private.md")).toBe(false);
	expect(allow?.has("scratch/notes.md")).toBe(false);
	expect(allow?.has("tmp/x.md")).toBe(false);
});

test("listTree with the allow-list: ignored paths and dead dirs vanish; .gitkeep folder stays", async () => {
	gitRepoFixture();
	const allow = await gitAllowList(root, "docs");
	const docs = listTree(root, "docs", allow ?? undefined);
	// tmp is fully ignored → gone; scratch survives on its tracked file alone;
	// empty-kept holds only the (dot-skipped) marker; private.md is hidden.
	expect(docs.children?.map((c) => c.name)).toEqual([
		"empty-kept",
		"scratch",
		"kept.md",
		"new.md",
	]);
	const scratch = docs.children?.find((c) => c.name === "scratch");
	expect(scratch?.children?.map((c) => c.name)).toEqual(["forced.md"]);
});

test("listTree without an allow-list keeps today's on-disk behavior exactly", () => {
	gitRepoFixture();
	const docs = listTree(root, "docs");
	expect(docs.children?.map((c) => c.name)).toEqual([
		"empty-kept",
		"scratch",
		"tmp",
		"kept.md",
		"new.md",
		"private.md",
	]);
	const scratch = docs.children?.find((c) => c.name === "scratch");
	expect(scratch?.children?.map((c) => c.name)).toEqual([
		"forced.md",
		"notes.md",
	]);
});

test("gitAllowList returns null outside a git repo (the fallback signal)", async () => {
	fixture(); // a plain tmp dir — never a repo
	expect(await gitAllowList(root, "docs")).toBeNull();
});

test("nothing tracked and everything ignored → empty Set, empty tree (not an error)", async () => {
	execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
	writeFileSync(join(root, ".gitignore"), "*.md\n");
	mkdirSync(join(root, "docs"), { recursive: true });
	writeFileSync(join(root, "docs", "x.md"), "# x"); // untracked + ignored
	const allow = await gitAllowList(root, "docs");
	expect(allow).toEqual(new Set());
	expect(listTree(root, "docs", allow ?? undefined).children).toEqual([]);
});
