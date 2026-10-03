// ui v1 phase 9: the rendered PR diff's pure half – frontmatter by key,
// the body by block (reflow vs changed vs added/removed), words inside
// changed blocks, and the comment-span strip kept in step with core's.
import { describe, expect, test } from "vitest";
import { stripCommentSpan } from "../src/core/comments.js";
import {
	diffBlocks,
	diffFrontmatter,
	diffWords,
	stripCommentSpans,
} from "../ui/src/prose-diff.js";

describe("diffFrontmatter", () => {
	test("same, changed, added and removed keys; object key order is not a change", () => {
		const out = diffFrontmatter(
			{ title: "A", type: "concept", tags: ["x"], meta: { a: 1, b: 2 } },
			{ title: "B", tags: ["x"], meta: { b: 2, a: 1 }, status: "draft" },
		);
		expect(out.map((c) => [c.key, c.kind])).toEqual([
			["title", "changed"],
			["type", "removed"],
			["tags", "same"],
			["meta", "same"],
			["status", "added"],
		]);
		expect(out[0]).toMatchObject({ before: "A", after: "B" });
	});

	test("a missing side is an empty frontmatter", () => {
		expect(diffFrontmatter(null, { title: "New" })).toEqual([
			{ key: "title", kind: "added", after: "New" },
		]);
	});
});

describe("diffBlocks", () => {
	test("a hard-wrapped paragraph rewrapped to one line is a reflow, not a change", () => {
		const out = diffBlocks(
			"First line of a\nwrapped paragraph.\n\nKept.",
			"First line of a wrapped paragraph.\n\nKept.",
		);
		expect(out.map((b) => b.type)).toEqual(["reflow", "same"]);
	});

	test("a one-word edit pairs the blocks as changed", () => {
		const out = diffBlocks("The quick fox.\n\nTail.", "The slow fox.\n\nTail.");
		expect(out[0]).toMatchObject({
			type: "changed",
			kind: "paragraph",
			a: "The quick fox.",
			b: "The slow fox.",
		});
		expect(out[1].type).toBe("same");
	});

	test("a sentence appended as a new paragraph at the end is added", () => {
		const out = diffBlocks("One.\n\nTwo.", "One.\n\nTwo.\n\nThree is new.");
		expect(out.map((b) => b.type)).toEqual(["same", "same", "added"]);
		expect(out[2].b).toBe("Three is new.");
	});

	test("code fences never pair for a word diff – they swap whole", () => {
		const out = diffBlocks(
			"```js\nconst a = 1;\n```",
			"```js\nconst a = 2;\n```",
		);
		expect(out.map((b) => b.type)).toEqual(["removed", "added"]);
		expect(out.every((b) => b.kind === "fence")).toBe(true);
	});

	test("blocks of different kinds don't pair", () => {
		const out = diffBlocks("## Old heading", "A paragraph now.");
		expect(out.map((b) => b.type)).toEqual(["removed", "added"]);
	});

	test("comment spans are stripped before comparing – a new anchor is no change", () => {
		const out = diffBlocks(
			"Some text here.",
			'Some <span data-c="c1">text</span> here.',
		);
		expect(out.map((b) => b.type)).toEqual(["same"]);
	});
});

describe("diffWords", () => {
	test("a single-word change is one del and one ins between same parts", () => {
		expect(diffWords("The quick fox.", "The slow fox.")).toEqual([
			{ type: "same", text: "The " },
			{ type: "del", text: "quick" },
			{ type: "ins", text: "slow" },
			{ type: "same", text: " fox." },
		]);
	});

	test("a rewrap inside a changed block is no change – only the words are", () => {
		expect(diffWords("one two\nthree four", "one two three five")).toEqual([
			{ type: "same", text: "one two three " },
			{ type: "del", text: "four" },
			{ type: "ins", text: "five" },
		]);
	});

	test("an inserted sentence at the end is one ins", () => {
		expect(diffWords("Done.", "Done. And more.")).toEqual([
			{ type: "same", text: "Done." },
			{ type: "ins", text: " And more." },
		]);
	});

	test("past the size guard the block is one del + one ins", () => {
		const a = Array.from({ length: 600 }, (_, i) => `a${i}`).join(" ");
		const b = Array.from({ length: 600 }, (_, i) => `b${i}`).join(" ");
		expect(diffWords(a, b)).toEqual([
			{ type: "del", text: a },
			{ type: "ins", text: b },
		]);
	});
});

describe("stripCommentSpans mirrors core's stripCommentSpan", () => {
	const fixtures: [string, string[]][] = [
		['A <span data-c="x1">marked</span> word.', ["x1"]],
		['<span data-c="a">one</span> and <span data-c="b">two</span>', ["a", "b"]],
		["No spans at all.", []],
		['Multi <span data-c="m">line\nspan</span> end', ["m"]],
	];
	for (const [body, ids] of fixtures)
		test(JSON.stringify(body), () => {
			const core = ids.reduce((s, id) => stripCommentSpan(s, id), body);
			expect(stripCommentSpans(body)).toBe(core);
		});
});
