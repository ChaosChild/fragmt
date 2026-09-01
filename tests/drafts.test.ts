import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, test } from "vitest";
import {
	mergeToMain,
	nextDraftName,
	OnMainBranchError,
	restoreDoc,
	startDraft,
} from "../src/core/drafts.js";
import { PathExistsError } from "../src/core/files.js";

// nextDraftName is pure – slug rules and collision suffixes, no git involved.

test("slug: basename minus .md, lowercase, non-[a-z0-9] → '-', trimmed", () => {
	expect(nextDraftName([], "docs/M4-2-drafting.md")).toBe(
		"drafts/m4-2-drafting",
	);
	expect(nextDraftName([], "M4-2-drafting.md")).toBe("drafts/m4-2-drafting");
	expect(nextDraftName([], "PLAN.md")).toBe("drafts/plan");
	expect(nextDraftName([], "My Doc! v2.md")).toBe("drafts/my-doc--v2");
	expect(nextDraftName([], "_Notes_.md")).toBe("drafts/notes");
});

test("collisions append -2, -3, …; free base name taken as-is", () => {
	expect(nextDraftName(["drafts/other"], "plan.md")).toBe("drafts/plan");
	expect(nextDraftName(["drafts/plan"], "plan.md")).toBe("drafts/plan-2");
	expect(nextDraftName(["drafts/plan", "drafts/plan-2"], "plan.md")).toBe(
		"drafts/plan-3",
	);
	// A taken suffixed name does not displace the free base name.
	expect(nextDraftName(["drafts/plan-2"], "plan.md")).toBe("drafts/plan");
});

// startDraft / mergeToMain / restoreDoc against real tmp repos (meta.test.ts
// pattern) – every git call outside the code under test is raw execFileSync.

const dirs: string[] = [];

afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function run(root: string, args: string[]): string {
	return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

/** Fresh tmp repo on main with an identity; autocrlf off keeps bytes stable. */
function repo(): string {
	const root = mkdtempSync(join(tmpdir(), "fragmt-drafts-"));
	run(root, ["init", "-q", "-b", "main"]);
	run(root, ["config", "user.name", "Drafts Test"]);
	run(root, ["config", "user.email", "drafts@example.com"]);
	run(root, ["config", "core.autocrlf", "false"]);
	dirs.push(root);
	return root;
}

function write(root: string, path: string, body: string): void {
	const abs = join(root, ...path.split("/"));
	mkdirSync(dirname(abs), { recursive: true });
	writeFileSync(abs, body);
}

/** Stage + commit everything; returns the new HEAD sha. */
function commit(root: string, message: string): string {
	run(root, ["add", "-A"]);
	run(root, ["commit", "-q", "-m", message]);
	return run(root, ["rev-parse", "HEAD"]);
}

const current = (root: string) =>
	run(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
const count = (root: string) =>
	Number(run(root, ["rev-list", "--count", "HEAD"]));
const lastMessage = (root: string) => run(root, ["log", "-1", "--format=%s"]);
const lastFiles = (root: string) =>
	run(root, ["show", "--name-only", "--format=", "HEAD"])
		.split("\n")
		.filter(Boolean)
		.sort();

test("startDraft: fresh branch from main, no-op on a draft, reuse of a touching branch", async () => {
	const root = repo();
	write(root, "docs/a.md", "# a\n");
	write(root, "docs/b.md", "# b\n");
	commit(root, "seed");

	// docPath is docsRoot-relative, like every other core fn.
	const made = await startDraft(root, "a.md", "docs");
	expect(made).toEqual({ current: "drafts/a", reused: false });
	expect(current(root)).toBe("drafts/a");

	// Already drafting (any doc): stay put, nothing created.
	expect(await startDraft(root, "b.md", "docs")).toEqual({
		current: "drafts/a",
		reused: true,
	});
	expect(current(root)).toBe("drafts/a");

	// A branch whose diff touches b.md is the draft to rejoin from main.
	run(root, ["checkout", "-q", "main"]);
	run(root, ["checkout", "-q", "-b", "drafts/taken"]);
	write(root, "docs/b.md", "# b v2\n");
	commit(root, "edit b");
	run(root, ["checkout", "-q", "main"]);
	expect(await startDraft(root, "b.md", "docs")).toEqual({
		current: "drafts/taken",
		reused: true,
	});
	expect(current(root)).toBe("drafts/taken");

	// No branch touches a.md (drafts/a has no commits) → a fresh name that
	// collides with the existing drafts/a.
	run(root, ["checkout", "-q", "main"]);
	expect(await startDraft(root, "a.md", "docs")).toEqual({
		current: "drafts/a-2",
		reused: false,
	});
});

test("mergeToMain: clean merge lands on main, branch deleted, sha returned; on main → OnMainBranchError", async () => {
	const root = repo();
	write(root, "docs/a.md", "# a\n");
	commit(root, "seed");
	run(root, ["checkout", "-q", "-b", "drafts/w"]);
	write(root, "docs/a.md", "# a v2\n");
	write(root, "docs/new.md", "# new\n");
	const draftHead = commit(root, "draft work");

	const r = await mergeToMain(root);
	expect(r.merged).toBe(true);
	if (!r.merged) throw new Error("expected a clean merge");
	expect(r.sha).toBe(draftHead); // fast-forward: main == the draft head
	expect(current(root)).toBe("main");
	expect(run(root, ["branch", "--list", "drafts/w"])).toBe("");
	expect(readFileSync(join(root, "docs/new.md"), "utf8")).toBe("# new\n");

	await expect(mergeToMain(root)).rejects.toThrow(OnMainBranchError);
});

test("mergeToMain: conflict on a non-doc file → aborted (stood:false), tree clean, still on the draft", async () => {
	const root = repo();
	write(root, "docs/a.md", "# a\n");
	write(root, "README.md", "# base\n");
	commit(root, "seed");
	run(root, ["checkout", "-q", "-b", "drafts/c"]);
	write(root, "README.md", "# draft\n");
	commit(root, "draft edit");
	run(root, ["checkout", "-q", "main"]);
	write(root, "README.md", "# main\n");
	const mainHead = commit(root, "main edit");
	run(root, ["checkout", "-q", "drafts/c"]);

	const r = await mergeToMain(root, "docs");
	expect(r.merged).toBe(false);
	if (r.merged) throw new Error("expected a conflict");
	expect(r.conflict).toBe(true);
	expect(r.stood).toBe(false);
	if (r.stood) throw new Error("expected the abort path");
	expect(r.files).toEqual(["README.md"]);
	expect(r.message).toMatch(/CONFLICT/);
	expect(current(root)).toBe("drafts/c");
	expect(run(root, ["status", "--porcelain"])).toBe("");
	expect(readFileSync(join(root, "README.md"), "utf8")).toBe("# draft\n");
	expect(run(root, ["rev-parse", "main"])).toBe(mainHead);
	expect(run(root, ["branch", "--list", "drafts/c"])).not.toBe("");
});

test("restoreDoc: doc + sidecar back in ONE `Restore` commit; existing doc → PathExistsError", async () => {
	const root = repo();
	write(root, "docs/gone.md", "# gone\n");
	commit(root, "create");
	mkdirSync(join(root, ".docs/comments"), { recursive: true });
	writeFileSync(
		join(root, ".docs/comments/gone.md.json"),
		'{"comments":{"c1":{"id":"c1"}}}\n',
	);
	commit(root, "sidecar");
	rmSync(join(root, "docs/gone.md"));
	const deleteSha = commit(root, "delete gone");
	const before = count(root);

	const { sha } = await restoreDoc(root, "docs", "gone.md", deleteSha);

	expect(sha).toBe(run(root, ["rev-parse", "HEAD"]));
	expect(count(root)).toBe(before + 1); // exactly one restore commit
	expect(lastMessage(root)).toBe("Restore gone.md");
	expect(lastFiles(root)).toEqual([
		".docs/comments/gone.md.json",
		"docs/gone.md",
	]);
	expect(readFileSync(join(root, "docs/gone.md"), "utf8")).toBe("# gone\n");
	expect(
		JSON.parse(readFileSync(join(root, ".docs/comments/gone.md.json"), "utf8")),
	).toEqual({ comments: { c1: { id: "c1" } } });
	expect(run(root, ["status", "--porcelain"])).toBe("");

	await expect(restoreDoc(root, "docs", "gone.md", deleteSha)).rejects.toThrow(
		PathExistsError,
	);
});

test("restoreDoc: no sidecar at the delete commit → doc alone, still one commit", async () => {
	const root = repo();
	write(root, "docs/plain.md", "---\ntitle: P\n---\n\n# plain\n");
	commit(root, "create");
	rmSync(join(root, "docs/plain.md"));
	const deleteSha = commit(root, "delete plain");

	await restoreDoc(root, "docs", "plain.md", deleteSha);

	expect(readFileSync(join(root, "docs/plain.md"), "utf8")).toBe(
		"---\ntitle: P\n---\n\n# plain\n",
	);
	expect(existsSync(join(root, ".docs"))).toBe(false);
	expect(lastMessage(root)).toBe("Restore plain.md");
	expect(lastFiles(root)).toEqual(["docs/plain.md"]);
});
