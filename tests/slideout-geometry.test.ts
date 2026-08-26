// @vitest-environment happy-dom
//
// #15 slideout geometry: the drag split's clamp and its localStorage
// round-trip are the batch's only pure logic — the % edition of
// tests/sidebar.test.ts. The pointer divider itself lives in Slideout.tsx.
import { afterEach, describe, expect, test } from "vitest";
import {
	clampSlideoutShare,
	readStoredSlideoutShare,
	SLIDEOUT_SHARE_DEFAULT,
	SLIDEOUT_SHARE_MAX,
	SLIDEOUT_SHARE_MIN,
	storeSlideoutShare,
} from "../ui/src/slideout-geometry.js";

afterEach(() => {
	localStorage.clear();
});

describe("clampSlideoutShare", () => {
	test("clamps below/above the range — main keeps 40–60%", () => {
		expect(clampSlideoutShare(-1)).toBe(SLIDEOUT_SHARE_MIN);
		expect(clampSlideoutShare(0)).toBe(SLIDEOUT_SHARE_MIN);
		expect(clampSlideoutShare(0.39)).toBe(SLIDEOUT_SHARE_MIN);
		expect(clampSlideoutShare(0.61)).toBe(SLIDEOUT_SHARE_MAX);
		expect(clampSlideoutShare(1)).toBe(SLIDEOUT_SHARE_MAX);
	});

	test("passes in-range shares through", () => {
		expect(clampSlideoutShare(SLIDEOUT_SHARE_MIN)).toBe(SLIDEOUT_SHARE_MIN);
		expect(clampSlideoutShare(0.5)).toBe(0.5);
		expect(clampSlideoutShare(SLIDEOUT_SHARE_DEFAULT)).toBe(
			SLIDEOUT_SHARE_DEFAULT,
		);
		expect(clampSlideoutShare(SLIDEOUT_SHARE_MAX)).toBe(SLIDEOUT_SHARE_MAX);
	});

	test("rounds pointer-math float tails to 4 decimals", () => {
		expect(clampSlideoutShare(0.47368421052631576)).toBe(0.4737);
	});

	test("non-finite input falls back to the default", () => {
		expect(clampSlideoutShare(Number.NaN)).toBe(SLIDEOUT_SHARE_DEFAULT);
		expect(clampSlideoutShare(Number.POSITIVE_INFINITY)).toBe(
			SLIDEOUT_SHARE_DEFAULT,
		);
	});
});

describe("stored slideout share", () => {
	test("round-trips a persisted share", () => {
		storeSlideoutShare(0.47);
		expect(readStoredSlideoutShare()).toBe(0.47);
	});

	test("restores out-of-range values with the same clamp", () => {
		localStorage.setItem("fragmt.slideoutShare", "0.95");
		expect(readStoredSlideoutShare()).toBe(SLIDEOUT_SHARE_MAX);
		localStorage.setItem("fragmt.slideoutShare", "0.1");
		expect(readStoredSlideoutShare()).toBe(SLIDEOUT_SHARE_MIN);
	});

	test("the 0.55 default when absent, empty, or non-numeric", () => {
		expect(readStoredSlideoutShare()).toBe(SLIDEOUT_SHARE_DEFAULT);
		localStorage.setItem("fragmt.slideoutShare", "");
		expect(readStoredSlideoutShare()).toBe(SLIDEOUT_SHARE_DEFAULT);
		localStorage.setItem("fragmt.slideoutShare", "not-a-number");
		expect(readStoredSlideoutShare()).toBe(SLIDEOUT_SHARE_DEFAULT);
	});
});
