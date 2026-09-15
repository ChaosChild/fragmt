// OKF init/validate e2e (#21, D1/D4): fresh `init --okf`, the existing-repo
// flip (findings printed, adopted files untouched on disk, indexes + refs
// committed), the unchanged plain re-init refusal, the nested
// `--folder --new --okf` bundle, and `fragmt validate`'s exit contract with
// `--fix` reaching a conformant end state. Real git in tmp repos
// (nested-init/files patterns); stdout is the injected sink, stdin the ask
// seam.
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
import { runInit, runValidate } from "../src/cli/index.js";
import {
	configPath,
	createDoc,
	loadConfig,
	validateOkf,
	writeConfig,
} from "../src/core/index.js";

const dirs: string[] = [];

afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function run(root: string, args: string[]): string {
	return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

/** Fresh tmp repo with an identity; autocrlf off keeps bytes stable. */
function repo(): string {
	const root = mkdtempSync(join(tmpdir(), "fragmt-okfinit-"));
	run(root, ["init", "-q", "-b", "main"]);
	run(root, ["config", "user.name", "Init Test"]);
	run(root, ["config", "user.email", "init@example.com"]);
	run(root, ["config", "core.autocrlf", "false"]);
	dirs.push(root);
	return root;
}

function put(root: string, rel: string, text: string): void {
	mkdirSync(dirname(join(root, rel)), { recursive: true });
	writeFileSync(join(root, rel), text);
}

const sink = () => {
	const lines: string[] = [];
	return { lines, write: (s: string) => lines.push(s) };
};

test("fresh init --okf: OKF config, findings printed, docs untouched, index committed", async () => {
	const root = repo();
	put(root, "docs/notes.md", "# Notes\n");
	put(root, "docs/b.md", "Plain B\n");
	put(root, "docs/typed.md", "---\ntype: Metric\n---\n\n# T\n");
	run(root, ["add", "-A"]);
	run(root, ["commit", "-q", "-m", "seed"]);
	const out = sink();

	const code = await runInit("docs", root, out.write, { okf: true });

	expect(code).toBe(0);
	expect(loadConfig(root)).toEqual({ docsRoot: "docs", okf: true });
	const text = out.lines.join("");
	expect(text).toContain("2 OKF finding(s)");
	expect(text).toContain("notes.md: frontmatter: missing frontmatter block");
	expect(text).toContain("fix with: fragmt validate --fix");
	// Adopt, don't rewrite: no conformance repair happened at init time.
	expect(readFileSync(join(root, "docs", "notes.md"), "utf8")).toBe(
		"# Notes\n",
	);
	expect(readFileSync(join(root, "docs", "b.md"), "utf8")).toBe("Plain B\n");
	// The per-directory index set was generated and committed.
	expect(readFileSync(join(root, "docs", "index.md"), "utf8")).toContain(
		"# Metric\n\n* [typed](/typed.md)",
	);
	expect(run(root, ["ls-files"])).toContain("docs/index.md");
	expect(run(root, ["log", "-1", "--format=%s"])).toBe(
		"OKF: populate references and indexes",
	);
});

test("existing-repo flip: flag flipped with config preserved, findings printed, docs untouched", async () => {
	const root = repo();
	put(root, "docs/only.md", "# Only\n");
	expect(await runInit("docs", root, sink().write)).toBe(0);
	run(root, ["add", "-A"]);
	run(root, ["commit", "-q", "-m", "docs"]);
	writeFileSync(
		configPath(root),
		JSON.stringify({ docsRoot: "docs", authors: { "a@example.com": "alice" } }),
	);
	const out = sink();

	const code = await runInit("docs", root, out.write, { okf: true });

	expect(code).toBe(0);
	expect(loadConfig(root)).toEqual({
		docsRoot: "docs",
		authors: { "a@example.com": "alice" },
		okf: true,
	});
	const text = out.lines.join("");
	expect(text).toContain("OKF mode enabled");
	expect(text).toContain("only.md: frontmatter: missing frontmatter block");
	expect(readFileSync(join(root, "docs", "only.md"), "utf8")).toBe("# Only\n");
	expect(run(root, ["ls-files"])).toContain("docs/index.md");
});

test("plain re-init on an existing config still refuses (no --okf)", async () => {
	const root = repo();
	put(root, "docs/only.md", "# Only\n");
	await runInit("docs", root, sink().write);
	run(root, ["add", "-A"]);
	run(root, ["commit", "-q", "-m", "docs"]);
	const out = sink();

	expect(await runInit("docs", root, out.write)).toBe(0);

	expect(out.lines.join("")).toContain("already initialized");
	expect(loadConfig(root).okf).toBeUndefined();
	expect(run(root, ["ls-files"])).not.toContain("docs/index.md");
});

test("nested --folder --new --okf: OKF bundle in its own repo, outer redirect intact", async () => {
	const outer = repo();
	put(outer, "docs/guide.md", "# Guide\n");
	const out = sink();

	const code = await runInit(undefined, outer, out.write, {
		folder: "docs",
		new: true,
		okf: true,
		ask: async () => "",
	});

	expect(code).toBe(0);
	const nested = join(outer, "docs");
	expect(loadConfig(nested)).toEqual({ docsRoot: ".", okf: true });
	expect(readFileSync(join(nested, "index.md"), "utf8")).toContain(
		"* [guide](/guide.md)",
	);
	expect(readFileSync(join(outer, "AGENTS.md"), "utf8")).toContain(
		"docs live in the nested repo at docs/",
	);
	// The nested repo's own history: adoption commit, then the OKF commit.
	expect(run(nested, ["log", "--format=%s"])).toContain(
		"Adopt docs into nested fragmt repo",
	);
	expect(run(nested, ["log", "-1", "--format=%s"])).toBe(
		"OKF: populate references and indexes",
	);
});

test("validate --fix reaches a conformant end state in one commit", async () => {
	const root = repo();
	writeConfig(root, "docs", true);
	put(root, "docs/notes.md", "# N\n\nSee [a](/a.md).\n");
	put(root, "docs/a.md", "---\ntype: Metric\n---\n\n# A\n");
	run(root, ["add", "-A"]);
	run(root, ["commit", "-q", "-m", "seed"]);
	const out = sink();

	expect(await runValidate(false, root, out.write)).toBe(1);
	expect(out.lines.join("")).toContain(
		"notes.md: frontmatter: missing frontmatter block",
	);

	const fixed = sink();
	expect(await runValidate(true, root, fixed.write)).toBe(0);
	expect(fixed.lines.join("")).toContain("fixed");
	const check = await validateOkf(root, "docs");
	expect(check.conformant).toBe(true);
	expect(run(root, ["log", "-1", "--format=%s"])).toBe(
		"OKF: apply conformance fixes",
	);
	expect(readFileSync(join(root, "docs", "notes.md"), "utf8")).toBe(
		'---\ntype: concept\nreferences: ["a.md"]\n---\n# N\n\nSee [a](/a.md).\n',
	);
	expect(readFileSync(join(root, "docs", "a.md"), "utf8")).toBe(
		'---\ntype: Metric\nreferenced-by: ["notes.md"]\n---\n\n# A\n',
	);
});

test("OKF create on a fenceless, link-free body still gets the type block", async () => {
	const root = repo();
	writeConfig(root, "docs", true);
	put(root, "docs/a.md", "---\ntype: Metric\n---\n\n# A\n");
	run(root, ["add", "-A"]);
	run(root, ["commit", "-q", "-m", "seed"]);

	await createDoc(root, "docs", "empty.md");
	await createDoc(root, "docs", "hello.md", "# hello\n");

	// saveWithRefs declines (fenceless + nothing to carry); the create
	// fallback owes the block either way – the UI's New Doc button sends "".
	expect(readFileSync(join(root, "docs", "empty.md"), "utf8")).toBe(
		"---\ntype: concept\n---\n",
	);
	expect(readFileSync(join(root, "docs", "hello.md"), "utf8")).toBe(
		"---\ntype: concept\n---\n# hello\n",
	);
	const check = await validateOkf(root, "docs");
	expect(check.conformant).toBe(true);
});

test("validate exit codes: 2 with the hint off-mode, 0 when conformant", async () => {
	const plain = repo();
	writeConfig(plain, "docs", false);
	const hint = sink();
	expect(await runValidate(false, plain, hint.write)).toBe(2);
	expect(hint.lines.join("")).toContain("fragmt init --okf");

	const uninit = repo();
	expect(await runValidate(false, uninit, sink().write)).toBe(2);

	const okf = repo();
	writeConfig(okf, "docs", true);
	put(okf, "docs/a.md", "---\ntype: Metric\n---\n\n# A\n");
	run(okf, ["add", "-A"]);
	run(okf, ["commit", "-q", "-m", "seed"]);
	const good = sink();
	expect(await runValidate(false, okf, good.write)).toBe(0);
	expect(good.lines.join("")).toContain("conformant\n");
});
