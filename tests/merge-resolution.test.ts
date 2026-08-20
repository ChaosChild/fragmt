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
import type { CommentFile, CommentThread } from "../src/core/comments.js";
import {
	abortMerge,
	concludeMerge,
	inMerge,
	MergeUnresolvedError,
	mergeState,
	mergeToMain,
	resolveMergeDoc,
	resolveMergeSidecar,
} from "../src/core/drafts.js";
import { repoMeta } from "../src/core/meta.js";

// The M4-4 b2 merge-resolution flows against real tmp repos (drafts.test.ts
// harness): a stood conflict on a doc + a sidecar, per-file resolution, the
// merge commit, abort mid-way, and the unresolvable fallback (drafts.test.ts).

const dirs: string[] = [];

afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function run(root: string, args: string[]): string {
	return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function repo(): string {
	const root = mkdtempSync(join(tmpdir(), "fragmt-merge-"));
	run(root, ["init", "-q", "-b", "main"]);
	run(root, ["config", "user.name", "Merge Test"]);
	run(root, ["config", "user.email", "merge@example.com"]);
	run(root, ["config", "core.autocrlf", "false"]);
	dirs.push(root);
	return root;
}

function write(root: string, path: string, body: string): void {
	const abs = join(root, ...path.split("/"));
	mkdirSync(dirname(abs), { recursive: true });
	writeFileSync(abs, body);
}

function commit(root: string, message: string): string {
	run(root, ["add", "-A"]);
	run(root, ["commit", "-q", "-m", message]);
	return run(root, ["rev-parse", "HEAD"]);
}

const current = (root: string) =>
	run(root, ["rev-parse", "--abbrev-ref", "HEAD"]);

/** Sidecar text in the serializer's exact format (writeComments pattern). */
const sidecarText = (file: CommentFile): string =>
	`${JSON.stringify(file, null, "\t")}\n`;

const openReply = {
	author: "Seed",
	body: "open",
	at: "2026-01-01T00:00:00.000Z",
};
const seedThread: CommentThread = {
	id: "t1",
	quote: "base",
	author: "Seed",
	createdAt: "2026-01-01T00:00:00.000Z",
	resolved: false,
	replies: [openReply],
};

/**
 * A repo where main and drafts/c both edited docs/a.md's single line AND
 * appended a different reply to the same sidecar thread — two unmerged
 * paths, both resolvable in-tool. Returns main's pre-merge head.
 */
function conflicted(): { root: string; mainHead: string } {
	const root = repo();
	write(root, "docs/a.md", "# base\n");
	write(
		root,
		".docs/comments/a.md.json",
		sidecarText({ comments: { t1: seedThread } }),
	);
	commit(root, "seed");
	run(root, ["checkout", "-q", "-b", "drafts/c"]);
	write(root, "docs/a.md", "# draft\n");
	write(
		root,
		".docs/comments/a.md.json",
		sidecarText({
			comments: {
				t1: {
					...seedThread,
					replies: [
						...seedThread.replies,
						{
							author: "Draft",
							body: "draft reply",
							at: "2026-02-01T00:00:00.000Z",
						},
					],
				},
			},
		}),
	);
	commit(root, "draft edit");
	run(root, ["checkout", "-q", "main"]);
	write(root, "docs/a.md", "# main\n");
	write(
		root,
		".docs/comments/a.md.json",
		sidecarText({
			comments: {
				t1: {
					...seedThread,
					replies: [
						...seedThread.replies,
						{
							author: "Main",
							body: "main reply",
							at: "2026-03-01T00:00:00.000Z",
						},
					],
				},
			},
		}),
	);
	const mainHead = commit(root, "main edit");
	run(root, ["checkout", "-q", "drafts/c"]);
	return { root, mainHead };
}

test("stand-conflicted merge: stays on main, mergeState details, resolution stages, conclude commits", async () => {
	const { root } = conflicted();
	expect(inMerge(root)).toBe(false);

	const r = await mergeToMain(root, "docs");
	expect(r.merged).toBe(false);
	if (r.merged || !r.conflict || !r.stood)
		throw new Error("expected a stood conflict");
	expect(r.branch).toBe("drafts/c");
	expect([...r.files].sort()).toEqual([
		".docs/comments/a.md.json",
		"docs/a.md",
	]);
	expect(current(root)).toBe("main");
	expect(inMerge(root)).toBe(true);

	const state = await mergeState(root, "docs");
	expect(state.inMerge).toBe(true);
	if (!state.inMerge) throw new Error("unreachable");
	expect(state.branch).toBe("drafts/c");
	expect(state.remaining).toBe(2);
	const doc = state.files.find((f) => f.kind === "doc");
	if (doc?.kind !== "doc") throw new Error("no doc in merge state");
	// ours = stage :2: = HEAD (main); theirs = stage :3: = the draft.
	expect(doc).toEqual({
		path: "docs/a.md",
		kind: "doc",
		parts: [{ ours: "# main\n", theirs: "# draft\n" }],
	});
	const sidecar = state.files.find((f) => f.kind === "sidecar");
	expect(sidecar).toEqual({
		path: ".docs/comments/a.md.json",
		kind: "sidecar",
		summary: {
			keptFromOurs: 1,
			keptFromTheirs: 0,
			resolvedCarried: 0,
			repliesMerged: 1,
		},
	});

	// The meta summary (resolution mode's on-switch, b3).
	const meta = await repoMeta(root, "docs");
	expect(meta.merge).toEqual({ branch: "drafts/c", remaining: 2 });

	// Resolve the doc by assembling parts (theirs) — verbatim, including the
	// missing trailing newline (no canonicalization happens here).
	const assembled = doc.parts
		.map((p) => ("text" in p ? p.text : p.theirs))
		.join("");
	expect(assembled).toBe("# draft\n");
	await resolveMergeDoc(root, "docs/a.md", assembled.replace(/\n$/, ""));
	expect(readFileSync(join(root, "docs/a.md"), "utf8")).toBe("# draft");
	expect(run(root, ["diff", "--name-only", "--diff-filter=U"])).toBe(
		".docs/comments/a.md.json",
	);
	const midMerge = await mergeState(root, "docs");
	if (!midMerge.inMerge) throw new Error("unreachable");
	expect(midMerge.remaining).toBe(1);
	expect(midMerge.files.map((f) => f.path)).toEqual([
		".docs/comments/a.md.json",
	]);

	// Resolve the sidecar with the union: on disk in the serializer's exact
	// format, replies = ours' (open + main) then theirs' new (draft).
	await resolveMergeSidecar(root, ".docs/comments/a.md.json", "merged");
	const onDisk = readFileSync(join(root, ".docs/comments/a.md.json"), "utf8");
	const parsed = JSON.parse(onDisk) as CommentFile;
	expect(onDisk).toBe(`${JSON.stringify(parsed, null, "\t")}\n`);
	expect(parsed.comments.t1.replies).toEqual([
		openReply,
		{ author: "Main", body: "main reply", at: "2026-03-01T00:00:00.000Z" },
		{ author: "Draft", body: "draft reply", at: "2026-02-01T00:00:00.000Z" },
	]);
	expect(parsed.comments.t1.resolved).toBe(false);

	// Conclude: the merge commit, branch cleaned up, nothing left standing.
	const { sha } = await concludeMerge(root);
	expect(sha).toBe(run(root, ["rev-parse", "HEAD"]));
	expect(
		run(root, ["rev-list", "--parents", "-n", "1", "HEAD"]).split(" ").length,
	).toBe(3);
	expect(run(root, ["log", "-1", "--format=%s"])).toMatch(
		/^Merge branch 'drafts\/c'/,
	);
	expect(run(root, ["branch", "--list", "drafts/c"])).toBe("");
	expect(run(root, ["status", "--porcelain"])).toBe("");
	expect(inMerge(root)).toBe(false);
	expect(await mergeState(root, "docs")).toEqual({ inMerge: false });
	expect((await repoMeta(root, "docs")).merge).toBe(null);
});

test("resolveMergeSidecar: ours/theirs write the chosen stage through the serializer; re-stand works", async () => {
	const { root } = conflicted();
	await mergeToMain(root, "docs");

	const oursStage = JSON.parse(
		run(root, ["show", ":2:.docs/comments/a.md.json"]),
	) as CommentFile;
	await resolveMergeSidecar(root, ".docs/comments/a.md.json", "ours");
	expect(readFileSync(join(root, ".docs/comments/a.md.json"), "utf8")).toBe(
		`${JSON.stringify(oursStage, null, "\t")}\n`,
	);

	// Abort mid-resolution, stand the same conflict again, take theirs.
	await abortMerge(root);
	expect(current(root)).toBe("drafts/c");
	const again = await mergeToMain(root, "docs");
	if (again.merged || !again.stood) throw new Error("expected a re-stand");

	const theirsStage = JSON.parse(
		run(root, ["show", ":3:.docs/comments/a.md.json"]),
	) as CommentFile;
	await resolveMergeSidecar(root, ".docs/comments/a.md.json", "theirs");
	expect(readFileSync(join(root, ".docs/comments/a.md.json"), "utf8")).toBe(
		`${JSON.stringify(theirsStage, null, "\t")}\n`,
	);
	// The theirs choice concludes cleanly too: main ends up with the draft's
	// sidecar (open + draft reply, no main reply).
	await resolveMergeDoc(root, "docs/a.md", "# draft\n");
	await concludeMerge(root);
	const merged = JSON.parse(
		readFileSync(join(root, ".docs/comments/a.md.json"), "utf8"),
	) as CommentFile;
	expect(merged.comments.t1.replies).toEqual([
		openReply,
		{ author: "Draft", body: "draft reply", at: "2026-02-01T00:00:00.000Z" },
	]);
	expect(existsSync(join(root, ".git", "MERGE_HEAD"))).toBe(false);
});

test("abortMerge mid-way: clean tree, HEAD back on the draft, main untouched", async () => {
	const { root, mainHead } = conflicted();
	await mergeToMain(root, "docs");
	await resolveMergeDoc(root, "docs/a.md", "# partially resolved\n");
	expect(inMerge(root)).toBe(true);

	await abortMerge(root);

	expect(inMerge(root)).toBe(false);
	expect(await mergeState(root, "docs")).toEqual({ inMerge: false });
	expect(current(root)).toBe("drafts/c");
	expect(run(root, ["status", "--porcelain"])).toBe("");
	expect(readFileSync(join(root, "docs/a.md"), "utf8")).toBe("# draft\n");
	expect(run(root, ["rev-parse", "main"])).toBe(mainHead);
	expect(run(root, ["branch", "--list", "drafts/c"])).not.toBe("");
});

test("concludeMerge: refuses while unmerged paths remain (nothing written)", async () => {
	const { root } = conflicted();
	await mergeToMain(root, "docs");
	const headBefore = run(root, ["rev-parse", "HEAD"]);

	await expect(concludeMerge(root)).rejects.toThrow(MergeUnresolvedError);

	await resolveMergeDoc(root, "docs/a.md", "# ok\n");
	await expect(concludeMerge(root)).rejects.toThrow(MergeUnresolvedError); // sidecar still unmerged
	expect(run(root, ["rev-parse", "HEAD"])).toBe(headBefore);
	expect(inMerge(root)).toBe(true);
});
