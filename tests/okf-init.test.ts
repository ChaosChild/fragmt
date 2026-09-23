// OKF init/validate e2e (#21, D1/D4): fresh `init --okf`, the existing-repo
// flip (findings printed, adopted files untouched on disk, indexes + refs
// committed), the unchanged plain re-init refusal, the nested
// `--folder --new --okf` bundle, and `fragmt validate`'s exit contract with
// `--fix` reaching a conformant end state. The managed AGENTS block rides
// the same paths: OKF repos get the taught variant (fresh, flip, nested),
// plain repos never do, fences stay v1. Real git in tmp repos
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
import { runAgent } from "../src/cli/agent.js";
import { runInit, runValidate } from "../src/cli/index.js";
import {
	AGENTS_BEGIN,
	AGENTS_END,
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

test("fresh init --okf on an empty repo: AGENTS.md born conformant, zero findings", async () => {
	const root = repo();
	const out = sink();

	expect(await runInit(".", root, out.write, { okf: true })).toBe(0);

	// Born with the frontmatter – fragmt's own file is never its own finding.
	const agents = readFileSync(join(root, "AGENTS.md"), "utf8");
	expect(agents.startsWith('---\ntype: concept\nstatus: "draft"\n---\n')).toBe(
		true,
	);
	const text = out.lines.join("");
	expect(text).toContain("OKF conformant");
	expect(text).not.toContain("AGENTS.md:");

	// `validate` agrees immediately – no `--fix` chore for the operator.
	const v = sink();
	expect(await runValidate(false, root, v.write)).toBe(0);
	expect(v.lines.join("")).toContain("conformant");
});

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

test("#48: plain init commits only the two fragmt files; unrelated content stays untracked", async () => {
	const root = repo();
	put(root, "docs/only.md", "# Only\n");
	run(root, ["add", "-A"]);
	run(root, ["commit", "-q", "-m", "seed"]);
	put(root, "scratch.txt", "mine\n"); // unrelated – never fragmt's to commit
	const out = sink();

	expect(await runInit("docs", root, out.write)).toBe(0);

	expect(run(root, ["log", "-1", "--format=%s"])).toBe(
		"Adopt docs into fragmt repo",
	);
	expect(
		run(root, ["show", "--name-only", "--format=", "HEAD"])
			.split("\n")
			.filter(Boolean)
			.sort(),
	).toEqual([".fragmt.json", "AGENTS.md"]);
	expect(run(root, ["status", "--porcelain"])).toBe("?? scratch.txt");
});

test("#48: plain init on an unborn repo: the config commit is the initial commit, tree clean", async () => {
	const root = repo(); // git init, zero commits
	const out = sink();

	expect(await runInit(".", root, out.write)).toBe(0);

	expect(run(root, ["rev-list", "--count", "HEAD"])).toBe("1");
	expect(run(root, ["ls-files"])).toContain(".fragmt.json");
	expect(run(root, ["ls-files"])).toContain("AGENTS.md");
	expect(run(root, ["status", "--porcelain"])).toBe("");
});

test("#48: init --okf tracks the config exactly once – the adoption commit rides on top", async () => {
	const root = repo();
	put(root, "docs/a.md", "---\ntype: Metric\n---\n\n# A\n");
	run(root, ["add", "-A"]);
	run(root, ["commit", "-q", "-m", "seed"]);
	const out = sink();

	expect(await runInit("docs", root, out.write, { okf: true })).toBe(0);

	// One commit ever touches the config; the OKF population is a second one.
	expect(run(root, ["log", "--format=%s", "--", ".fragmt.json"])).toBe(
		"Adopt docs into fragmt repo",
	);
	expect(run(root, ["log", "-1", "--format=%s"])).toBe(
		"OKF: populate references and indexes",
	);
	expect(run(root, ["status", "--porcelain"])).toBe("");
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

test("fresh init --okf teaches the OKF rules in AGENTS.md; plain init does not", async () => {
	const okf = repo();
	put(okf, "docs/a.md", "---\ntype: Metric\n---\n\n# A\n");
	run(okf, ["add", "-A"]);
	run(okf, ["commit", "-q", "-m", "seed"]);
	await runInit("docs", okf, sink().write, { okf: true });
	const taught = readFileSync(join(okf, "AGENTS.md"), "utf8");
	expect(taught).toContain("## OKF rules – this repo is an OKF v0.2 bundle");
	expect(taught).toContain("fragmt validate");
	// The taught variant rides the same v1 fences as every managed block.
	expect(taught).toContain(AGENTS_BEGIN);
	expect(taught).toContain(AGENTS_END);

	const plain = repo();
	put(plain, "docs/a.md", "---\ntype: Metric\n---\n\n# A\n");
	run(plain, ["add", "-A"]);
	run(plain, ["commit", "-q", "-m", "seed"]);
	await runInit("docs", plain, sink().write);
	const silent = readFileSync(join(plain, "AGENTS.md"), "utf8");
	expect(silent).toContain(AGENTS_BEGIN);
	expect(silent).not.toContain("OKF rules");
});

test("the existing-repo flip refreshes a plain block into the OKF-taught one", async () => {
	const root = repo();
	put(root, "docs/only.md", "---\ntype: Metric\n---\n\n# Only\n");
	await runInit("docs", root, sink().write); // plain first
	const file = join(root, "AGENTS.md");
	expect(readFileSync(file, "utf8")).not.toContain("OKF rules");
	run(root, ["add", "-A"]);
	run(root, ["commit", "-q", "-m", "docs"]);

	expect(await runInit("docs", root, sink().write, { okf: true })).toBe(0);

	// spliceBlock replaced the plain body between the markers – one block,
	// same v1 fences, the OKF section gained.
	const taught = readFileSync(file, "utf8");
	expect(taught).toContain("## OKF rules");
	expect(taught.indexOf(AGENTS_BEGIN)).toBe(taught.lastIndexOf(AGENTS_BEGIN));
	expect(taught).toContain(AGENTS_END);
});

test("nested --folder --new --okf: nested AGENTS.md teaches OKF, outer redirects", async () => {
	const outer = repo();
	put(outer, "docs/guide.md", "# Guide\n");
	await runInit(undefined, outer, sink().write, {
		folder: "docs",
		new: true,
		okf: true,
		ask: async () => "",
	});

	const inner = readFileSync(join(outer, "docs", "AGENTS.md"), "utf8");
	expect(inner).toContain("## OKF rules");
	expect(inner).toContain(AGENTS_BEGIN);
	// The nested bundle's AGENTS.md is born conformant (created fresh by
	// initNestedRepo after the nested config write).
	expect(inner.startsWith('---\ntype: concept\nstatus: "draft"\n---\n')).toBe(
		true,
	);
	const redirect = readFileSync(join(outer, "AGENTS.md"), "utf8");
	expect(redirect).toContain("docs live in the nested repo at docs/");
	expect(redirect).not.toContain("OKF rules");
	// The outer repo is not the OKF bundle – its redirect is born bare.
	expect(redirect.startsWith("---")).toBe(false);
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
		'---\ntype: concept\nstatus: "draft"\nreferences: ["a.md"]\n---\n# N\n\nSee [a](/a.md).\n',
	);
	expect(readFileSync(join(root, "docs", "a.md"), "utf8")).toBe(
		'---\ntype: Metric\nstatus: "draft"\nreferenced-by: ["notes.md"]\n---\n\n# A\n',
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

	// The seed is pre-fenced with type + status (A3), so saveWithRefs rides
	// the refs on top and can never drop the block it owes – the UI's New
	// Doc button sends "".
	expect(readFileSync(join(root, "docs", "empty.md"), "utf8")).toBe(
		'---\ntype: concept\nstatus: "draft"\n---\n',
	);
	expect(readFileSync(join(root, "docs", "hello.md"), "utf8")).toBe(
		'---\ntype: concept\nstatus: "draft"\n---\n# hello\n',
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

test("#50: with docsRoot '.', the root index never catalogs AGENTS.md – init, save, and --fix all hold", async () => {
	const root = repo();
	put(root, "guide.md", "---\ntype: Metric\n---\n\n# G\n");
	put(root, "sub/deep.md", "---\ntype: Playbook\n---\n\n# D\n");
	run(root, ["add", "-A"]);
	run(root, ["commit", "-q", "-m", "seed"]);
	// The save body lives outside the repo – a .md inside would be a doc.
	const bodyDir = mkdtempSync(join(tmpdir(), "fragmt-body-"));
	dirs.push(bodyDir);
	writeFileSync(join(bodyDir, "body.md"), "# G v2\n");
	const noAgents = () => {
		const index = readFileSync(join(root, "index.md"), "utf8");
		expect(index).toContain("* [guide](/guide.md)");
		expect(index).toContain("# Subdirectories");
		expect(index).not.toContain("AGENTS");
	};

	// init writes the frontmatter-carrying AGENTS.md itself – the bundle
	// adopts it as a doc, the generated root index still leaves it out.
	expect(await runInit(".", root, sink().write, { okf: true })).toBe(0);
	noAgents();

	// A save that changes directory membership (a new doc) regenerates the
	// index on the draft branch – the new entry lands, AGENTS stays out.
	writeFileSync(join(bodyDir, "fresh.md"), "# F\n");
	expect(
		await runAgent(
			["save", "fresh.md", "--file", join(bodyDir, "fresh.md")],
			root,
			() => {},
		),
	).toBe(0);
	const saved = readFileSync(join(root, "index.md"), "utf8");
	expect(saved).toContain("* [fresh](/fresh.md)");
	expect(saved).not.toContain("AGENTS");

	// A hand-mangled index with the entry restored is rewritten without it.
	put(
		root,
		"index.md",
		'---\nokf_version: "0.2"\n---\n\n# Metric\n\n* [AGENTS](/AGENTS.md)\n* [guide](/guide.md)\n',
	);
	const fixed = sink();
	expect(await runValidate(true, root, fixed.write)).toBe(0);
	expect(fixed.lines.join("")).toContain("fixed");
	noAgents();

	const check = sink();
	expect(await runValidate(false, root, check.write)).toBe(0);
	expect(check.lines.join("")).toContain("conformant");
});
