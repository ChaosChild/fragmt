import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { createDoc, docHash, readDoc, writeDoc } from "../src/core/index.js";

// #20 batch 1: the optional trailing `user` on the core write ops – a
// signed-in user becomes the commit AUTHOR (committer stays the machine
// identity); omitted → exactly the old localUser() behavior.

const ADA = { name: "Ada Lovelace", email: "ada@example.com" };

const repos: string[] = [];

afterEach(() => {
	for (const r of repos.splice(0)) rmSync(r, { recursive: true, force: true });
});

/** Throwaway repo with a configured local identity (draft-diff.test.ts pattern). */
function gitRepo(): string {
	const root = mkdtempSync(join(tmpdir(), "fragmt-author-"));
	const git = (args: string[]) => execFileSync("git", args, { cwd: root });
	git(["init", "-q", "-b", "main"]);
	git(["config", "user.name", "Local User"]);
	git(["config", "user.email", "local@example.com"]);
	git(["config", "core.autocrlf", "false"]);
	return root;
}

function commitField(root: string, format: string): string {
	return execFileSync("git", ["log", "-1", `--format=${format}`], {
		cwd: root,
	})
		.toString()
		.trim();
}

test("createDoc with an explicit user: user is the author, committer stays local", async () => {
	const root = gitRepo();
	repos.push(root);
	await createDoc(root, ".", "a.md", "# a", ADA);
	expect(commitField(root, "%an|%ae")).toBe("Ada Lovelace|ada@example.com");
	expect(commitField(root, "%cn|%ce")).toBe("Local User|local@example.com");
});

test("writeDoc with an explicit user authors the edit commit", async () => {
	const root = gitRepo();
	repos.push(root);
	await createDoc(root, ".", "a.md", "# a", ADA);
	const doc = readDoc(root, ".", "a.md");
	const grace = { name: "Grace Hopper", email: "grace@example.com" };
	await writeDoc(root, ".", "a.md", "# edited\n", docHash(doc.markdown), grace);
	expect(commitField(root, "%an|%ae")).toBe("Grace Hopper|grace@example.com");
	expect(commitField(root, "%cn|%ce")).toBe("Local User|local@example.com");
});

test("no user → the repo's configured identity (unchanged behavior)", async () => {
	const root = gitRepo();
	repos.push(root);
	await createDoc(root, ".", "b.md", "# b");
	expect(commitField(root, "%an|%ae")).toBe("Local User|local@example.com");
	expect(commitField(root, "%cn|%ce")).toBe("Local User|local@example.com");
});
