// @vitest-environment happy-dom
//
// M4-2 @ references: item filtering, the Suggestion command's link mark, and
// the pure link-resolution helper behind read/edit-mode anchor clicks. The
// editor is built headless from the app's own extension factory, like
// editing-controls.test.ts.
import { Editor } from "@tiptap/core";
import { describe, expect, test } from "vitest";
import {
	type AtDoc,
	AtReferences,
	applyAtReference,
	filterAtDocs,
} from "../ui/src/editor/at.js";
import { editorExtensions } from "../ui/src/editor/extensions.js";
import { resolveLinkTarget } from "../ui/src/editor/links.js";

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

	test("joins hrefs against the current doc's directory", () => {
		expect(resolveLinkTarget("./b.md", "dir/a.md", known)).toEqual({
			kind: "doc",
			path: "dir/b.md",
		});
		expect(resolveLinkTarget("b.md", "dir/a.md", known)).toEqual({
			kind: "doc",
			path: "dir/b.md",
		});
	});

	test("../ traverses up one directory", () => {
		expect(resolveLinkTarget("../c.md", "dir/sub/a.md", known)).toEqual({
			kind: "doc",
			path: "dir/c.md",
		});
	});

	test("../ escaping the doc set stays default", () => {
		expect(resolveLinkTarget("../../outside.md", "dir/a.md", known)).toEqual({
			kind: "default",
		});
	});

	test("URL-encoded components decode before matching", () => {
		expect(resolveLinkTarget("my%20doc.md", "a.md", known)).toEqual({
			kind: "doc",
			path: "my doc.md",
		});
	});

	test("http(s) and other absolute schemes are external", () => {
		expect(
			resolveLinkTarget("https://example.com/x", "docs/plan.md", known),
		).toEqual({ kind: "external" });
		expect(
			resolveLinkTarget("http://example.com", "docs/plan.md", known),
		).toEqual({ kind: "external" });
		expect(
			resolveLinkTarget("mailto:a@b.example", "docs/plan.md", known),
		).toEqual({ kind: "external" });
	});

	test("a docsRoot-relative exact path matches verbatim (the @ menu's form)", () => {
		expect(
			resolveLinkTarget("docs/x.md", "docs/plan.md", new Set(["docs/x.md"])),
		).toEqual({ kind: "doc", path: "docs/x.md" });
	});
});
