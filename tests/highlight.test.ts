// #14 b2: the search modal's <mark> source — pure segmentation, tested
// without React (dnd.test.ts's model: the component stays a thin render over
// this). Match at start/middle/end/multiple, case-insensitive, no-match
// passthrough, plus the trim and empty-query words the modal feeds it.
import { describe, expect, test } from "vitest";
import { highlightSegments } from "../ui/src/highlight.js";

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
