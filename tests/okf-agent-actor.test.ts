// OKF rungs 3–4 e2e (#33): the commit-wrapped trust flows on real git repos –
// a UI-shaped writeDoc save stamps `generated` (and a `verified` event when
// flagged, actor verbatim) into the same commit as the refs propagation,
// verifyDoc's standalone event, comment-resolve's sidecar+doc single commit
// (with the non-OKF repo staying sidecar-only), the agent CLI's draft
// --merge stamp riding the merge with the post-merge populateOkf regen, the
// D4 default actor, and --fix/createDoc materializing status: draft (A3).
import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { runAgent } from "../src/cli/agent.js";
import {
	AGENT_DEFAULT,
	addThread,
	createDoc,
	DocPathError,
	docHash,
	fixOkf,
	readComments,
	readDoc,
	setDocMeta,
	setResolved,
	verifyDoc,
	writeConfig,
	writeDoc,
} from "../src/core/index.js";

const dirs: string[] = [];

afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function run(root: string, args: string[]): string {
	return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

/** Fresh tmp repo with an OKF config and the actor@example.com identity. */
function repo(okf = true): string {
	const root = mkdtempSync(join(tmpdir(), "fragmt-okfactor-"));
	run(root, ["init", "-q", "-b", "main"]);
	run(root, ["config", "user.name", "Actor Test"]);
	run(root, ["config", "user.email", "actor@example.com"]);
	run(root, ["config", "core.autocrlf", "false"]);
	writeConfig(root, ".", okf);
	dirs.push(root);
	return root;
}

function seed(root: string, rel: string, text: string): void {
	mkdirSync(dirname(join(root, rel)), { recursive: true });
	writeFileSync(join(root, rel), text);
}

const commitFiles = (root: string) =>
	run(root, ["show", "--name-only", "--format=", "HEAD"]).split("\n");

const CONFORMANT = "---\ntype: Concept\n---\n\n# X\n";

/** Save a doc body through the real writeDoc (stale hash from disk). */
async function save(
	root: string,
	rel: string,
	body: string,
	opts: { verified?: boolean; actor?: string } = {},
) {
	return writeDoc(
		root,
		".",
		rel,
		body,
		docHash(readDoc(root, ".", rel).markdown),
		undefined,
		opts,
	);
}

/** runAgent with the writer injected: exit code + the emitted lines. */
async function agent(
	root: string,
	args: string[],
): Promise<{ code: number; out: string[] }> {
	const lines: string[] = [];
	const code = await runAgent(args, root, (s) => {
		lines.push(s.trimEnd());
	});
	return { code, out: lines };
}

const byOf = (fm: Record<string, unknown>) =>
	(fm.generated as { by: string }).by;

// --- writeDoc's stamp + refs, one commit --------------------------------------

test("a UI-shaped save stamps generated and propagates refs in one commit", async () => {
	const root = repo();
	seed(root, "a.md", CONFORMANT);
	seed(root, "b.md", CONFORMANT);
	run(root, ["add", "-A"]);
	run(root, ["commit", "-q", "-m", "seed"]);

	await save(root, "a.md", "# A\n\nSee [B](/b.md).\n");

	const a = readDoc(root, ".", "a.md");
	expect(byOf(a.frontmatter)).toBe("human:actor");
	expect(a.frontmatter.references).toEqual(["b.md"]);
	// Propagation stamps nothing on the target – only the saved doc.
	const b = readDoc(root, ".", "b.md");
	expect(b.frontmatter["referenced-by"]).toEqual(["a.md"]);
	expect(b.frontmatter.generated).toBeUndefined();
	expect(commitFiles(root)).toEqual(["a.md", "b.md"]);
	expect(run(root, ["log", "-1", "--format=%s"])).toBe("Update a.md");
});

test("Save-as-Verified lands the event in the save's commit; actor verbatim", async () => {
	const root = repo();
	seed(root, "a.md", CONFORMANT);
	run(root, ["add", "-A"]);
	run(root, ["commit", "-q", "-m", "seed"]);

	await save(root, "a.md", "# A v2\n", { verified: true, actor: "claude/4.5" });

	const a = readDoc(root, ".", "a.md");
	expect(byOf(a.frontmatter)).toBe("claude/4.5");
	expect(a.frontmatter.verified).toEqual([
		expect.objectContaining({ by: "claude/4.5" }),
	]);
	expect(commitFiles(root)).toEqual(["a.md"]); // no targets – still one commit
});

test("saving a fence-less doc in OKF mode gains the fence and the stamp", async () => {
	const root = repo();
	seed(root, "a.md", "# bare\n");
	run(root, ["add", "-A"]);
	run(root, ["commit", "-q", "-m", "seed"]);

	await save(root, "a.md", "# bare v2\n");

	const a = readDoc(root, ".", "a.md");
	expect(a.frontmatter.type).toBe("concept");
	expect(byOf(a.frontmatter)).toBe("human:actor");
});

// --- verifyDoc ------------------------------------------------------------------

test("verifyDoc appends the identity's event in one Verify commit", async () => {
	const root = repo();
	seed(root, "a.md", CONFORMANT);
	run(root, ["add", "-A"]);
	run(root, ["commit", "-q", "-m", "seed"]);

	const { sha } = await verifyDoc(root, ".", "a.md");

	expect(sha).toBe(run(root, ["rev-parse", "HEAD"]));
	expect(readDoc(root, ".", "a.md").frontmatter.verified).toEqual([
		expect.objectContaining({ by: "human:actor" }),
	]);
	expect(run(root, ["log", "-1", "--format=%s"])).toBe("Verify a.md");
	// generated untouched – verification is independent of generation (§5.2).
	expect(readDoc(root, ".", "a.md").frontmatter.generated).toBeUndefined();
});

// --- comment-resolve's rider ------------------------------------------------------

test("comment-resolve appends the resolver's event beside the sidecar in one commit", async () => {
	const root = repo();
	seed(root, "a.md", CONFORMANT);
	run(root, ["add", "-A"]);
	run(root, ["commit", "-q", "-m", "seed"]);
	await addThread(root, "a.md", "t1", "quote", "open");

	await setResolved(root, "a.md", "t1", true);

	expect((await readComments(root, "a.md")).comments.t1?.resolved).toBe(true);
	expect(readDoc(root, ".", "a.md").frontmatter.verified).toEqual([
		expect.objectContaining({ by: "human:actor" }),
	]);
	expect(commitFiles(root).sort()).toEqual(
		[".docs/comments/a.md.json", "a.md"].sort(),
	);
	expect(run(root, ["log", "-1", "--format=%s"])).toBe(
		"Update comments for a.md",
	);

	// Reopening never touches verified (append-only history).
	await setResolved(root, "a.md", "t1", false);
	expect(
		(readDoc(root, ".", "a.md").frontmatter.verified as unknown[]).length,
	).toBe(1);
	expect(commitFiles(root)).toEqual([".docs/comments/a.md.json"]);
});

test("comment-resolve in a non-OKF repo stays sidecar-only, doc bytes identical", async () => {
	const root = repo(false);
	seed(root, "a.md", CONFORMANT);
	run(root, ["add", "-A"]);
	run(root, ["commit", "-q", "-m", "seed"]);
	await addThread(root, "a.md", "t1", "quote", "open");

	await setResolved(root, "a.md", "t1", true);

	expect(commitFiles(root)).toEqual([".docs/comments/a.md.json"]);
	expect(readFileSync(join(root, "a.md"), "utf8")).toBe(CONFORMANT);
});

// --- the agent CLI's --as-actor (D4) ----------------------------------------------

test("draft --merge --as-actor stamps the draft, rides the merge, then repopulates", async () => {
	const root = repo();
	seed(root, "a.md", "---\ntype: Concept\n---\n\n# A\n\nSee [B](/b.md).\n");
	seed(root, "b.md", CONFORMANT);
	run(root, ["add", "-A"]);
	run(root, ["commit", "-q", "-m", "seed"]);
	run(root, ["checkout", "-q", "-b", "drafts/a"]);
	seed(root, "a.md", "---\ntype: Concept\n---\n\n# A v2\n\nSee [B](/b.md).\n");
	run(root, ["add", "-A"]);
	run(root, ["commit", "-q", "-m", "edit a"]);

	const r = await agent(root, [
		"draft",
		"a.md",
		"--merge",
		"--as-actor",
		"claude/4.5",
	]);

	expect(r.code).toBe(0);
	expect(run(root, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe("main");
	expect(run(root, ["branch", "--list", "drafts/a"])).toBe("");
	// The stamp commit rode into main…
	expect(run(root, ["log", "--format=%s", "main"]).split("\n")).toContain(
		"OKF: stamp a.md as claude/4.5",
	);
	const a = readDoc(root, ".", "a.md");
	expect(byOf(a.frontmatter)).toBe("claude/4.5");
	// …and the post-merge populateOkf refreshed the derived graph.
	expect(a.frontmatter.references).toEqual(["b.md"]);
	expect(readDoc(root, ".", "b.md").frontmatter["referenced-by"]).toEqual([
		"a.md",
	]);
});

test("draft --merge without --as-actor stamps the D4 default, never a human prefix", async () => {
	const root = repo();
	seed(root, "a.md", CONFORMANT);
	run(root, ["add", "-A"]);
	run(root, ["commit", "-q", "-m", "seed"]);
	run(root, ["checkout", "-q", "-b", "drafts/a"]);
	seed(root, "a.md", CONFORMANT.replace("# X", "# X v2"));
	run(root, ["add", "-A"]);
	run(root, ["commit", "-q", "-m", "edit"]);

	const r = await agent(root, ["draft", "a.md", "--merge"]);

	expect(r.code).toBe(0);
	const by = byOf(readDoc(root, ".", "a.md").frontmatter);
	expect(by).toBe(AGENT_DEFAULT);
	expect(by.startsWith("human:")).toBe(false);
});

test("comment --resolve --as-actor rides the declared actor on the sidecar's commit", async () => {
	const root = repo();
	seed(root, "a.md", CONFORMANT);
	run(root, ["add", "-A"]);
	run(root, ["commit", "-q", "-m", "seed"]);
	await addThread(root, "a.md", "t1", "quote", "open");

	const r = await agent(root, [
		"comment",
		"a.md",
		"--thread",
		"t1",
		"--resolve",
		"--as-actor",
		"claude/4.5",
	]);

	expect(r.code).toBe(0);
	expect(readDoc(root, ".", "a.md").frontmatter.verified).toEqual([
		expect.objectContaining({ by: "claude/4.5" }),
	]);
	expect((await readComments(root, "a.md")).comments.t1?.resolved).toBe(true);
	expect(run(root, ["log", "-1", "--format=%s"])).toBe(
		"Update comments for a.md",
	);
	expect(commitFiles(root).sort()).toEqual(
		[".docs/comments/a.md.json", "a.md"].sort(),
	);
});

// --- status always explicit (A3) ----------------------------------------------------

test("fixOkf materializes status: draft where the key is absent, fence-less included", async () => {
	const root = repo();
	seed(root, "fenceless.md", "# bare\n");
	seed(root, "typed.md", "---\ntype: Metric\ntitle: keep\n---\n\n# T\n");
	seed(
		root,
		"explicit.md",
		'---\ntype: Metric\nstatus: "stable"\n---\n\n# S\n',
	);
	run(root, ["add", "-A"]);
	run(root, ["commit", "-q", "-m", "seed"]);

	await fixOkf(root, ".");

	expect(readDoc(root, ".", "fenceless.md").frontmatter.status).toBe("draft");
	expect(readDoc(root, ".", "typed.md").frontmatter.status).toBe("draft");
	// A present status is the author's choice – never overwritten.
	expect(readDoc(root, ".", "explicit.md").frontmatter.status).toBe("stable");
});

test("createDoc is born draft beside the type (A3)", async () => {
	const root = repo();
	seed(root, "a.md", CONFORMANT);
	run(root, ["add", "-A"]);
	run(root, ["commit", "-q", "-m", "seed"]);

	await createDoc(root, ".", "new.md", "# N\n");

	expect(readFileSync(join(root, "new.md"), "utf8")).toBe(
		'---\ntype: concept\nstatus: "draft"\n---\n# N\n',
	);
});

test("reserved files carry no concept frontmatter on any write path (§3.1)", async () => {
	const root = repo();
	seed(root, "index.md", "# Index\n\n* [a](/a.md)\n");
	seed(root, "a.md", CONFORMANT);
	run(root, ["add", "-A"]);
	run(root, ["commit", "-q", "-m", "seed"]);

	// A body save keeps the reserved file fence-less: no generated stamp,
	// no verified event, no derived fields – the plain write path.
	const doc = readDoc(root, ".", "index.md");
	await writeDoc(
		root,
		".",
		"index.md",
		"# Index\n\n* [a](/a.md)\n\nedited\n",
		docHash(doc.markdown),
	);
	const afterSave = readFileSync(join(root, "index.md"), "utf8");
	expect(afterSave.startsWith("---")).toBe(false);
	expect(afterSave).toContain("edited");

	// The field-writing affordances refuse outright (the server's 400).
	await expect(verifyDoc(root, ".", "index.md")).rejects.toThrow(DocPathError);
	await expect(
		setDocMeta(root, ".", "index.md", [{ key: "status", value: "stable" }]),
	).rejects.toThrow(DocPathError);
	expect(readFileSync(join(root, "index.md"), "utf8")).toBe(afterSave);
});
