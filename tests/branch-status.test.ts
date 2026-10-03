import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import {
	branchStatus,
	InvalidBranchNameError,
} from "../src/core/branch-status.js";

// ui v1 phase 7: the branch menu's ahead/behind + conflict line, against
// real tmp repos (drafts.test.ts pattern).

const dirs: string[] = [];

afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function run(root: string, args: string[]): string {
	return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function repo(): string {
	const root = mkdtempSync(join(tmpdir(), "fragmt-bstatus-"));
	run(root, ["init", "-q", "-b", "main"]);
	run(root, ["config", "user.name", "Status Test"]);
	run(root, ["config", "user.email", "status@example.com"]);
	run(root, ["config", "core.autocrlf", "false"]);
	dirs.push(root);
	return root;
}

function commitFile(root: string, file: string, body: string, msg: string) {
	writeFileSync(join(root, file), body);
	run(root, ["add", "-A"]);
	run(root, ["commit", "-q", "-m", msg]);
}

test("a clean draft: ahead/behind counted, no conflict, tip date in ISO", async () => {
	const root = repo();
	commitFile(root, "a.md", "one\ntwo\n", "seed");
	run(root, ["switch", "-q", "-c", "drafts/x"]);
	commitFile(root, "b.md", "draft only\n", "draft 1");
	commitFile(root, "c.md", "draft only\n", "draft 2");
	run(root, ["switch", "-q", "main"]);
	commitFile(root, "d.md", "main only\n", "main moves on");

	const s = await branchStatus(root, "main", "drafts/x");
	expect(s).toMatchObject({
		name: "drafts/x",
		ahead: 2,
		behind: 1,
		conflicts: false,
	});
	expect(Number.isNaN(Date.parse(s.lastCommitAt))).toBe(false);
	// Read-only: still on main, nothing staged, no merge in progress.
	expect(run(root, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe("main");
	expect(run(root, ["status", "--porcelain"])).toBe("");
});

test("a draft editing the same line as main conflicts", async () => {
	const root = repo();
	commitFile(root, "a.md", "one\ntwo\n", "seed");
	run(root, ["switch", "-q", "-c", "drafts/y"]);
	commitFile(root, "a.md", "one\ntwo – the draft's\n", "draft edit");
	run(root, ["switch", "-q", "main"]);
	commitFile(root, "a.md", "one\ntwo – main's\n", "main edit");

	const s = await branchStatus(root, "main", "drafts/y");
	expect(s.conflicts).toBe(true);
	expect(s.ahead).toBe(1);
	expect(s.behind).toBe(1);
	expect(run(root, ["status", "--porcelain"])).toBe("");
});

test("an invalid branch name is rejected before any git spawn", async () => {
	// Not a repo at all: had git run, this would be a GitError instead.
	const notARepo = mkdtempSync(join(tmpdir(), "fragmt-bstatus-none-"));
	dirs.push(notARepo);
	for (const bad of ["-x", "a..b", "with space", ""]) {
		await expect(branchStatus(notARepo, "main", bad)).rejects.toBeInstanceOf(
			InvalidBranchNameError,
		);
		await expect(
			branchStatus(notARepo, bad, "drafts/x"),
		).rejects.toBeInstanceOf(InvalidBranchNameError);
	}
});
