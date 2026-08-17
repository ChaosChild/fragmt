import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import {
	createDoc,
	createFolder,
	DocNotFoundError,
	DocPathError,
	deleteDoc,
	deleteFolder,
	listTree,
	moveDoc,
	PathExistsError,
	renameFolder,
} from "../src/core/index.js";

// Each op must be exactly ONE commit (author + message) through commitAs, with
// the guards typed for the server's 400/404/409 mapping. Autocrlf is pinned
// false so byte-exact assertions hold on Windows (sync.test.ts pattern).

const AUTHOR = "Files Test|files@example.com";

const dirs: string[] = [];

afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function run(root: string, args: string[]): string {
	return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

/** Fresh tmp repo with an identity; autocrlf off keeps bytes stable. */
function repo(): string {
	const root = mkdtempSync(join(tmpdir(), "fragmt-files-"));
	run(root, ["init", "-q", "-b", "main"]);
	run(root, ["config", "user.name", "Files Test"]);
	run(root, ["config", "user.email", "files@example.com"]);
	run(root, ["config", "core.autocrlf", "false"]);
	dirs.push(root);
	return root;
}

/** A seed commit made with raw git, independent of the code under test. */
function seed(root: string): void {
	writeFileSync(join(root, "seed.md"), "# Seed\n");
	run(root, ["add", "-A"]);
	run(root, ["commit", "-q", "-m", "seed"]);
}

const count = (root: string) =>
	Number(run(root, ["rev-list", "--count", "HEAD"]));

const lastCommit = (root: string) =>
	run(root, ["log", "-1", "--format=%an|%ae|%s"]);

/** Every doc path in the M1 tree, in tree order. */
function treePaths(node: ReturnType<typeof listTree>): string[] {
	const self = node.type === "doc" ? [node.path] : [];
	return [...self, ...(node.children ?? []).flatMap(treePaths)];
}

test("createDoc writes LF with one trailing newline as exactly one commit", async () => {
	const root = repo();
	seed(root);

	const { sha } = await createDoc(root, ".", "new.md", "# New\r\nbody\r\n");

	expect(readFileSync(join(root, "new.md"), "utf8")).toBe("# New\nbody\n");
	expect(count(root)).toBe(2);
	expect(lastCommit(root)).toBe(`${AUTHOR}|Create new.md`);
	expect(sha).toBe(run(root, ["rev-parse", "HEAD"]));
});

test("createDoc on an existing path throws PathExistsError and commits nothing", async () => {
	const root = repo();
	seed(root);

	await expect(createDoc(root, ".", "seed.md", "again")).rejects.toThrow(
		PathExistsError,
	);

	expect(count(root)).toBe(1);
	expect(readFileSync(join(root, "seed.md"), "utf8")).toBe("# Seed\n");
});

test("moveDoc is one commit; content and history follow the rename", async () => {
	const root = repo();
	seed(root);
	await createDoc(root, ".", "a.md", "# A\n");

	await moveDoc(root, ".", "a.md", "b.md");

	expect(count(root)).toBe(3);
	expect(lastCommit(root)).toBe(`${AUTHOR}|Rename a.md to b.md`);
	expect(existsSync(join(root, "a.md"))).toBe(false);
	expect(readFileSync(join(root, "b.md"), "utf8")).toBe("# A\n");
	expect(run(root, ["log", "--follow", "--format=%s", "b.md"])).toContain(
		"Create a.md",
	);
});

test("deleteDoc is one commit and the file is gone from disk and HEAD", async () => {
	const root = repo();
	seed(root);
	await createDoc(root, ".", "gone.md", "# Gone\n");

	await deleteDoc(root, ".", "gone.md");

	expect(count(root)).toBe(3);
	expect(lastCommit(root)).toBe(`${AUTHOR}|Delete gone.md`);
	expect(existsSync(join(root, "gone.md"))).toBe(false);
	expect(run(root, ["status", "--porcelain"])).toBe("");
});

test("moveDoc rejects a ../ source and a ../ destination", async () => {
	const root = repo();
	seed(root);
	await createDoc(root, ".", "inside.md", "# in\n");

	await expect(moveDoc(root, ".", "../outside.md", "moved.md")).rejects.toThrow(
		DocPathError,
	);
	await expect(
		moveDoc(root, ".", "inside.md", "../outside.md"),
	).rejects.toThrow(DocPathError);

	expect(count(root)).toBe(2);
	expect(existsSync(join(root, "inside.md"))).toBe(true);
});

test("moveDoc and deleteDoc on a missing path throw DocNotFoundError", async () => {
	const root = repo();
	seed(root);

	await expect(moveDoc(root, ".", "nope.md", "moved.md")).rejects.toThrow(
		DocNotFoundError,
	);
	await expect(deleteDoc(root, ".", "nope.md")).rejects.toThrow(
		DocNotFoundError,
	);

	expect(count(root)).toBe(1);
});

test("createFolder commits a .gitkeep the tree never lists", async () => {
	const root = repo();
	seed(root);

	await createFolder(root, ".", "notes");

	expect(count(root)).toBe(2);
	expect(lastCommit(root)).toBe(`${AUTHOR}|Create notes`);
	expect(readFileSync(join(root, "notes", ".gitkeep"), "utf8")).toBe("");
	// .gitkeep is a dotfile: invisible to the tree, and the folder it holds up
	// (no .md anywhere) is pruned with it.
	expect(treePaths(listTree(root, "."))).toEqual(["seed.md"]);
});

test("renameFolder is one commit; docs inside keep content and paths", async () => {
	const root = repo();
	seed(root);
	await createFolder(root, ".", "notes");
	await createDoc(root, ".", "notes/a.md", "# A\n");

	await renameFolder(root, ".", "notes", "docs");

	expect(count(root)).toBe(4);
	expect(lastCommit(root)).toBe(`${AUTHOR}|Rename notes to docs`);
	expect(existsSync(join(root, "notes"))).toBe(false);
	expect(readFileSync(join(root, "docs", "a.md"), "utf8")).toBe("# A\n");
	expect(readFileSync(join(root, "docs", ".gitkeep"), "utf8")).toBe("");
	expect(treePaths(listTree(root, "."))).toEqual(["docs/a.md", "seed.md"]);
	expect(run(root, ["status", "--porcelain"])).toBe("");
});

test("deleteFolder removes the folder and its docs in one commit", async () => {
	const root = repo();
	seed(root);
	await createDoc(root, ".", "notes/a.md", "# A\n");

	await deleteFolder(root, ".", "notes");

	expect(count(root)).toBe(3);
	expect(lastCommit(root)).toBe(`${AUTHOR}|Delete notes`);
	expect(existsSync(join(root, "notes"))).toBe(false);
	expect(run(root, ["status", "--porcelain"])).toBe("");
});

test("folder ops: existing target → PathExistsError, missing folder → DocNotFoundError", async () => {
	const root = repo();
	seed(root);

	await createFolder(root, ".", "notes");
	await expect(createFolder(root, ".", "notes")).rejects.toThrow(
		PathExistsError,
	);
	await expect(renameFolder(root, ".", "nope", "moved")).rejects.toThrow(
		DocNotFoundError,
	);
	await expect(deleteFolder(root, ".", "nope")).rejects.toThrow(
		DocNotFoundError,
	);

	// Only the successful createFolder committed.
	expect(count(root)).toBe(2);
});
