// ui v1 phase 5: the marginalia layout – pure arithmetic over measured
// anchors and note heights (the DOM measuring lives in CommentsRail).
import { describe, expect, test } from "vitest";
import { layoutNotes, type NoteBox } from "../ui/src/margin-layout.js";

const opts = { gap: 10, top: 40 };

/** [top, bottom) spans of the placed notes, in placement order. */
function spans(items: NoteBox[], placed: Map<string, number>) {
	return items
		.filter((i) => placed.has(i.id))
		.map((i) => {
			const y = placed.get(i.id) ?? 0;
			return { id: i.id, top: y, bottom: y + i.height };
		})
		.sort((a, b) => a.top - b.top);
}

describe("layoutNotes", () => {
	test("three notes anchored 10px apart never overlap and keep the gap", () => {
		const items = [
			{ id: "a", anchorTop: 200, height: 80 },
			{ id: "b", anchorTop: 210, height: 60 },
			{ id: "c", anchorTop: 220, height: 40 },
		];
		const s = spans(items, layoutNotes(items, opts));
		expect(s[0].top).toBe(186); // anchorTop − 14
		for (let k = 1; k < s.length; k++)
			expect(s[k].top).toBeGreaterThanOrEqual(s[k - 1].bottom + opts.gap);
	});

	test("order follows the anchors, not the input order", () => {
		const items = [
			{ id: "late", anchorTop: 900, height: 50 },
			{ id: "early", anchorTop: 100, height: 50 },
			{ id: "mid", anchorTop: 500, height: 50 },
		];
		const s = spans(items, layoutNotes(items, opts));
		expect(s.map((x) => x.id)).toEqual(["early", "mid", "late"]);
		// Far apart: each sits at its own anchor.
		expect(s.map((x) => x.top)).toEqual([86, 486, 886]);
	});

	test("orphans (no anchor) are not placed", () => {
		const placed = layoutNotes(
			[
				{ id: "live", anchorTop: 300, height: 50 },
				{ id: "orphan", anchorTop: null, height: 50 },
			],
			opts,
		);
		expect(placed.has("live")).toBe(true);
		expect(placed.has("orphan")).toBe(false);
	});

	test("nothing goes above the top line", () => {
		const placed = layoutNotes([{ id: "a", anchorTop: 0, height: 50 }], opts);
		expect(placed.get("a")).toBe(40);
	});

	test("the focused note lands exactly on its anchor; earlier notes move up when there's room", () => {
		const items = [
			{ id: "a", anchorTop: 400, height: 100 },
			{ id: "b", anchorTop: 420, height: 100 },
		];
		const unfocused = layoutNotes(items, opts);
		expect(unfocused.get("a")).toBe(386);
		expect(unfocused.get("b")).toBe(496); // pushed below a

		const focused = layoutNotes(items, { ...opts, focused: "b" });
		expect(focused.get("b")).toBe(406); // exactly anchorTop − 14
		expect(focused.get("a")).toBe(296); // moved up: 406 − 10 − 100
		const s = spans(items, focused);
		expect(s[1].top).toBeGreaterThanOrEqual(s[0].bottom + opts.gap);
	});

	test("without room above, earlier notes stack from the top and the focused one waits below", () => {
		const items = [
			{ id: "a", anchorTop: 60, height: 100 },
			{ id: "b", anchorTop: 70, height: 100 },
		];
		const placed = layoutNotes(items, { ...opts, focused: "b" });
		expect(placed.get("a")).toBe(46);
		expect(placed.get("b")).toBe(156); // 46 + 100 + 10
	});

	test("a note taller than the gap to the next anchor pushes the rest down", () => {
		const items = [
			{ id: "tall", anchorTop: 100, height: 300 },
			{ id: "next", anchorTop: 150, height: 40 },
			{ id: "last", anchorTop: 200, height: 40 },
		];
		const placed = layoutNotes(items, opts);
		expect(placed.get("tall")).toBe(86);
		expect(placed.get("next")).toBe(396); // 86 + 300 + 10
		expect(placed.get("last")).toBe(446); // 396 + 40 + 10
	});
});
