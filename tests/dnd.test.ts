// M4-3 b5 drag & drop: the pure guards — drop validity (same-parent no-ops,
// folder self/subtree refusals, bin-accepts-all) and the moved-path
// computation. The HTML5 wiring in Sidebar.tsx is pointer-only by design
// (the header icons are the keyboard path); these are its decision
// functions, so the event layer stays thin.
import { describe, expect, test } from "vitest";
import {
	basename,
	dropTargetValid,
	movedPath,
	parentFolder,
} from "../ui/src/dnd.js";

const folder = (path: string) => ({ kind: "folder" as const, path });
const root = { kind: "root" as const, path: "" };
const bin = { kind: "bin" as const, path: "" };

describe("dropTargetValid", () => {
	test("doc into a different folder is a valid move", () => {
		expect(
			dropTargetValid({ type: "doc", path: "a.md" }, folder("notes")),
		).toBe(true);
		expect(
			dropTargetValid(
				{ type: "doc", path: "notes/a.md" },
				folder("notes/deep"),
			),
		).toBe(true);
		expect(
			dropTargetValid({ type: "doc", path: "notes/a.md" }, folder("other")),
		).toBe(true);
	});

	test("doc into the folder it already sits in is a no-op", () => {
		expect(
			dropTargetValid({ type: "doc", path: "notes/a.md" }, folder("notes")),
		).toBe(false);
	});

	test('root follows the same rule (folder "")', () => {
		// Already at root — no-op.
		expect(dropTargetValid({ type: "doc", path: "a.md" }, root)).toBe(false);
		expect(dropTargetValid({ type: "folder", path: "a" }, root)).toBe(false);
		// Nested — a real move to top level.
		expect(dropTargetValid({ type: "doc", path: "notes/a.md" }, root)).toBe(
			true,
		);
		expect(dropTargetValid({ type: "folder", path: "notes/deep" }, root)).toBe(
			true,
		);
	});

	test("a folder never drops into itself", () => {
		expect(dropTargetValid({ type: "folder", path: "a" }, folder("a"))).toBe(
			false,
		);
		expect(
			dropTargetValid(
				{ type: "folder", path: "notes/deep" },
				folder("notes/deep"),
			),
		).toBe(false);
	});

	test("a folder never drops into its own subtree", () => {
		expect(dropTargetValid({ type: "folder", path: "a" }, folder("a/b"))).toBe(
			false,
		);
		expect(
			dropTargetValid({ type: "folder", path: "a" }, folder("a/b/c")),
		).toBe(false);
	});

	test("a sibling sharing a name prefix is not the subtree", () => {
		expect(dropTargetValid({ type: "folder", path: "a" }, folder("ab"))).toBe(
			true,
		);
	});

	test("a folder into its current parent is a no-op; elsewhere is valid", () => {
		expect(dropTargetValid({ type: "folder", path: "a/b" }, folder("a"))).toBe(
			false,
		);
		expect(dropTargetValid({ type: "folder", path: "a/b" }, folder("c"))).toBe(
			true,
		);
	});

	test("the bin accepts everything", () => {
		expect(dropTargetValid({ type: "doc", path: "a.md" }, bin)).toBe(true);
		expect(dropTargetValid({ type: "doc", path: "notes/a.md" }, bin)).toBe(
			true,
		);
		expect(dropTargetValid({ type: "folder", path: "a" }, bin)).toBe(true);
		expect(dropTargetValid({ type: "folder", path: "a/b" }, bin)).toBe(true);
	});

	test("no drag in flight: nothing is a target", () => {
		expect(dropTargetValid(null, folder("notes"))).toBe(false);
		expect(dropTargetValid(null, root)).toBe(false);
		expect(dropTargetValid(null, bin)).toBe(false);
	});
});

describe("movedPath", () => {
	test("doc into a folder keeps its basename (extension and all)", () => {
		expect(movedPath("doc", "notes/a.md", "archive")).toBe("archive/a.md");
	});

	test("doc to root is the bare basename", () => {
		expect(movedPath("doc", "notes/deep/a.md", "")).toBe("a.md");
	});

	test("folder keeps its own name under the new parent", () => {
		expect(movedPath("folder", "notes/deep", "archive")).toBe("archive/deep");
	});

	test("folder to root is its bare name", () => {
		expect(movedPath("folder", "notes/deep", "")).toBe("deep");
	});
});

describe("path helpers", () => {
	test('parentFolder: "" at root, the segment above inside', () => {
		expect(parentFolder("a.md")).toBe("");
		expect(parentFolder("notes/a.md")).toBe("notes");
		expect(parentFolder("notes/deep/a.md")).toBe("notes/deep");
	});

	test("basename: the last segment, extension kept", () => {
		expect(basename("a.md")).toBe("a.md");
		expect(basename("notes/a.md")).toBe("a.md");
		expect(basename("notes/deep")).toBe("deep");
	});
});
