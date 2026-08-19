// @vitest-environment happy-dom
//
// M2-2 editing controls: the slash items run real Tiptap commands against a
// headless editor built from the app's own extension factory, turn-into works
// on a bare cursor (the right-click promise), the bubble visibility predicate
// behaves, and formatting over a comment mark preserves it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { beforeEach, describe, expect, test } from "vitest";
import { shouldShowBubble } from "../ui/src/editor/bubble.js";
import { editorExtensions } from "../ui/src/editor/extensions.js";
import { filterSlashItems, slashItems } from "../ui/src/editor/slash.js";

let editor: Editor;

// getJSON()'s node types are too loose for direct property access here.
type JNode = {
	type?: string;
	attrs?: Record<string, unknown>;
	content?: JNode[];
	text?: string;
};
const blocks = (e: Editor): JNode[] => (e.getJSON().content ?? []) as JNode[];

function makeEditor(markdown = ""): Editor {
	const e = new Editor({ extensions: editorExtensions(), content: "" });
	if (markdown) e.commands.setContent(markdown);
	return e;
}

beforeEach(() => {
	editor = makeEditor();
});

describe("slash items", () => {
	test("table item inserts a 3×3 table with a header row", () => {
		editor.commands.setContent("before\n\nafter");
		editor.commands.setTextSelection(3);
		const table = slashItems.find((i) => i.id === "table");
		table?.run?.(editor.chain().focus());
		const tableNode = blocks(editor).find((n) => n.type === "table");
		expect(tableNode).toBeDefined();
		const rows = (tableNode?.content ?? []) as JNode[];
		expect(rows).toHaveLength(3);
		expect(rows[0]?.content?.[0]?.type).toBe("tableHeader");
		expect(rows[0]?.content?.[1]?.type).toBe("tableHeader");
	});

	test("heading, quote, and code-block items convert the block", () => {
		editor.commands.setContent("hello");
		editor.commands.setTextSelection(2);
		slashItems.find((i) => i.id === "h2")?.run?.(editor.chain().focus());
		expect(blocks(editor)[0]?.type).toBe("heading");
		expect(blocks(editor)[0]?.attrs?.level).toBe(2);

		editor.commands.setContent("hello");
		editor.commands.setTextSelection(2);
		slashItems.find((i) => i.id === "quote")?.run?.(editor.chain().focus());
		expect(blocks(editor)[0]?.type).toBe("blockquote");

		editor.commands.setContent("hello");
		editor.commands.setTextSelection(2);
		slashItems.find((i) => i.id === "code")?.run?.(editor.chain().focus());
		expect(blocks(editor)[0]?.type).toBe("codeBlock");
	});

	test("list items produce their list types", () => {
		for (const [id, type] of [
			["bullet", "bulletList"],
			["numbered", "orderedList"],
			["task", "taskList"],
		] as const) {
			editor.commands.setContent("hello");
			editor.commands.setTextSelection(2);
			slashItems.find((i) => i.id === id)?.run?.(editor.chain().focus());
			expect(blocks(editor)[0]?.type, id).toBe(type);
		}
	});

	test("divider item inserts a horizontal rule", () => {
		editor.commands.setContent("hello");
		editor.commands.setTextSelection(6);
		slashItems.find((i) => i.id === "divider")?.run?.(editor.chain().focus());
		expect(blocks(editor).map((n) => n.type)).toContain("horizontalRule");
	});

	test("image item is popover-routed, not a command", () => {
		const image = slashItems.find((i) => i.id === "image");
		expect(image?.popover).toBe(true);
		expect(image?.run).toBeUndefined();
	});

	test("filtering matches labels and keywords, prefix first", () => {
		expect(filterSlashItems(slashItems, "tab").map((i) => i.id)).toContain(
			"table",
		);
		expect(filterSlashItems(slashItems, "head").map((i) => i.id)).toEqual([
			"h1",
			"h2",
			"h3",
		]);
		expect(filterSlashItems(slashItems, "checkbox").map((i) => i.id)).toEqual([
			"task",
		]);
		expect(filterSlashItems(slashItems, "zzz")).toEqual([]);
	});
});

