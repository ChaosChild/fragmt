import { expect, test } from "vitest";
import { popoverPosition } from "../ui/src/popover-position.js";

// The shared popover's position math: hug the anchor's bottom-left, nudged
// inside the viewport by the popover's OWN measured size. The hardcoded
// 280/230 reservations this replaced misplaced narrow popovers opened near
// the right edge - the signed-in chip's "Sign out" (#20 owner round).

const VIEW = { width: 1400, height: 800 };

test("hugs the anchor's bottom-left corner in the common case", () => {
	expect(
		popoverPosition(
			{ left: 100, bottom: 50 },
			{ width: 110, height: 36 },
			VIEW,
		),
	).toEqual({ top: 56, left: 100 });
});

test("a right-edge anchor keeps the popover under the button (the chip's case)", () => {
	// Chip near the viewport's right edge: the old clamp pulled left by a
	// fixed 280 (to 1086) - a ~160px gap. The measured clamp only reserves
	// the popover's own width.
	const p = popoverPosition(
		{ left: 1250, bottom: 45 },
		{ width: 110, height: 36 },
		{ width: 1366, height: 768 },
	);
	expect(p.left).toBe(1248); // 1366 - 110 - 8
	expect(p.top).toBe(51);
});

test("an anchor too close to the right edge nudges the popover inside", () => {
	// Anchor's left + popover width would overflow: shift left, keep the margin.
	const p = popoverPosition(
		{ left: 1355, bottom: 45 },
		{ width: 110, height: 36 },
		{ width: 1366, height: 768 },
	);
	expect(p.left).toBe(1248);
});

test("a tall menu near the viewport bottom flips up inside instead of overflowing", () => {
	const p = popoverPosition(
		{ left: 100, bottom: 790 },
		{ width: 240, height: 300 },
		VIEW,
	);
	expect(p.top).toBe(492); // 800 - 300 - 8
	expect(p.left).toBe(100);
});

test("floors hold on a tiny viewport - never above or left of the margin", () => {
	const p = popoverPosition(
		{ left: 4, bottom: 4 },
		{ width: 240, height: 300 },
		{ width: 320, height: 320 },
	);
	// top hugs the anchor (r.bottom + gap = 10 fits inside 320 - 300 - 8 = 12);
	// left nudges inside (4 would overflow 240 + 8).
	expect(p.top).toBe(10);
	expect(p.left).toBe(8);
});
