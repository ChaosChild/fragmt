// OKF rungs 1–2 core (#21): the three §11 conformance clauses over the
// shared enumeration, the §3.1 reserved rule, the D2 index.md shape (type
// sections, descriptions, Subdirectories last, root-only okf_version), the
// config flag's tolerance, and fixOkf's type forcing. Plain tmp dirs – the
// allow-list walk falls back outside git; only the fixOkf commit needs a
// real repo (files.test.ts pattern). References-graph behavior lives in
// okf-references.test.ts, the CLI flows in okf-init.test.ts.
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
import { afterEach, beforeEach, expect, test } from "vitest";
import {
	configPath,
	enableOkf,
	fixOkf,
	generateIndexes,
	isReservedBase,
	loadConfig,
	validateOkf,
	writeConfig,
} from "../src/core/index.js";

let root: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "fragmt-okf-"));
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

const write = (rel: string, text: string) => {
	mkdirSync(dirname(join(root, rel)), { recursive: true });
	writeFileSync(join(root, rel), text);
};
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

test("a conformant bundle passes all three clauses", async () => {
	write("a.md", "---\ntype: Metric\ntitle: A\n---\n# A\n");
	write("sub/b.md", "---\ntype: Playbook\n---\n# B\n");
	write(
		"index.md",
		'---\nokf_version: "0.2"\n---\n# Playbook\n\n* [B](/sub/b.md)\n',
	);
	write(
		"log.md",
		"# Log\n\n## 2026-09-15\n* **Update**: x.\n\n## 2026-09-01\n* y.\n",
	);
	const { conformant, findings } = await validateOkf(root, ".");
	expect(findings).toEqual([]);
	expect(conformant).toBe(true);
});

test("clause a: missing, unclosed, and unparseable frontmatter each flag", async () => {
	write("plain.md", "# no fence\n");
	write("unclosed.md", "---\ntitle: x\n# body\n");
	write("broken.md", "---\ntitle: [unclosed\n---\n# body\n");
	const { findings } = await validateOkf(root, ".");
	expect(findings).toHaveLength(3);
	for (const f of findings) expect(f.clause).toBe("frontmatter");
	const plain = findings.find((f) => f.path === "plain.md");
	expect(plain?.detail).toBe("missing frontmatter block");
	const unclosed = findings.find((f) => f.path === "unclosed.md");
	expect(unclosed?.detail).toBe("unclosed frontmatter block");
	const broken = findings.find((f) => f.path === "broken.md");
	expect(broken?.detail).toContain("unparseable frontmatter");
});

test("clause b: missing, empty, and non-string type flag; unknown types pass", async () => {
	write("none.md", "---\nauthor: a\n---\n# x\n");
	write("empty.md", '---\ntype: ""\n---\n# x\n');
	write("blank.md", "---\ntype:   \n---\n# x\n");
	write("num.md", "---\ntype: 42\n---\n# x\n");
	write("odd.md", "---\ntype: Some Unknown Family\n---\n# x\n");
	const { findings } = await validateOkf(root, ".");
	expect(findings.map((f) => f.path)).toEqual([
		"blank.md",
		"empty.md",
		"none.md",
		"num.md",
	]);
	for (const f of findings) {
		expect(f.clause).toBe("type");
		expect(f.detail).toBe("missing or empty type");
	}
});

test("clause c: reserved files are exempt from the type requirement", async () => {
	write("index.md", "# Metric\n\n* [A](/a.md)\n");
	write("log.md", "## 2026-09-15\n* x.\n");
	write("a.md", "---\ntype: Metric\n---\n# A\n");
	const { conformant } = await validateOkf(root, ".");
	expect(conformant).toBe(true);
});

test("clause c: index frontmatter outside the root, or beyond okf_version, flags", async () => {
	write("a.md", "---\ntype: Metric\n---\n# A\n");
	write("sub/index.md", "---\ntype: Metric\n---\n# Sub\n");
	write(
		"index.md",
		'---\nokf_version: "0.2"\ntitle: Root\n---\n# Metric\n\n* [A](/a.md)\n',
	);
	const { findings } = await validateOkf(root, ".");
	expect(findings).toHaveLength(2);
	expect(findings.find((f) => f.path === "sub/index.md")?.clause).toBe(
		"reserved",
	);
	expect(findings.find((f) => f.path === "index.md")?.detail).toContain(
		"only okf_version",
	);
});

