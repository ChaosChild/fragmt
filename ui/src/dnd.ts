/**
 * Navbar drag & drop guards (M4-3 b5) — pure path logic, no DOM. The HTML5
 * handlers in Sidebar.tsx keep their payload in `currentDrag` (dataTransfer
 * is write-only while a drag is in flight, so dragover can't read it back)
 * and ask these before any op runs: a guarded no-op never reaches App.
 */

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
 * Whether a drop on `target` does anything. No-ops — the destination equals
 * the item's current parent — and self-moves — a folder into itself or its
 * own subtree — return false so the caller can decline the dragover (blocked
 * cursor) and stay silent on drop. The bin accepts everything.
 */
export function dropTargetValid(
	drag: DragItem | null,
	target: DropTarget,
): boolean {
	if (!drag) return false;
	if (target.kind === "bin") return true;
	const dest = target.kind === "root" ? "" : target.path;
	if (dest === parentFolder(drag.path)) return false;
	if (drag.type === "folder") {
		if (dest === drag.path) return false;
		if (dest.startsWith(`${drag.path}/`)) return false;
	}
	return true;
}
