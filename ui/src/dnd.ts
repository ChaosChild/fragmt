/**
 * Navbar drag & drop guards (M4-3 b5) — pure path logic, no DOM. The HTML5
 * handlers in Sidebar.tsx keep their payload in `currentDrag` (dataTransfer
 * is write-only while a drag is in flight, so dragover can't read it back)
 * and ask these before any op runs: a guarded no-op never reaches App.
 */
import type { TreeNode } from "./api.js";

/** What a row is dragging: its tree type plus its docsRoot-relative path. */
export interface DragItem {
	type: "doc" | "folder";
	path: string;
}

/** Where the pointer is: a folder row, the list background (root), or the bin. */
export interface DropTarget {
	kind: "folder" | "root" | "bin";
	/** The target folder's path — "" for the root and bin kinds. */
	path: string;
}

/** The in-flight drag — module-level (one drag at a time per page), set on
 *  dragstart and cleared on dragend. Null when idle, so external drags
 *  (text, files from outside) light up no target. */
export const currentDrag: { item: DragItem | null } = { item: null };

/** The folder containing `path` — "" for docsRoot-rooted paths. */
export function parentFolder(path: string): string {
	const i = path.lastIndexOf("/");
	return i === -1 ? "" : path.slice(0, i);
}

/** The last path segment — for a folder it keeps the folder's own name. */
export function basename(path: string): string {
	return path.slice(path.lastIndexOf("/") + 1);
}

/** The destination a drop into `folder` ("" = docsRoot root) produces —
 *  docs and folders alike keep their basename under the new parent. */
export function movedPath(
	_type: "doc" | "folder",
	path: string,
	folder: string,
): string {
	return folder ? `${folder}/${basename(path)}` : basename(path);
}

/**
 * Whether a drop on `target` is structurally sound. Self-moves — a folder
 * into itself or its own subtree — return false so the caller can decline
 * the dragover (blocked cursor) and stay silent on drop. The bin accepts
 * everything. A drop back on the item's own parent is VALID here: it's the
 * natural "put it back" gesture, and the drop handler no-ops it silently
 * (M4-4 dogfood round — the M4-3 blocked-cursor rule stranded the dragger).
 */
export function dropTargetValid(
	drag: DragItem | null,
	target: DropTarget,
): boolean {
	if (!drag) return false;
	if (target.kind === "bin") return true;
	const dest = target.kind === "root" ? "" : target.path;
	if (drag.type === "folder") {
		if (dest === drag.path) return false;
		if (dest.startsWith(`${drag.path}/`)) return false;
	}
	return true;
}

// --- M4-4 b1: collision-aware targets (the tree is already client-side) ---

/** The tree node for a folder path ("" = the root itself). */
function folderNode(node: TreeNode, path: string): TreeNode | null {
	if (!path) return node;
	for (const c of node.children ?? []) {
		if (c.type !== "dir") continue;
		if (c.path === path) return c;
		const found = folderNode(c, path);
		if (found) return found;
	}
	return null;
}

/**
 * Whether `folder` ("" = root) already holds a child — dir or doc — named
 * `name`. Type-agnostic, matching the server's existsSync 409
 * (src/core/files.ts): a doc named like a folder collides too.
 */
export function targetOccupied(
	tree: TreeNode,
	folder: string,
	name: string,
): boolean {
	const dir = folderNode(tree, folder);
	return (dir?.children ?? []).some((c) => c.name === name);
}

/**
 * The dragover guard Sidebar actually asks (M4-4 b1 + dogfood round):
 * structural validity (dropTargetValid), then the destination not already
 * holding a DIFFERENT child named like the dragged item — an occupied target
 * never highlights and never preventDefaults, so the browser shows the
 * blocked cursor and the drop can't land. The item's own parent is always
 * allowed: the "occupant" there is the dragged item itself, and the drop is
 * a silent no-op (isNoOpDrop) — the peaceful way out of a drag. The bin
 * still accepts everything (deletes never collide).
 */
export function dropAllowed(
	drag: DragItem | null,
	target: DropTarget,
	tree: TreeNode,
): boolean {
	if (!dropTargetValid(drag, target)) return false;
	if (target.kind === "bin") return true;
	const dest = target.kind === "root" ? "" : target.path;
	if (drag !== null && dest === parentFolder(drag.path)) return true;
	return drag !== null && !targetOccupied(tree, dest, basename(drag.path));
}

/** A drop that would "move" the item where it already lives — do nothing. */
export function isNoOpDrop(item: DragItem, folder: string): boolean {
	return movedPath(item.type, item.path, folder) === item.path;
}

/**
 * The move picker's destinations for `path` (M4-4 b1): every tree folder
 * except the current parent (a guaranteed "already exists" 409) and every
 * folder where targetOccupied — plus whether root ("") is offerable (only
 * from a subfolder, and only unoccupied). The server 409 stays the source
 * of truth for trees gone stale mid-flight.
 */
export function moveDestinations(
	tree: TreeNode,
	path: string,
): { folders: string[]; rootValid: boolean } {
	const parent = parentFolder(path);
	const name = basename(path);
	// ponytail: O(folders × nodes) — each folder re-searched via
	// targetOccupied rather than one fused walk; fuse it if a tree ever
	// reaches thousands of folders.
	const folders = folderPaths(tree).filter(
		(f) => f !== parent && !targetOccupied(tree, f, name),
	);
	return {
		folders,
		rootValid: parent !== "" && !targetOccupied(tree, "", name),
	};
}

/** Every folder path in the tree, parent-first. */
function folderPaths(node: TreeNode): string[] {
	const out: string[] = [];
	for (const c of node.children ?? []) {
		if (c.type === "dir") {
			out.push(c.path);
			out.push(...folderPaths(c));
		}
	}
	return out;
}
