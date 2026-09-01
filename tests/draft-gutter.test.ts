// @vitest-environment happy-dom
//
// #18: the draft gutter's pure half – markdown source blocks, the diff-line
// → block mapping, and the mapping run against a real headless editor
// document (editing-controls.test.ts pattern).
import { Editor } from "@tiptap/core";
import { describe, expect, test } from "vitest";
import { mapRangesToBlocks, sourceBlockSpans } from "../ui/src/draft-gutter.js";
import { editorExtensions } from "../ui/src/editor/extensions.js";

describe("sourceBlockSpans", () => {
	test("paragraphs and ATX headings split on blank lines", () => {
		expect(
			sourceBlockSpans("para one\npara one more\n\n## head\n\npara two"),
		).toEqual([
			{ start: 1, end: 2 },
			{ start: 4, end: 4 },
			{ start: 6, end: 6 },
		]);
	});

	test("blank lines inside a fence never split; the closer ends the fence", () => {
		// Lines: 1 before, 3 ```ts, 4 code, 5 blank, 6 code, 7 ```, 9 after.
		const body = "before\n\n```ts\nconst a = 1;\n\nstill fenced\n```\n\nafter";
		expect(sourceBlockSpans(body)).toEqual([
			{ start: 1, end: 1 },
			{ start: 3, end: 7 },
			{ start: 9, end: 9 },
		]);
	});

	test("a tilde fence ignores backticks; only a same-char closer ends it", () => {
		// ~~~~ opens; ``` is content; ~~~~ closes; the blank line then splits.
		expect(sourceBlockSpans("~~~~md\n```\n~~~~\n\ntail")).toEqual([
			{ start: 1, end: 3 },
			{ start: 5, end: 5 },
		]);
	});

	test("tight lists and tables hold together as one span each", () => {
		const body = "- a\n- b\n\n| a | b |\n| --- | --- |\n| 1 | 2 |";
		expect(sourceBlockSpans(body)).toEqual([
			{ start: 1, end: 2 },
			{ start: 4, end: 6 },
		]);
		// A LOOSE list splits per item – verified to match tiptap-markdown,
		// which renders it as one list node per item (see the editor test
		// below), so the spans and the doc children stay aligned.
		expect(sourceBlockSpans("- a\n\n- b")).toEqual([
			{ start: 1, end: 1 },
			{ start: 3, end: 3 },
		]);
	});

	test("empty and blank-only bodies have no spans", () => {
		expect(sourceBlockSpans("")).toEqual([]);
		expect(sourceBlockSpans("\n\n")).toEqual([]);
	});
});

describe("mapRangesToBlocks", () => {
	const spans = [
		{ start: 1, end: 2 },
		{ start: 4, end: 4 },
		{ start: 6, end: 8 },
	];

	test("overlapping ranges mark their blocks; between-blocks gaps mark none", () => {
		expect(mapRangesToBlocks([{ start: 2, end: 2 }], spans, 3)).toEqual(
			new Set([0]),
		);
		expect(mapRangesToBlocks([{ start: 7, end: 9 }], spans, 3)).toEqual(
			new Set([2]),
		);
		expect(mapRangesToBlocks([{ start: 3, end: 3 }], spans, 3)).toEqual(
			new Set(),
		);
		expect(mapRangesToBlocks([{ start: 1, end: 6 }], spans, 3)).toEqual(
			new Set([0, 1, 2]),
		);
	});

	test("span-count mismatch bails to an empty set (correct-or-absent)", () => {
		expect(mapRangesToBlocks([{ start: 1, end: 2 }], spans, 4)).toEqual(
			new Set(),
		);
		expect(mapRangesToBlocks([{ start: 1, end: 2 }], spans, 2)).toEqual(
			new Set(),
		);
	});
});

describe("the gutter mapping against a real editor document", () => {
	test("changed ranges mark exactly the matching top-level children", () => {
		// Body lines: 1 para, 3 para, 5-9 fence (7 is a blank inside), 11 para.
		const body =
			"first para\n\nchanged one\n\n```\nfenced\n\nblank inside\n```\n\nlast";
		const e = new Editor({ extensions: editorExtensions(), content: "" });
		e.commands.setContent(body);
		const spans = sourceBlockSpans(body);
		const marked = mapRangesToBlocks(
			[
				{ start: 3, end: 3 },
				{ start: 7, end: 8 },
			],
			spans,
			e.state.doc.childCount,
		);
		expect(marked).toEqual(new Set([1, 2]));
		// The component's DOM walk: top-level element children, index-aligned
		// with the doc children the mapping produced.
		const kids = Array.from(e.view.dom.children);
		expect(kids).toHaveLength(spans.length);
		kids.forEach((el, i) => {
			if (marked.has(i)) el.classList.add("draft-changed");
		});
		expect(
			Array.from(e.view.dom.children).map((el) =>
				el.classList.contains("draft-changed"),
			),
		).toEqual([false, true, true, false]);
		e.destroy();
	});

	test("a loose list still maps: the parser splits it the same way", () => {
		// tiptap-markdown parses "- one\n\n- two" as two top-level list nodes,
		// so the 2 source spans agree with childCount and both map – the
		// count guard stays silent because the shapes really do align.
		const body = "- one\n\n- two";
		const e = new Editor({ extensions: editorExtensions(), content: "" });
		e.commands.setContent(body);
		expect(e.state.doc.childCount).toBe(2);
		expect(
			mapRangesToBlocks(
				[{ start: 1, end: 3 }],
				sourceBlockSpans(body),
				e.state.doc.childCount,
			),
		).toEqual(new Set([0, 1]));
		e.destroy();
	});
});
