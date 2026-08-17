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
	checkoutBranch,
	createBranch,
	currentBranch,
	listBranches,
} from "../src/core/index.js";

// Branch round-trip (M3 spec): create / list / checkout against real git repos.

/** Throwaway repo with a seed commit, following the roundtrip test pattern. */
function gitRepo(): string {
	const root = mkdtempSync(join(tmpdir(), "fragmt-git-"));
	const git = (args: string[]) => execFileSync("git", args, { cwd: root });
	git(["init", "-q", "-b", "main"]);
	git(["config", "user.name", "Branch Test"]);
	git(["config", "user.email", "branch@example.com"]);
	// Checkouts must rewrite files byte-stably (global autocrlf is true here).
	git(["config", "core.autocrlf", "false"]);
	writeFileSync(join(root, "seed.md"), "# seed\n");
	git(["add", "-A"]);
	git(["commit", "-q", "-m", "seed"]);
	return root;
}

const repos: string[] = [];

afterEach(() => {
	for (const r of repos.splice(0)) rmSync(r, { recursive: true, force: true });
});

test("create, list, checkout round-trip: content follows the branch", async () => {
	const root = gitRepo();
	repos.push(root);

	expect(await currentBranch(root)).toBe("main");
	expect(await listBranches(root)).toEqual(["main"]);

	await createBranch(root, "drafts/x");
	// Creating does not switch.
	expect(await currentBranch(root)).toBe("main");
	expect(await listBranches(root)).toEqual(["drafts/x", "main"]);

	await checkoutBranch(root, "drafts/x");
	expect(await currentBranch(root)).toBe("drafts/x");
	writeFileSync(join(root, "draft.md"), "# only on the draft\n");
	execFileSync("git", ["add", "-A"], { cwd: root });
	execFileSync("git", ["commit", "-q", "-m", "draft work"], { cwd: root });

	await checkoutBranch(root, "main");
	expect(await currentBranch(root)).toBe("main");
	expect(existsSync(join(root, "draft.md"))).toBe(false);

	await checkoutBranch(root, "drafts/x");
	expect(await currentBranch(root)).toBe("drafts/x");
	expect(readFileSync(join(root, "draft.md"), "utf8")).toBe(
		"# only on the draft\n",
	);
});