test("clause c: index shape violations (deep heading, linkless entry)", async () => {
	write("index.md", "# Metric\n\n## Group\n\n* [A](/a.md)\n\n* no link here\n");
	write("a.md", "---\ntype: Metric\n---\n# A\n");
	const { findings } = await validateOkf(root, ".");
	expect(findings).toHaveLength(2);
	expect(findings[0].clause).toBe("reserved");
	expect(findings.map((f) => f.detail).join("\n")).toContain(
		"level-1 headings",
	);
	expect(findings.map((f) => f.detail).join("\n")).toContain("without a link");
});

test("clause c: log date heading form and newest-first order", async () => {
	write("log.md", "# Log\n\n## 09/15/2026\n* x.\n\n## 2026-09-01\n* y.\n");
	const form = await validateOkf(root, ".");
	expect(form.findings).toHaveLength(1);
	expect(form.findings[0].detail).toContain("## YYYY-MM-DD");

	write("log.md", "# Log\n\n## 2026-09-01\n* old.\n\n## 2026-09-15\n* new.\n");
	const order = await validateOkf(root, ".");
	expect(order.findings).toHaveLength(1);
	expect(order.findings[0].detail).toContain("newest first");
});

test("findings are grouped by clause, then path", async () => {
	write("z.md", "# no fence\n");
	write("a.md", "---\nauthor: x\n---\n# A\n");
	write("m.md", "---\ntype: M\n---\n# M\n");
	write("index.md", "---\ntype: X\n---\n# Root\n");
	const { findings } = await validateOkf(root, ".");
	expect(findings.map((f) => `${f.clause}:${f.path}`)).toEqual([
		"frontmatter:z.md",
		"type:a.md",
		"reserved:index.md",
	]);
});

test("generateIndexes: D2 shape – sections, descriptions, Subdirectories last, root-only okf_version", async () => {
	write(
		"a.md",
		"---\ntype: Metric\ntitle: Orders Metric\ndescription: One row per order.\n---\n# A\n",
	);
	write("b.md", "---\ntype: Playbook\n---\n# B\n");
	write("c.md", '---\ntype: Metric\ndescription: ""\n---\n# C\n');
	write("sub/d.md", "---\ntype: Playbook\n---\n# D\n");
	const written = await generateIndexes(root, ".");
	expect(written.sort()).toEqual(["index.md", "sub/index.md"].sort());
	expect(read("index.md")).toBe(
		[
			"---",
			'okf_version: "0.2"',
			"---",
			"",
			"# Metric",
			"",
			"* [c](/c.md)",
			"* [Orders Metric](/a.md) - One row per order.",
			"",
			"# Playbook",
			"",
			"* [b](/b.md)",
			"",
			"# Subdirectories",
			"",
			"* [sub](/sub/index.md)",
			"",
		].join("\n"),
	);
	// Non-root indexes carry no frontmatter; links stay bundle-absolute.
	expect(read("sub/index.md")).toBe("# Playbook\n\n* [d](/sub/d.md)\n");
});

test("generateIndexes: an unchanged index is not rewritten", async () => {
	write("a.md", "---\ntype: Metric\n---\n# A\n");
	await generateIndexes(root, ".");
	const second = await generateIndexes(root, ".");
	expect(second).toEqual([]);
});

test("isReservedBase matches the basename at any depth, case-insensitively", () => {
	expect(isReservedBase("index.md")).toBe(true);
	expect(isReservedBase("sub/LOG.md")).toBe(true);
	expect(isReservedBase("log.md.bak")).toBe(false);
	expect(isReservedBase("indexes.md")).toBe(false);
});

// --- config flag -----------------------------------------------------------

test("writeConfig emits okf only when true; loadConfig tolerates anything else", () => {
	writeConfig(root, "docs");
	expect(readFileSync(configPath(root), "utf8")).toBe(
		`${JSON.stringify({ docsRoot: "docs", order: {} }, null, "\t")}\n`,
	);
	expect(loadConfig(root).okf).toBeUndefined();

	writeConfig(root, "docs", true);
	expect(JSON.parse(readFileSync(configPath(root), "utf8"))).toEqual({
		docsRoot: "docs",
		order: {},
		okf: true,
	});
	expect(loadConfig(root).okf).toBe(true);

	for (const bad of ["yes", 1, null]) {
		writeFileSync(
			configPath(root),
			JSON.stringify({ docsRoot: ".", okf: bad }),
		);
		expect(loadConfig(root).okf).toBeUndefined();
	}
});

