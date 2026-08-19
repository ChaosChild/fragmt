// @vitest-environment happy-dom
//
// The permanent round-trip gate (M2 spec). It builds a headless editor from the
// APP's extension array — ui/src/editor/extensions.ts, never a re-declared
// one — so any change to the editor config is judged by these assertions.
// Corpus copied from spikes/roundtrip/corpus.md (the spike stays runnable).
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
import { join } from "node:path";
import { Editor } from "@tiptap/core";
import { afterEach, beforeEach, expect, test } from "vitest";
import {
	DocPathError,
	docHash,
	readDoc,
	StaleDocError,
	writeDoc,
} from "../src/core/index.js";
import { editorExtensions } from "../ui/src/editor/extensions.js";

const corpusRaw = readFileSync(
	join(__dirname, "fixtures", "corpus.md"),
	"utf8",
);
// Frontmatter is stripped before parse and reattached after — the editor only
// ever sees the body (ARCHITECTURE §7 caveat 1).
const fmMatch = corpusRaw.match(/^---\n[\s\S]*?\n---\n/);
const corpusBody = fmMatch ? corpusRaw.slice(fmMatch[0].length) : corpusRaw;

let editor: Editor;

beforeEach(() => {
	editor = new Editor({ extensions: editorExtensions(), content: "" });
	editor.commands.setContent(corpusBody);
});

afterEach(() => {
	editor.destroy();
});

/** Serialize the corpus through the app's editor config. */
function roundTrip(): string {
	return editor.storage.markdown.getMarkdown() as string;
}

test("headings h1–h3 survive", () => {
	const out = roundTrip();
	expect(out).toContain("# Heading One");
	expect(out).toContain("## Heading Two");
	expect(out).toContain("### Heading Three");
});

test("inline marks survive: bold, italic, strike, inline code, link", () => {
	const out = roundTrip();
	expect(out).toContain("**bold**");
	expect(out).toContain("*italic*");
	expect(out).toContain("~~strike~~");
	expect(out).toContain("`inline code`");
	expect(out).toContain("[link to example](https://example.com)");
	// The @ menu's output form (M4-2): a docsRoot-relative path as the href.
	expect(out).toContain("[a local doc](docs/related.md)");
});

test("nested bullet and numbered lists survive (3 levels)", () => {
	const out = roundTrip();
	expect(out).toContain("- Bullet level one");
	expect(out).toContain("  - Bullet level two");
	expect(out).toContain("    - Bullet level three");
	expect(out).toContain("1. Numbered one");
	expect(out).toContain("   1. Numbered two-one");
	expect(out).toContain("      1. Numbered two-two-one");
});

test("task lists survive, state included", () => {
	const out = roundTrip();
	expect(out).toContain("- [ ] Unchecked task");
	expect(out).toContain("- [x] Checked task");
});

test("fenced code blocks keep their language tags", () => {
	const out = roundTrip();
	expect(out).toContain("```js");
	expect(out).toContain("```python");
	// biome-ignore lint/suspicious/noTemplateCurlyInString: literal JS template-string text from the corpus code fence — the curly is content, not interpolation
	expect(out).toContain("return `hello ${name}`;");
});

test("table content and structure survive; alignment markers are lost (documented)", () => {
	const out = roundTrip();
	expect(out).toContain("| Left");
	expect(out).toContain("a1");
	expect(out).toContain("c2");
	// Accepted loss (spike + PLAN "Cut from v1"): GFM column alignment —
	// `:---`/`:----:`/`----:` collapse to plain `---`. Assert the separator
	// line carries no colons so the documented behavior is pinned.
	const sep = out.split("\n").find((l) => /^\|[\s|-]+\|$/.test(l));
	expect(sep).toBeDefined();
	expect(sep).not.toContain(":");
});

test("blockquotes, horizontal rules, and images survive", () => {
	const out = roundTrip();
	expect(out).toContain("> A quoted line.");
	expect(out).toContain("---");
	expect(out).toContain("![alt text](https://example.com/image.png)");
});

test("every data-c comment span survives with attributes intact", () => {
	const out = roundTrip();
	expect(out).toContain('data-c="abc123"');
	expect(out).toContain('data-c="bold01"');
	expect(out).toContain('data-c="list01"');
	expect(out).toContain('data-c="task01"');
	expect(out).toContain(">flagged phrase</span>");
	expect(out).toContain(">inside bold</span>");
	expect(out).toContain(">span in a list item</span>");
	expect(out).toContain(">flagged</span>");
});

// ── writeDoc: frontmatter and save semantics ──────────────────────────────

