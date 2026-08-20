// M4-3 b5 drag & drop: the pure guards — drop validity (folder self/subtree
// refusals, bin-accepts-all) and the moved-path computation. M4-4 b1 adds
// the collision-aware layer: targetOccupied (the server's existsSync 409
// mirrored client-side), dropAllowed (the dragover decision Sidebar wires),
// and moveDestinations (the picker's pre-filtered list). The M4-4 dogfood
// round amends M4-3's same-parent rule: a drop back on the item's own folder
// is ALLOWED (highlighted, accepted) and no-ops silently — the blocked
// cursor stranded the dragger with no peaceful exit. The HTML5 wiring in
// Sidebar.tsx is pointer-only by design (the header icons are the keyboard
// path); these are its decision functions, so the event layer stays thin.
import { describe, expect, test } from "vitest";
import type { TreeNode } from "../ui/src/api.js";
import {
	basename,
	dropAllowed,
	dropTargetValid,
	isNoOpDrop,
	moveDestinations,
	movedPath,
	parentFolder,
	targetOccupied,
} from "../ui/src/dnd.js";

const folder = (path: string) => ({ kind: "folder" as const, path });
const root = { kind: "root" as const, path: "" };
const bin = { kind: "bin" as const, path: "" };

// TreeNode builders — names mirror the server's tree (ent.name, ".md" kept).
const doc = (path: string): TreeNode => ({
	name: basename(path),
	path,
	type: "doc",
});
const dir = (path: string, children: TreeNode[] = []): TreeNode => ({
	name: basename(path),
	path,
	type: "dir",
	children,
});

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

	test("doc onto the folder it already sits in is the peaceful no-op", () => {
		// M4-4 dogfood round: allowed (highlighted, droppable) — the drop
		// handler no-ops it silently via isNoOpDrop.
		expect(
			dropTargetValid({ type: "doc", path: "notes/a.md" }, folder("notes")),
		).toBe(true);
	});

	test('root follows the same rule (folder "")', () => {
		// Already at root — an accepted no-op.
		expect(dropTargetValid({ type: "doc", path: "a.md" }, root)).toBe(true);
		expect(dropTargetValid({ type: "folder", path: "a" }, root)).toBe(true);
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

	test("a folder onto its current parent is the same peaceful no-op", () => {
		expect(dropTargetValid({ type: "folder", path: "a/b" }, folder("a"))).toBe(
			true,
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

describe("targetOccupied", () => {
	const tree = dir("", [
		doc("a.md"),
		dir("notes", [doc("notes/a.md"), dir("notes/sub"), doc("notes/b.md")]),
		dir("archive"),
	]);

	test("a doc name already taken in the folder", () => {
		expect(targetOccupied(tree, "notes", "a.md")).toBe(true);
		expect(targetOccupied(tree, "", "a.md")).toBe(true);
	});

	test("a folder name already taken — type-agnostic, like existsSync", () => {
		// The dragged name matches a DIRECTORY child: the server 409s too.
		expect(targetOccupied(tree, "notes", "sub")).toBe(true);
		expect(targetOccupied(tree, "", "notes")).toBe(true);
	});

	test("a free name — in a folder, at root, in an empty folder", () => {
		expect(targetOccupied(tree, "notes", "c.md")).toBe(false);
		expect(targetOccupied(tree, "", "zzz.md")).toBe(false);
		expect(targetOccupied(tree, "archive", "a.md")).toBe(false);
		expect(targetOccupied(tree, "notes/sub", "a.md")).toBe(false);
	});

	test("a folder off the tree is vacuously free (stale path)", () => {
		expect(targetOccupied(tree, "nope", "a.md")).toBe(false);
	});
});

describe("dropAllowed", () => {
	const tree = dir("", [
		doc("a.md"),
		dir("notes", [doc("notes/a.md")]),
		dir("archive"),
	]);

	test("an occupied destination refuses a structurally valid drop", () => {
		// notes already holds a doc named a.md — no highlight, no landing.
		expect(
			dropAllowed({ type: "doc", path: "a.md" }, folder("notes"), tree),
		).toBe(false);
	});

	test("a free destination passes", () => {
		expect(
			dropAllowed({ type: "doc", path: "a.md" }, folder("archive"), tree),
		).toBe(true);
		expect(dropAllowed({ type: "doc", path: "deep/b.md" }, root, tree)).toBe(
			true,
		);
	});

	test("root follows the same occupancy rule", () => {
		// Root already holds a.md — moving notes/a.md up would collide.
		expect(dropAllowed({ type: "doc", path: "notes/a.md" }, root, tree)).toBe(
			false,
		);
	});

	test("home is always allowed — the occupant is the dragged item itself", () => {
		// notes holds notes/a.md, but that IS the dragged doc: the drop
		// lands as a silent no-op, not a collision.
		expect(
			dropAllowed({ type: "doc", path: "notes/a.md" }, folder("notes"), tree),
		).toBe(true);
	});

	test("structural refusals still refuse (checked before occupancy)", () => {
		// A folder into its own subtree, occupied or not…
		expect(
			dropAllowed({ type: "folder", path: "notes" }, folder("notes/x"), tree),
		).toBe(false);
		// …and into itself.
		expect(
			dropAllowed({ type: "folder", path: "notes" }, folder("notes"), tree),
		).toBe(false);
	});

	test("the bin accepts everything — deletes never collide", () => {
		expect(dropAllowed({ type: "doc", path: "a.md" }, bin, tree)).toBe(true);
	});

	test("no drag in flight: nothing is a target", () => {
		expect(dropAllowed(null, folder("archive"), tree)).toBe(false);
	});
});

describe("isNoOpDrop", () => {
	test("a drop back on the item's own folder does nothing", () => {
		expect(isNoOpDrop({ type: "doc", path: "notes/a.md" }, "notes")).toBe(true);
		expect(isNoOpDrop({ type: "folder", path: "a/b" }, "a")).toBe(true);
	});

	test("a root item dropped on root does nothing", () => {
		expect(isNoOpDrop({ type: "doc", path: "a.md" }, "")).toBe(true);
	});

	test("a real move is not a no-op", () => {
		expect(isNoOpDrop({ type: "doc", path: "notes/a.md" }, "archive")).toBe(
			false,
		);
		expect(isNoOpDrop({ type: "doc", path: "notes/a.md" }, "")).toBe(false);
		expect(isNoOpDrop({ type: "folder", path: "a/b" }, "c")).toBe(false);
	});
});

describe("moveDestinations", () => {
	const tree = dir("", [
		doc("a.md"),
		dir("notes", [doc("notes/a.md"), dir("notes/sub")]),
		dir("archive"),
		dir("docs", [doc("docs/x.md")]),
	]);

	test("excludes the current parent and occupied folders", () => {
		// Moving notes/a.md: "notes" is the parent (and self-occupied);
		// nothing else holds an a.md — every other folder is offered.
		expect(moveDestinations(tree, "notes/a.md")).toEqual({
			folders: ["notes/sub", "archive", "docs"],
			rootValid: false, // root already holds a.md
		});
	});

	test("root is offerable from a subfolder when root is free", () => {
		expect(moveDestinations(tree, "docs/x.md")).toEqual({
			folders: ["notes", "notes/sub", "archive"],
			rootValid: true,
		});
	});

	test("a doc already at root has no root move (and occupied folders drop out)", () => {
		expect(moveDestinations(tree, "a.md")).toEqual({
			folders: ["notes/sub", "archive", "docs"], // notes holds a.md
			rootValid: false,
		});
	});

	test("the dead-menu state: every destination collides", () => {
		const crowded = dir("", [doc("a.md"), dir("notes", [doc("notes/a.md")])]);
		expect(moveDestinations(crowded, "notes/a.md")).toEqual({
			folders: [],
			rootValid: false,
		});
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
