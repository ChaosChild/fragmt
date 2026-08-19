// @vitest-environment happy-dom
//
// M4-2 @ references: item filtering, the Suggestion command's link mark, and
// the pure link-resolution helper behind read/edit-mode anchor clicks. The
// editor is built headless from the app's own extension factory, like
// editing-controls.test.ts.
import { Editor } from "@tiptap/core";
import { describe, expect, test } from "vitest";
import { displayTitle } from "../ui/src/display.js";
import {
	type AtDoc,
	AtReferences,
	applyAtReference,
	filterAtDocs,
} from "../ui/src/editor/at.js";
import { editorExtensions } from "../ui/src/editor/extensions.js";
import { resolveLinkTarget, slugifyHeading } from "../ui/src/editor/links.js";

const docs: AtDoc[] = [
	{ title: "Plan", path: "docs/plan.md" },
	{ title: "Architecture", path: "docs/dev/architecture.md" },
	{ title: "Glossary", path: "glossary.md" },
];

function atEditor(): Editor {
	// Callbacks omitted — the extension exists, the UI just never hears from it.
	return new Editor({
		extensions: editorExtensions(undefined, { docs: () => docs }),
		content: "",
	});
}

describe("@ item filtering", () => {
	test("substring over title and path, case-insensitive", () => {
		expect(filterAtDocs(docs, "plan").map((d) => d.path)).toEqual([
			"docs/plan.md",
		]);
		expect(filterAtDocs(docs, "ARCH").map((d) => d.path)).toEqual([
			"docs/dev/architecture.md",
		]);
		expect(filterAtDocs(docs, "glossary.md").map((d) => d.path)).toEqual([
			"glossary.md",
		]);
		expect(filterAtDocs(docs, "")).toHaveLength(3);
		expect(filterAtDocs(docs, "zzz")).toEqual([]);
	});
});

// The display-name model (M4-3 b4): the @ menu labels, sidebar cards, and
// breadcrumb all resolve the title this way — App threads meta's titles in
// with the file name as the fallback.
describe("displayTitle (the @ menu label rule)", () => {
	test("frontmatter title preferred; file name sans .md the fallback", () => {
		expect(displayTitle("The Plan", "plan.md")).toBe("The Plan");
		expect(displayTitle(undefined, "plan.md")).toBe("plan");
		expect(displayTitle(null, "Plan.MD")).toBe("Plan");
	});

	test("blank or non-string titles fall back to the name", () => {
		expect(displayTitle("   ", "plan.md")).toBe("plan");
		expect(displayTitle("", "plan.md")).toBe("plan");
		expect(displayTitle(42, "plan.md")).toBe("plan");
	});
});

describe("@ reference insertion", () => {
	test("applying an item serializes to [Title](path), query deleted", () => {
		const editor = atEditor();
		editor.commands.setContent("see @plan here");
		// The Suggestion range for "@plan" — the command contract slash tests use.
		applyAtReference(editor, { from: 5, to: 10 }, docs[0]);
		const out: string = editor.storage.markdown.getMarkdown();
		expect(out).toContain("[Plan](docs/plan.md)");
		expect(out).not.toContain("@plan");
		// In place, mid-sentence — not appended at the doc's end.
		expect(out).toContain("(docs/plan.md) here");
		editor.destroy();
	});

	test("without the at option the extension is absent (corpus gate stays clean)", () => {
		const bare = new Editor({ extensions: editorExtensions(), content: "" });
		expect(
			bare.extensionManager.extensions.find(
				(e) => e.name === AtReferences.name,
			),
		).toBeUndefined();
		bare.destroy();

		const editor = atEditor();
		expect(
			editor.extensionManager.extensions.find(
				(e) => e.name === AtReferences.name,
			),
		).toBeDefined();
		editor.destroy();
	});
});

describe("resolveLinkTarget", () => {
	const known = new Set([
		"docs/plan.md",
		"docs/x.md",
		"dir/b.md",
		"dir/c.md",
		"my doc.md",
	]);
	const folders = new Set(["dir", "dir/sub"]);

	test("joins hrefs against the current doc's directory", () => {
		expect(resolveLinkTarget("./b.md", "dir/a.md", known, folders)).toEqual({
			kind: "doc",
			path: "dir/b.md",
		});
		expect(resolveLinkTarget("b.md", "dir/a.md", known, folders)).toEqual({
			kind: "doc",
			path: "dir/b.md",
		});
	});

	test("../ traverses up one directory", () => {
		expect(
			resolveLinkTarget("../c.md", "dir/sub/a.md", known, folders),
		).toEqual({
			kind: "doc",
			path: "dir/c.md",
		});
	});

	test("../ escaping the doc set stays default", () => {
		expect(
			resolveLinkTarget("../../outside.md", "dir/a.md", known, folders),
		).toEqual({ kind: "default" });
	});

	test("URL-encoded components decode before matching", () => {
		expect(resolveLinkTarget("my%20doc.md", "a.md", known, folders)).toEqual({
			kind: "doc",
			path: "my doc.md",
		});
	});

	test("http(s) and other absolute schemes are external", () => {
		expect(
			resolveLinkTarget(
				"https://example.com/x",
				"docs/plan.md",
				known,
				folders,
			),
		).toEqual({ kind: "external" });
		expect(
			resolveLinkTarget("http://example.com", "docs/plan.md", known, folders),
		).toEqual({ kind: "external" });
		expect(
			resolveLinkTarget("mailto:a@b.example", "docs/plan.md", known, folders),
		).toEqual({ kind: "external" });
	});

	test("a docsRoot-relative exact path matches verbatim (the @ menu's form)", () => {
		expect(
			resolveLinkTarget(
				"docs/x.md",
				"docs/plan.md",
				new Set(["docs/x.md"]),
				folders,
			),
		).toEqual({ kind: "doc", path: "docs/x.md" });
	});
});