/** Throwaway git repo with a configured identity (tests use real dirs). */
function gitRepo(): string {
	const root = mkdtempSync(join(tmpdir(), "fragmt-rt-"));
	const git = (args: string[]) => execFileSync("git", args, { cwd: root });
	git(["init", "-q", "-b", "main"]);
	git(["config", "user.name", "Round Trip"]);
	git(["config", "user.email", "roundtrip@example.com"]);
	return root;
}

function commitAll(root: string, message: string) {
	execFileSync("git", ["add", "-A"], { cwd: root });
	execFileSync("git", ["commit", "-q", "-m", message], { cwd: root });
}

const repos: string[] = [];

afterEach(() => {
	for (const r of repos.splice(0)) rmSync(r, { recursive: true, force: true });
});

test("saving an unchanged body reattaches frontmatter byte-for-byte (zero diff)", async () => {
	const root = gitRepo();
	repos.push(root);
	writeFileSync(join(root, "doc.md"), corpusRaw);
	commitAll(root, "seed");

	const doc = readDoc(root, ".", "doc.md");
	await writeDoc(root, ".", "doc.md", doc.markdown, docHash(doc.markdown));

	expect(readFileSync(join(root, "doc.md"), "utf8")).toBe(corpusRaw);
});

test("writeDoc rejects a stale baseHash and leaves the file untouched", async () => {
	const root = gitRepo();
	repos.push(root);
	writeFileSync(join(root, "doc.md"), "# body\n");
	commitAll(root, "seed");

	await expect(
		writeDoc(root, ".", "doc.md", "# edited\n", docHash("something else")),
	).rejects.toThrow(StaleDocError);
	expect(readFileSync(join(root, "doc.md"), "utf8")).toBe("# body\n");
});

test("writeDoc rejects traversal like readDoc does", async () => {
	const root = gitRepo();
	repos.push(root);
	mkdirSync(join(root, "docs"));
	writeFileSync(join(root, "docs", "ok.md"), "# ok\n");
	writeFileSync(join(root, "secret.md"), "# secret\n");
	commitAll(root, "seed");

	await expect(
		writeDoc(root, "docs", "../secret.md", "# hacked\n", docHash("# secret\n")),
	).rejects.toThrow(DocPathError);
	expect(readFileSync(join(root, "secret.md"), "utf8")).toBe("# secret\n");
});

test("a file without frontmatter stays without one after saving", async () => {
	const root = gitRepo();
	repos.push(root);
	writeFileSync(join(root, "plain.md"), "# plain\n");
	commitAll(root, "seed");

	await writeDoc(
		root,
		".",
		"plain.md",
		"# plain, edited\n",
		docHash("# plain\n"),
	);

	const raw = readFileSync(join(root, "plain.md"), "utf8");
	expect(raw).toBe("# plain, edited\n");
	expect(raw.startsWith("---")).toBe(false);
});

test("writeDoc commits as the local identity with the spec'd message", async () => {
	const root = gitRepo();
	repos.push(root);
	writeFileSync(join(root, "doc.md"), "# body\n");
	commitAll(root, "seed");
	const before = execFileSync("git", ["rev-parse", "HEAD"], {
		cwd: root,
		encoding: "utf8",
	}).trim();

	const { sha } = await writeDoc(
		root,
		".",
		"doc.md",
		"# body, edited\n",
		docHash("# body\n"),
	);

	expect(sha).not.toBe(before);
	const log = execFileSync("git", ["log", "-1", "--format=%an|%ae|%s"], {
		cwd: root,
		encoding: "utf8",
	}).trim();
	expect(log).toBe("Round Trip|roundtrip@example.com|Update doc.md");
	const diff = execFileSync("git", ["diff", "--name-only", `${before}..HEAD`], {
		cwd: root,
		encoding: "utf8",
	}).trim();
	expect(diff).toBe("doc.md");
});

test("an identical-content save is a no-op: HEAD sha returned, no new commit", async () => {
	const root = gitRepo();
	repos.push(root);
	writeFileSync(join(root, "doc.md"), "# body\n");
	commitAll(root, "seed");
	const before = execFileSync("git", ["rev-parse", "HEAD"], {
		cwd: root,
		encoding: "utf8",
	}).trim();

	const { sha } = await writeDoc(
		root,
		".",
		"doc.md",
		"# body\n",
		docHash("# body\n"),
	);

	expect(sha).toBe(before);
	expect(existsSync(join(root, ".git"))).toBe(true);
	const count = execFileSync("git", ["rev-list", "--count", "HEAD"], {
		cwd: root,
		encoding: "utf8",
	}).trim();
	expect(count).toBe("1");
});
