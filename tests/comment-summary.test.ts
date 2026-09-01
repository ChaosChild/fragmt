// Dogfood round (#15): the preview's span-title formatter (comment-summary.ts)
// – the thread's first comment as one tooltip line, tolerant of the pieces the
// sidecar may not carry.
import { describe, expect, test } from "vitest";
import type { CommentThread } from "../ui/src/api.js";
import { commentSpanTitle } from "../ui/src/comment-summary.js";

function thread(over: Partial<CommentThread> = {}): CommentThread {
	return {
		id: "c1",
		quote: "some text",
		author: "andrei",
		createdAt: "2026-08-26T10:00:00Z",
		resolved: false,
		replies: [{ author: "andrei", body: "Pin this wording?", at: "..." }],
		...over,
	};
}

describe("commentSpanTitle", () => {
	test("the full line: author, status, quoted first body", () => {
		expect(commentSpanTitle(thread())).toBe(
			'andrei · open – "Pin this wording?"',
		);
	});

	test("resolved wording flips the status segment", () => {
		expect(commentSpanTitle(thread({ resolved: true }))).toBe(
			'andrei · resolved – "Pin this wording?"',
		);
	});

	test("long bodies collapse whitespace and truncate with an ellipsis", () => {
		const body = `word ${"x".repeat(100)}\n\n  end`;
		const out = commentSpanTitle(
			thread({ replies: [{ author: "a", body, at: "..." }] }),
		);
		expect(out.startsWith('andrei · open – "word ')).toBe(true);
		expect(out.endsWith('…"')).toBe(true);
		expect(out.length).toBeLessThanOrEqual(
			"andrei · open – ".length + 1 + 80 + 2,
		);
	});

	test("missing body leaves the bare meta line", () => {
		expect(commentSpanTitle(thread({ replies: [] }))).toBe("andrei · open");
	});

	test("missing author keeps the status leg standing", () => {
		expect(
			commentSpanTitle(
				thread({
					author: "",
					replies: [{ author: "", body: "hi", at: "..." }],
				}),
			),
		).toBe('open – "hi"');
	});
});
