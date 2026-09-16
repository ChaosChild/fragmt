// OKF references core (#21, §A1): extractRefs over both §6.1 link forms
// (fenced-block skip, broken links, containment, self-links, reserved
// targets), the updateRefsField raw splice, writeDoc's referenced-by
// propagation (add/remove/retarget as one commit over the symmetric
// difference), the stale-target batch abort, and fixOkf's single-pass
// population. The writeDoc/fixOkf halves need a real repo (files.test.ts
// pattern); extraction and the splice are pure.
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
import {
	docHash,
	extractRefs,
	fixOkf,
	propagateRefs,
	readDoc,
	StaleDocError,
	updateRefsField,
	validateOkf,
	writeConfig,
	writeDoc,
} from "../src/core/index.js";

// --- extractRefs (pure) -----------------------------------------------------

const ALL = [
	"a.md",
	"b.md",
	"dir/c.md",
	"dir/d.md",
	"dir/nested/e.md",
	"index.md",
	"dir/index.md",
];

test("extracts bundle-absolute links, sorted and deduplicated", () => {
	const body = "See [b](/b.md), again [b2](/b.md), and [c](/dir/c.md).\n";
	expect(extractRefs(body, "a.md", ALL)).toEqual(["b.md", "dir/c.md"]);
});

test("extracts relative links against the doc's own directory", () => {
	const body =
		"Neighbor [c](./c.md), up [a](../a.md), sibling [d](d.md), deep [e](nested/e.md).\n";
	expect(extractRefs(body, "dir/c.md", ALL)).toEqual([
		"a.md",
		"dir/d.md",
		"dir/nested/e.md",
	]);
});

test("links inside fenced code blocks are ignored", () => {
	const body = [
		"Text [b](/b.md).",
		"",
		"```",
		"[a](/a.md)",
		"```",
		"",
		"~~~",
		"[c](/dir/c.md)",
		"~~~",
		"",
		"After [d](/dir/d.md).",
	].join("\n");
	expect(extractRefs(body, "a.md", ALL)).toEqual(["b.md", "dir/d.md"]);
});

test("broken, escaping, external, and non-doc targets are skipped silently", () => {
	const body = [
		"Broken [gone](/nope.md) and [rel-gone](./missing.md).",
		"Escape [out](../../etc/passwd.md) and [root](/).",
		"Web [docs](https://example.com/x.md), [mail](mailto:a@b.md), [anchor](#a.md).",
		"Image ![pic](/b.md) is not a link; [txt](/notes.txt) is not a doc.",
	].join("\n");
	expect(extractRefs(body, "a.md", ALL)).toEqual([]);
});

test("self-links and reserved targets are excluded", () => {
	const body =
		"Me [a](/a.md), [idx](/index.md), [sub idx](/dir/index.md), [b](/b.md).\n";
	expect(extractRefs(body, "a.md", ALL)).toEqual(["b.md"]);
});

// --- updateRefsField (setTitle splice, generalized) --------------------------

test("updateRefsField replaces in place, appends at the fence end, removes when empty", () => {
	const raw = '\nauthor: x\nreferences: ["old.md"]';
	expect(updateRefsField(raw, "references", ["new.md", "other.md"])).toBe(
		'\nauthor: x\nreferences: ["new.md", "other.md"]',
	);
	expect(updateRefsField("\nauthor: x", "referenced-by", ["a.md"])).toBe(
		'\nauthor: x\nreferenced-by: ["a.md"]',
	);
	expect(updateRefsField(raw, "references", [])).toBe("\nauthor: x");
	expect(updateRefsField("", "references", ["a.md"])).toBe(
		'references: ["a.md"]',
	);
	expect(updateRefsField("", "references", [])).toBe("");
});

// --- writeDoc propagation + the stale gate (real repo) -----------------------

const dirs: string[] = [];

afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function run(root: string, args: string[]): string {
	return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

/** Fresh tmp repo with an OKF config and an identity. */
function repo(): string {
	const root = mkdtempSync(join(tmpdir(), "fragmt-okfrefs-"));
	run(root, ["init", "-q", "-b", "main"]);
	run(root, ["config", "user.name", "Refs Test"]);
	run(root, ["config", "user.email", "refs@example.com"]);
	run(root, ["config", "core.autocrlf", "false"]);
	writeConfig(root, ".", true);
	dirs.push(root);
	return root;
}

function seedDoc(root: string, rel: string, text: string): void {
	mkdirSync(dirname(join(root, rel)), { recursive: true });
	writeFileSync(join(root, rel), text);
}

const commitFiles = (root: string) =>
	run(root, ["show", "--name-only", "--format=", "HEAD"]).split("\n");

const CONFORMANT = (title: string) =>
	`---\ntype: Concept\ntitle: ${title}\n---\n\n# ${title}\n`;

/** Save a doc body through the real writeDoc (stale hash from the disk state). */
async function save(root: string, rel: string, body: string) {
	return writeDoc(
		root,
		".",
		rel,
		body,
		docHash(readDoc(root, ".", rel).markdown),
	);
}

test("a save that adds a link populates references and the target's referenced-by in one commit", async () => {
	const root = repo();
	seedDoc(root, "a.md", CONFORMANT("A"));
	seedDoc(root, "b.md", "---\ntype: Concept\n---\n\n# B\n");
	run(root, ["add", "-A"]);
	run(root, ["commit", "-q", "-m", "seed"]);

	await save(root, "a.md", "# A\n\nSee [B](/b.md).\n");

	expect(readDoc(root, ".", "a.md").frontmatter.references).toEqual(["b.md"]);
	const b = readDoc(root, ".", "b.md");
	expect(b.frontmatter["referenced-by"]).toEqual(["a.md"]);
	expect(readFileSync(join(root, "b.md"), "utf8")).toBe(
		'---\ntype: Concept\nreferenced-by: ["a.md"]\n---\n\n# B\n',
	);
	expect(run(root, ["log", "-1", "--format=%s"])).toBe("Update a.md");
	expect(commitFiles(root)).toEqual(["a.md", "b.md"]);
});

test("a save that drops a link removes the target's referenced-by in the same commit", async () => {
	const root = repo();
	seedDoc(
		root,
		"a.md",
		'---\ntype: Concept\nreferences: ["b.md"]\n---\n\n# A\n',
	);
	seedDoc(
		root,
		"b.md",
		'---\ntype: Concept\nreferenced-by: ["a.md"]\n---\n\n# B\n',
	);
	run(root, ["add", "-A"]);
	run(root, ["commit", "-q", "-m", "seed"]);

	await save(root, "a.md", "# A\n\nNo link anymore.\n");

	expect(readDoc(root, ".", "a.md").frontmatter.references).toBeUndefined();
	expect(
		readDoc(root, ".", "b.md").frontmatter["referenced-by"],
	).toBeUndefined();
	// The empty list keys are removed outright, not left as [].
	expect(readFileSync(join(root, "b.md"), "utf8")).toBe(
		"---\ntype: Concept\n---\n\n# B\n",
	);
	expect(commitFiles(root)).toEqual(["a.md", "b.md"]);
});

test("retargeting a link settles both edges: old target loses, new gains", async () => {
	const root = repo();
	seedDoc(root, "a.md", CONFORMANT("A"));
	seedDoc(root, "b.md", CONFORMANT("B"));
	seedDoc(root, "c.md", CONFORMANT("C"));
	run(root, ["add", "-A"]);
	run(root, ["commit", "-q", "-m", "seed"]);
	await save(root, "a.md", "# A\n\n[B](/b.md)\n");

	await save(root, "a.md", "# A\n\n[C](/c.md)\n");

	expect(readDoc(root, ".", "a.md").frontmatter.references).toEqual(["c.md"]);
	expect(
		readDoc(root, ".", "b.md").frontmatter["referenced-by"],
	).toBeUndefined();
	expect(readDoc(root, ".", "c.md").frontmatter["referenced-by"]).toEqual([
		"a.md",
	]);
	expect(commitFiles(root)).toEqual(["a.md", "b.md", "c.md"]);
});

test("a target that changed since load aborts the whole batch before any write", async () => {
	const root = mkdtempSync(join(tmpdir(), "fragmt-okfstale-"));
	dirs.push(root);
	seedDoc(root, "b.md", "---\ntype: Concept\n---\n\n# B\n");
	const disk = readFileSync(join(root, "b.md"), "utf8");

	// The seam hands propagation one version, then a concurrently-edited one
	// at the verify pass – the batch must die without writing.
	let reads = 0;
	const raced = (_abs: string) => {
		reads += 1;
		return reads === 1 ? disk : `${disk}\n<!-- concurrent save -->\n`;
	};
	await expect(
		propagateRefs(root, ".", "a.md", [], ["b.md"], raced),
	).rejects.toThrow(StaleDocError);
	expect(reads).toBe(2);
	expect(readFileSync(join(root, "b.md"), "utf8")).toBe(disk);
});

test("fixOkf populates both fields across the repo in its single pass", async () => {
	const root = repo();
	seedDoc(root, "a.md", "# A\n\nSee [B](/b.md) and [C](/sub/c.md).\n");
	seedDoc(root, "b.md", "# B\n");
	seedDoc(root, "sub/c.md", "# C\n");
	run(root, ["add", "-A"]);
	run(root, ["commit", "-q", "-m", "seed"]);

	await fixOkf(root, ".");

	expect(readFileSync(join(root, "a.md"), "utf8")).toBe(
		'---\ntype: concept\nstatus: "draft"\nreferences: ["b.md", "sub/c.md"]\n---\n# A\n\nSee [B](/b.md) and [C](/sub/c.md).\n',
	);
	expect(readFileSync(join(root, "b.md"), "utf8")).toBe(
		'---\ntype: concept\nstatus: "draft"\nreferenced-by: ["a.md"]\n---\n# B\n',
	);
	const c = readDoc(root, ".", "sub/c.md");
	expect(c.frontmatter["referenced-by"]).toEqual(["a.md"]);
	const check = await validateOkf(root, ".");
	expect(check.conformant).toBe(true);
	expect(run(root, ["log", "-1", "--format=%s"])).toBe(
		"OKF: apply conformance fixes",
	);
});
