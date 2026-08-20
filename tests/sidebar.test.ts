// @vitest-environment happy-dom
//
// M4-3 b3 sidebar geometry: the resize width clamp and its localStorage
// round-trip are the batch's only pure logic — the rest is CSS (visual
// acceptance) plus the pointer handle in Sidebar.tsx.
import { afterEach, describe, expect, test } from "vitest";
import {
	clampSidebarWidth,
	readStoredSidebarWidth,
	SIDEBAR_W_MAX,
	SIDEBAR_W_MIN,
	storeSidebarWidth,
} from "../ui/src/sidebar-geometry.js";

afterEach(() => {
	localStorage.clear();
});

describe("clampSidebarWidth", () => {
	test("clamps below/above the range", () => {
		expect(clampSidebarWidth(-5)).toBe(SIDEBAR_W_MIN);
		expect(clampSidebarWidth(0)).toBe(SIDEBAR_W_MIN);
		expect(clampSidebarWidth(100000)).toBe(SIDEBAR_W_MAX);
	});

	test("rounds fractional drags", () => {
		expect(clampSidebarWidth(333.6)).toBe(334);
	});

	test("passes in-range widths through", () => {
		expect(clampSidebarWidth(SIDEBAR_W_MIN)).toBe(SIDEBAR_W_MIN);
		expect(clampSidebarWidth(332)).toBe(332);
		expect(clampSidebarWidth(SIDEBAR_W_MAX)).toBe(SIDEBAR_W_MAX);
	});

	test("non-finite input falls back to the minimum", () => {
		expect(clampSidebarWidth(Number.NaN)).toBe(SIDEBAR_W_MIN);
		expect(clampSidebarWidth(Number.POSITIVE_INFINITY)).toBe(SIDEBAR_W_MIN);
	});
});

describe("stored sidebar width", () => {
	test("round-trips a persisted width", () => {
		storeSidebarWidth(400);
		expect(readStoredSidebarWidth()).toBe(400);
	});

	test("restores out-of-range values with the same clamp", () => {
		localStorage.setItem("fragmt.sidebarW", "9999");
		expect(readStoredSidebarWidth()).toBe(SIDEBAR_W_MAX);
		localStorage.setItem("fragmt.sidebarW", "12");
		expect(readStoredSidebarWidth()).toBe(SIDEBAR_W_MIN);
	});

	test("null when absent, empty, zero, or non-numeric", () => {
		expect(readStoredSidebarWidth()).toBeNull();
		localStorage.setItem("fragmt.sidebarW", "");
		expect(readStoredSidebarWidth()).toBeNull();
		localStorage.setItem("fragmt.sidebarW", "0");
		expect(readStoredSidebarWidth()).toBeNull();
		localStorage.setItem("fragmt.sidebarW", "not-a-number");
		expect(readStoredSidebarWidth()).toBeNull();
	});
});
