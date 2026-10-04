// @vitest-environment happy-dom
//
// M4-3 b3 sidebar geometry: the resize width clamp and its localStorage
// round-trip. ui v1 phase 3: the trust mark mapping and the nested tree
// (headings, disclosure rows, OKF folder = index) under happy-dom.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { RepoMeta, TreeNode } from "../ui/src/api.js";
import { trustClass } from "../ui/src/display.js";
import { Sidebar } from "../ui/src/Sidebar.js";
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

// RTL wraps render/fireEvent in act; React 19 requires the flag.
(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// --- ui v1 phase 3: the navigator tree --------------------------------------

describe("trustClass", () => {
	const okf = (
		tier: "unverified" | "machine-confirmed" | "human-reviewed",
		staleAfter: string | null = null,
	) => ({ type: "concept", status: null, tier, staleAfter });
	const now = Date.parse("2026-10-03T00:00:00Z");

	test("each tier maps to its mark; no OKF data is no mark", () => {
		expect(trustClass(okf("unverified"), now)).toBe("u");
		expect(trustClass(okf("machine-confirmed"), now)).toBe("m");
		expect(trustClass(okf("human-reviewed"), now)).toBe("h");
		expect(trustClass(undefined, now)).toBeNull();
	});

	test("stale wins over every tier; a future stale_after doesn't", () => {
		const past = "2026-01-01T00:00:00Z";
		expect(trustClass(okf("human-reviewed", past), now)).toBe("s");
		expect(trustClass(okf("unverified", past), now)).toBe("s");
		expect(trustClass(okf("human-reviewed", "2027-01-01T00:00:00Z"), now)).toBe(
			"h",
		);
	});
});

describe("Sidebar: nested folders (component harness)", () => {
	// a/ (level 1) > b/ (level 2) > c/ (level 3) > d/ (level 4); each folder
	// carries an index.md and one doc.
	const dir = (path: string, children: TreeNode[]): TreeNode => ({
		name: path.split("/").at(-1) ?? path,
		path,
		type: "dir",
		children,
	});
	const doc = (path: string): TreeNode => ({
		name: path.split("/").at(-1) ?? path,
		path,
		type: "doc",
	});
	const TREE = dir("", [
		dir("a", [
			doc("a/index.md"),
			doc("a/one.md"),
			dir("a/b", [
				doc("a/b/index.md"),
				doc("a/b/two.md"),
				dir("a/b/c", [
					doc("a/b/c/three.md"),
					dir("a/b/c/d", [doc("a/b/c/d/index.md"), doc("a/b/c/d/four.md")]),
				]),
			]),
		]),
		doc("root.md"),
	]);
	const meta = (okf: boolean): RepoMeta => ({
		main: "main",
		current: "main",
		docs: {},
		drafts: {},
		deleted: [],
		authors: {},
		agents: [],
		okf,
		merge: null,
	});
	const props = (okf: boolean, onSelect = vi.fn()) => ({
		tree: TREE,
		selected: "a/b/c/d/four.md",
		onSelect,
		meta: meta(okf),
		expandFolder: null,
		onOpenGhost: () => {},
		onRestore: () => {},
		onDropItem: () => {},
		onDropBin: () => {},
	});
	const frow = (name: string) => {
		const el = [...document.querySelectorAll<HTMLElement>(".frow")].find(
			(f) => f.querySelector(".fn")?.textContent === name,
		);
		if (!el) throw new Error(`no folder row ${name}`);
		return el;
	};

	afterEach(() => cleanup());

	test("level 1 is a section heading, deeper levels are disclosure rows inside .sub, counts are recursive", () => {
		render(createElement(Sidebar, props(false)));
		const heading = document.querySelector(".fold-h");
		expect(heading?.querySelector(".fn")?.textContent).toBe("a");
		// Non-OKF: index.md rows are ordinary docs and count.
		expect(heading?.querySelector(".n")?.textContent).toBe("7");
		expect(frow("b").querySelector(".n")?.textContent).toBe("5");
		expect(frow("d").querySelector(".n")?.textContent).toBe("2");
		// b's row sits in level 1's body; c and d each sit one .sub deeper.
		expect(frow("b").closest(".sub")).toBeNull();
		expect(frow("c").closest(".sub")).toBeTruthy();
		expect(
			frow("d").closest(".sub")?.parentElement?.closest(".sub"),
		).toBeTruthy();
		// The .sub holding the current doc wears the accent rule – every
		// ancestor of a/b/c/d/four.md, nothing else.
		expect(document.querySelectorAll(".sub.cur").length).toBe(3);
		expect(screen.getByRole("button", { name: "Fold d" })).toBeTruthy();
	});

	test("a collapsed folder hides its subtree and stays collapsed across a re-render", () => {
		const view = render(createElement(Sidebar, props(false)));
		expect(document.querySelector('[data-path="a/b/c/three.md"]')).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Fold c" }));
		expect(document.querySelector('[data-path="a/b/c/three.md"]')).toBeNull();
		expect(document.querySelector('[data-path="a/b/c/d/four.md"]')).toBeNull();
		view.rerender(
			createElement(Sidebar, { ...props(false), selected: "root.md" }),
		);
		expect(document.querySelector('[data-path="a/b/c/three.md"]')).toBeNull();
		expect(screen.getByRole("button", { name: "Unfold c" })).toBeTruthy();
	});

	test("OKF: a folder name opens its index.md and index rows are hidden (except at root)", () => {
		const onSelect = vi.fn();
		render(createElement(Sidebar, props(true, onSelect)));
		expect(document.querySelector('[data-path="a/index.md"]')).toBeNull();
		expect(document.querySelector('[data-path="a/b/index.md"]')).toBeNull();
		// The hidden index doesn't count either.
		expect(frow("b").querySelector(".n")?.textContent).toBe("3");
		fireEvent.click(frow("b").querySelector(".fn") as HTMLElement);
		expect(onSelect).toHaveBeenCalledWith("a/b/index.md");
		fireEvent.click(document.querySelector(".fold-h") as HTMLElement);
		expect(onSelect).toHaveBeenCalledWith("a/index.md");
		// c has no index.md: its name folds like the chevron.
		fireEvent.click(frow("c").querySelector(".fn") as HTMLElement);
		expect(document.querySelector('[data-path="a/b/c/three.md"]')).toBeNull();
	});

	test("non-OKF: index.md rows show and a folder name folds", () => {
		const onSelect = vi.fn();
		render(createElement(Sidebar, props(false, onSelect)));
		expect(document.querySelector('[data-path="a/b/index.md"]')).toBeTruthy();
		fireEvent.click(frow("b").querySelector(".fn") as HTMLElement);
		expect(onSelect).not.toHaveBeenCalled();
		expect(document.querySelector('[data-path="a/b/two.md"]')).toBeNull();
	});
});
