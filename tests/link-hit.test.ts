// #15 link interception: the hover-↗ zone's pure hit test — the glyph is a
// pseudo-element, so its "click" is geometric (link-hit.ts); EditorPane
// pairs it with Shift as the read-mode preview gestures.
import { describe, expect, test } from "vitest";
import { DOC_LINK_ICON_PX, isIconHit } from "../ui/src/link-hit.js";

describe("isIconHit", () => {
	const rect = { left: 100, right: 200 };

	test("inside the zone: the right edge and the last 18px of it", () => {
		expect(isIconHit(200, rect)).toBe(true);
		expect(isIconHit(192, rect)).toBe(true);
		expect(isIconHit(200 - DOC_LINK_ICON_PX, rect)).toBe(true);
	});

	test("outside the zone: mid-link clicks keep the plain navigate", () => {
		expect(isIconHit(100, rect)).toBe(false);
		expect(isIconHit(150, rect)).toBe(false);
		expect(isIconHit(200 - DOC_LINK_ICON_PX - 1, rect)).toBe(false);
	});

	test("clicks off the link entirely are never icon hits", () => {
		expect(isIconHit(99, rect)).toBe(false);
		expect(isIconHit(201, rect)).toBe(false);
		expect(isIconHit(0, rect)).toBe(false);
	});

	test("zero-width and inverted rects have no zone", () => {
		expect(isIconHit(100, { left: 100, right: 100 })).toBe(false);
		expect(isIconHit(150, { left: 200, right: 100 })).toBe(false);
	});

	test("a link narrower than the zone is all zone — the documented ceiling", () => {
		const tiny = { left: 100, right: 108 };
		expect(isIconHit(101, tiny)).toBe(true);
		expect(isIconHit(108, tiny)).toBe(true);
	});
});
