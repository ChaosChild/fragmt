// #14 b2: the search modal's <mark> source – pure segmentation, tested
// without React (dnd.test.ts's model: the component stays a thin render over
// this). Match at start/middle/end/multiple, case-insensitive, no-match
// passthrough, plus the trim and empty-query words the modal feeds it.
import { describe, expect, test } from "vitest";
import { highlightSegments, plainExcerpt } from "../ui/src/highlight.js";

describe("highlightSegments", () => {
	test("match at the start", () => {
		expect(highlightSegments("fragmt notes", "frag")).toEqual([
			{ text: "frag", hit: true },
			{ text: "mt notes", hit: false },
		]);
	});

	test("match in the middle", () => {
		expect(highlightSegments("the fragmt docs", "frag")).toEqual([
			{ text: "the ", hit: false },
			{ text: "frag", hit: true },
			{ text: "mt docs", hit: false },
		]);
	});

	test("match at the end", () => {
		expect(highlightSegments("search in fragmt", "fragmt")).toEqual([
			{ text: "search in ", hit: false },
			{ text: "fragmt", hit: true },
		]);
	});

	test("multiple matches split the plain spans between them", () => {
		expect(highlightSegments("aXbXc", "x")).toEqual([
			{ text: "a", hit: false },
			{ text: "X", hit: true },
			{ text: "b", hit: false },
			{ text: "X", hit: true },
			{ text: "c", hit: false },
		]);
	});

	test("adjacent matches leave no empty plain span", () => {
		expect(highlightSegments("abab", "a")).toEqual([
			{ text: "a", hit: true },
			{ text: "b", hit: false },
			{ text: "a", hit: true },
			{ text: "b", hit: false },
		]);
	});

	test("matching is case-insensitive, original casing kept", () => {
		expect(highlightSegments("FragMT rocks", "fragmt")).toEqual([
			{ text: "FragMT", hit: true },
			{ text: " rocks", hit: false },
		]);
	});

	test("no match passes the text through whole", () => {
		expect(highlightSegments("plain text", "zzz")).toEqual([
			{ text: "plain text", hit: false },
		]);
	});

	test("the query is trimmed before matching", () => {
		expect(highlightSegments("abc abc", " abc ")).toEqual([
			{ text: "abc", hit: true },
			{ text: " ", hit: false },
			{ text: "abc", hit: true },
		]);
	});

	test("empty (or whitespace) query is a pure passthrough", () => {
		expect(highlightSegments("any text", "")).toEqual([
			{ text: "any text", hit: false },
		]);
		expect(highlightSegments("any text", "   ")).toEqual([
			{ text: "any text", hit: false },
		]);
	});
});

describe("plainExcerpt (search preview)", () => {
	test("flattens markdown to plain paragraphs – no fences, tags, link syntax or markers", () => {
		const body = [
			"# Heading",
			"",
			'A **bold** [link](a.md) and <span data-c="x">marked</span> `code`.',
			"",
			"```ts",
			"const hidden = 1;",
			"```",
			"",
			"- item one",
		].join("\n");
		expect(plainExcerpt(body)).toEqual([
			"Heading",
			"A bold link and marked code.",
			"item one",
		]);
	});

	test("stops near the limit and marks the cut", () => {
		const out = plainExcerpt(`${"word ".repeat(50)}\n\nnever reached`, 40);
		expect(out).toHaveLength(1);
		expect(out[0].endsWith("…")).toBe(true);
		expect(out[0].length).toBeLessThanOrEqual(41);
	});

	test("nested tags strip until nothing tag-shaped is left", () => {
		const out = plainExcerpt("Hi <scr<b>ipt>alert(1)</scr</b>ipt> there");
		expect(out.join("")).not.toContain("<");
		expect(out.join("")).toContain("alert(1)");
	});
});