describe("turn into on a bare cursor", () => {
	// The right-click contract: no selection exists, the command converts the
	// whole textblock under the cursor.
	test("heading and quote convert the cursor's block", () => {
		editor.commands.setContent("first\n\nsecond");
		editor.commands.setTextSelection(9); // middle of "second"
		editor.chain().focus().setHeading({ level: 2 }).run();
		expect(blocks(editor)[1]?.type).toBe("heading");
		expect(blocks(editor)[1]?.content?.[0]?.text).toBe("second");

		editor.commands.setContent("first\n\nsecond");
		editor.commands.setTextSelection(9);
		editor.chain().focus().toggleBlockquote().run();
		expect(blocks(editor)[1]?.type).toBe("blockquote");
	});
});

describe("bubble visibility", () => {
	test("hidden on empty selection, shown on text selection", () => {
		editor.commands.setContent("hello world");
		expect(shouldShowBubble(editor.state, false)).toBe(false);
		editor.commands.setTextSelection({ from: 1, to: 6 });
		expect(shouldShowBubble(editor.state, false)).toBe(true);
	});

	test("shown on image node selection only, forced overrides empty", () => {
		// Standalone image markdown parses as a top-level block at position 0.
		editor.commands.setContent("![alt](./a.png)\n\nhello");
		editor.commands.setTextSelection(8); // cursor in the paragraph
		expect(shouldShowBubble(editor.state, false)).toBe(false);
		expect(shouldShowBubble(editor.state, true)).toBe(true);
		editor.commands.setNodeSelection(0);
		expect(editor.state.selection instanceof NodeSelection).toBe(true);
		expect(shouldShowBubble(editor.state, false)).toBe(true);
	});
});

describe("comment marks survive formatting", () => {
	test("bolding across a data-c span keeps the anchor intact", () => {
		editor.commands.setContent(
			'plain text <span data-c="t1">anchored</span> more plain',
		);
		editor.commands.selectAll();
		editor.chain().focus().toggleBold().run();
		const markdown: string = editor.storage.markdown.getMarkdown();
		expect(markdown).toContain('<span data-c="t1">');
		expect(markdown).toContain("**");
	});

	test("turning the block into a quote keeps the span", () => {
		editor.commands.setContent('one <span data-c="t2">two</span> three');
		editor.commands.setTextSelection(2);
		editor.chain().focus().toggleBlockquote().run();
		const markdown: string = editor.storage.markdown.getMarkdown();
		expect(markdown).toContain('<span data-c="t2">');
		expect(markdown.startsWith("> ")).toBe(true);
	});
});

describe("placeholder hint", () => {
	test("empty editor carries the placeholder decoration", () => {
		const empty = makeEditor();
		const html = empty.view.dom.innerHTML;
		expect(html).toContain("data-placeholder");
		expect(html).toContain("is-empty");
	});
});

describe("doc load resets the caret to the top (Edit-flip scroll)", () => {
	// EditorPane's load effect (M4-3): setContent is a whole-doc replace
	// that maps the caret to the doc's END, so the Edit-flip focus()
	// scrolled the end into view. The reset runs in read mode too — the
	// non-editable view stays focusable, so a text selection is safe.
	test("setContent alone lands at the end; the load sequence lands at the start", () => {
		const e = new Editor({
			extensions: editorExtensions(),
			content: "",
			editable: false,
		});
		// Root cause, pinned: the caret sits at the end of the last block.
		e.commands.setContent("# top\n\nbody text");
		expect(e.state.selection.from).toBe(e.state.doc.content.size - 1);
		// The load effect's reset: position 0 clamps to the first valid text
		// position (PM positions start at 1) — the doc start.
		e.commands.setTextSelection(0);
		expect(e.state.selection.from).toBe(1);
		// The Edit flip keeps the caret (and so the scroll) at the top.
		e.setEditable(true);
		e.commands.focus();
		expect(e.state.selection.from).toBe(1);
		e.destroy();
	});
});

describe("slash extension coexists with the corpus gate", () => {
	test("the extension set still parses and serializes the corpus body", () => {
		const corpusBody = readFileSync(
			join(__dirname, "fixtures", "corpus.md"),
			"utf8",
		).replace(/^---\n[\s\S]*?\n---\n/, "");
		const e = makeEditor(corpusBody);
		const out: string = e.storage.markdown.getMarkdown();
		expect(out).toContain("<span data-c=");
		expect(out).toContain("|"); // tables still serialize
	});
});