// M4-3 b6: the five-way dispatch — the table in links.ts is normative.
describe("resolveLinkTarget dispatch (M4-3 b6)", () => {
	const known = new Set(["dir/b.md", "dir/c.md", "docs/x.md"]);
	const folders = new Set(["dir", "dir/sub", "docs"]);

	test("bare #fragment → anchor (decoded); empty href and bare # stay default", () => {
		expect(resolveLinkTarget("#section", "a.md", known, folders)).toEqual({
			kind: "anchor",
			id: "section",
		});
		expect(resolveLinkTarget("#my%20heading", "a.md", known, folders)).toEqual({
			kind: "anchor",
			id: "my heading",
		});
		expect(resolveLinkTarget("#", "a.md", known, folders)).toEqual({
			kind: "default",
		});
		expect(resolveLinkTarget("", "a.md", known, folders)).toEqual({
			kind: "default",
		});
	});

	test("doc href with a fragment matches the stripped path and carries the anchor", () => {
		expect(resolveLinkTarget("b.md#intro", "dir/a.md", known, folders)).toEqual(
			{
				kind: "doc",
				path: "dir/b.md",
				anchor: "intro",
			},
		);
		// The verbatim candidate (docsRoot-relative form) carries it too.
		expect(
			resolveLinkTarget("docs/x.md#setup", "other.md", known, folders),
		).toEqual({ kind: "doc", path: "docs/x.md", anchor: "setup" });
	});

	test("folder links match dir-joined and verbatim, with and without trailing slash", () => {
		expect(resolveLinkTarget("sub", "dir/a.md", known, folders)).toEqual({
			kind: "folder",
			path: "dir/sub",
		});
		expect(resolveLinkTarget("sub/", "dir/a.md", known, folders)).toEqual({
			kind: "folder",
			path: "dir/sub",
		});
		expect(resolveLinkTarget("dir/sub/", "x.md", known, folders)).toEqual({
			kind: "folder",
			path: "dir/sub",
		});
		expect(resolveLinkTarget("docs", "a.md", known, folders)).toEqual({
			kind: "folder",
			path: "docs",
		});
	});

	test("non-md relative hrefs → raw with the markdown-relative path", () => {
		expect(resolveLinkTarget("image.png", "dir/a.md", known, folders)).toEqual({
			kind: "raw",
			path: "dir/image.png",
		});
		expect(
			resolveLinkTarget("assets/diagram.webp", "docs/x.md", known, folders),
		).toEqual({ kind: "raw", path: "docs/assets/diagram.webp" });
		// Pops within docsRoot — not an escape, still raw.
		expect(
			resolveLinkTarget("../img.png", "docs/x.md", known, folders),
		).toEqual({ kind: "raw", path: "img.png" });
	});

	test("dead .md links (typo, uppercase .MD, unmatched fragment) → dead with the href", () => {
		expect(resolveLinkTarget("typo.md", "a.md", known, folders)).toEqual({
			kind: "dead",
			href: "typo.md",
		});
		// Case-insensitive .md detection — dead, never raw.
		expect(resolveLinkTarget("typo.MD", "a.md", known, folders)).toEqual({
			kind: "dead",
			href: "typo.MD",
		});
		expect(
			resolveLinkTarget("gone.md#frag", "dir/a.md", known, folders),
		).toEqual({ kind: "dead", href: "gone.md#frag" });
	});

	test("an href normalizing to the docsRoot stays default; './' in a folder is that folder", () => {
		// A root doc's "." / "./" is the docsRoot itself — no destination.
		expect(resolveLinkTarget(".", "a.md", known, folders)).toEqual({
			kind: "default",
		});
		expect(resolveLinkTarget("./", "a.md", known, folders)).toEqual({
			kind: "default",
		});
		// Inside dir/, "./" resolves to dir — a folder link like any other.
		expect(resolveLinkTarget("./", "dir/a.md", known, folders)).toEqual({
			kind: "folder",
			path: "dir",
		});
	});
});

describe("slugifyHeading", () => {
	test("GitHub-gfm-compatible for the ASCII common case", () => {
		expect(slugifyHeading("Hello, World!", new Set())).toBe("hello-world");
	});

	test("keeps Unicode letters, strips other punctuation", () => {
		expect(slugifyHeading("Über Straße", new Set())).toBe("über-straße");
		expect(slugifyHeading("What?! Really...", new Set())).toBe("what-really");
	});

	test("collapses separator runs and trims edges", () => {
		expect(slugifyHeading("  a --  b ", new Set())).toBe("a-b");
		expect(slugifyHeading("--leading--", new Set())).toBe("leading");
	});

	test("empty result → section, itself deduped", () => {
		const seen = new Set<string>();
		expect(slugifyHeading("!!!", seen)).toBe("section");
		expect(slugifyHeading("???", seen)).toBe("section-1");
	});

	test("duplicates get -1, -2 suffixes", () => {
		const seen = new Set<string>();
		expect(slugifyHeading("Notes", seen)).toBe("notes");
		expect(slugifyHeading("Notes", seen)).toBe("notes-1");
		expect(slugifyHeading("notes", seen)).toBe("notes-2");
	});
});