test("enableOkf flips the flag while preserving the rest of the config", () => {
	writeFileSync(
		configPath(root),
		JSON.stringify({
			docsRoot: ".",
			authors: { "a@example.com": "alice" },
			agents: ["Claude"],
		}),
	);
	enableOkf(root);
	expect(loadConfig(root)).toEqual({
		docsRoot: ".",
		authors: { "a@example.com": "alice" },
		agents: ["Claude"],
		okf: true,
	});
});

// --- fixOkf's conformance repairs (needs the commit) ------------------------

const gitDirs: string[] = [];

afterEach(() => {
	for (const d of gitDirs.splice(0))
		rmSync(d, { recursive: true, force: true });
});

function gitRepo(): string {
	const r = mkdtempSync(join(tmpdir(), "fragmt-okf-git-"));
	for (const args of [
		["init", "-q", "-b", "main"],
		["config", "user.name", "OKF Test"],
		["config", "user.email", "okf@example.com"],
		["config", "core.autocrlf", "false"],
	])
		execFileSync("git", args, { cwd: r });
	gitDirs.push(r);
	return r;
}

function gitOut(r: string, args: string[]): string {
	return execFileSync("git", args, { cwd: r, encoding: "utf8" }).trim();
}

test("fixOkf: prepends the block, forces type in place, materializes absent status – one commit", async () => {
	const r = gitRepo();
	const put = (rel: string, text: string) => writeFileSync(join(r, rel), text);
	put("a.md", "content a\n");
	put("b.md", "---\nauthor: x\n---\n\n# B\n");
	put(
		"c.md",
		"---\ntype:  Playbook\ntags:   [a, b]\n---\n\n# C\n\nkept: as-is\n",
	);
	gitOut(r, ["add", "-A"]);
	gitOut(r, ["commit", "-q", "-m", "seed"]);

	const { sha, files } = await fixOkf(r, ".");

	expect(files.sort()).toEqual(["a.md", "b.md", "c.md", "index.md"].sort());
	expect(readFileSync(join(r, "a.md"), "utf8")).toBe(
		'---\ntype: concept\nstatus: "draft"\n---\ncontent a\n',
	);
	expect(readFileSync(join(r, "b.md"), "utf8")).toBe(
		'---\nauthor: x\ntype: "concept"\nstatus: "draft"\n---\n\n# B\n',
	);
	// Non-canonical but conformant YAML keeps its bytes verbatim – A3's
	// status line appends at the fence end, nothing else is touched.
	expect(readFileSync(join(r, "c.md"), "utf8")).toBe(
		'---\ntype:  Playbook\ntags:   [a, b]\nstatus: "draft"\n---\n\n# C\n\nkept: as-is\n',
	);
	expect(gitOut(r, ["log", "-1", "--format=%s"])).toBe(
		"OKF: apply conformance fixes",
	);
	expect(sha).toBe(gitOut(r, ["rev-parse", "HEAD"]));
	expect(gitOut(r, ["rev-list", "--count", "HEAD"])).toBe("2");
	const check = await validateOkf(r, ".");
	expect(check.conformant).toBe(true);
});

test("fixOkf: an adopted bundle's directory links self-heal to the index.md shape (4B)", async () => {
	const r = gitRepo();
	const put = (rel: string, text: string) => {
		mkdirSync(dirname(join(r, rel)), { recursive: true });
		writeFileSync(join(r, rel), text);
	};
	// Conformant already (type + status present) – the ONLY drift is the
	// root index's pre-4B `* [sub](/sub/)` subdirectory entry.
	put("sub/d.md", '---\ntype: Playbook\nstatus: "stable"\n---\n# D\n');
	put(
		"index.md",
		'---\nokf_version: "0.2"\n---\n\n# Playbook\n\n* [D](/sub/d.md)\n\n# Subdirectories\n\n* [sub](/sub/)\n',
	);
	gitOut(r, ["add", "-A"]);
	gitOut(r, ["commit", "-q", "-m", "seed"]);

	const { files } = await fixOkf(r, ".");

	// generateIndexes rides the fix's commit (the populateOkf precedent):
	// the root index re-links to sub's own index.md, and sub/index.md is
	// born in the same pass – the UI reads both as ordinary doc links.
	expect(files.sort()).toEqual(["index.md", "sub/index.md"].sort());
	expect(readFileSync(join(r, "index.md"), "utf8")).toContain(
		"* [sub](/sub/index.md)",
	);
	const check = await validateOkf(r, ".");
	expect(check.conformant).toBe(true);
});
