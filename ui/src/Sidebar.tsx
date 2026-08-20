import { ChevronRight } from "lucide-react";
import {
	type DragEvent as ReactDragEvent,
	type ReactNode,
	type PointerEvent as ReactPointerEvent,
	useEffect,
	useMemo,
	useState,
} from "react";
import type { DeletedDoc, DocMeta, RepoMeta, TreeNode } from "./api";
import { displayTitle } from "./display";
import {
	basename,
	currentDrag,
	type DragItem,
	type DropTarget,
	dropAllowed,
} from "./dnd";
import { clampSidebarWidth } from "./sidebar-geometry";

/**
 * The sidebar's drag & drop wiring (M4-3 b5), threaded as one object through
 * the tree recursion and the bin instead of six loose props. `currentDrag`
 * (dnd.ts) is the readable payload; this carries the source/target styling
 * state and routes completed drops to App's existing ops. Pointer-only by
 * design — the header's file-action icons are the keyboard path (a11y note,
 * accepted in the spec).
 */
interface SidebarDnd {
	/** The in-flight item — null when idle (dims the source row). */
	drag: DragItem | null;
	/** Highlight key of the hovered target: "folder:<path>" | "root" | "bin". */
	dropKey: string | null;
	startDrag: (item: DragItem) => void;
	endDrag: () => void;
	/** Set the highlight key (dragover) / clear it (drop, dragend). */
	hover: (key: string | null) => void;
	/** dragleave for `key`'s element — cleared only when the pointer truly left. */
	leave: (e: ReactDragEvent<HTMLElement>, key: string) => void;
	/** The dragover/drop guard for tree targets (M4-4 b1): structural
	 *  validity plus collision — an occupied destination never highlights
	 *  and never preventDefaults, so the drop can't land on it. */
	canDrop: (drag: DragItem | null, target: DropTarget) => boolean;
	/** A valid drop on a folder row, or on the list background (folder ""). */
	dropInto: (item: DragItem, folder: string) => void;
	/** A drop on the bin — App confirms and deletes. */
	dropBin: (item: DragItem) => void;
}

/**
 * The sidebar's right-edge drag handle (M4-3 b3): pointer capture carries the
 * drag, App owns the value and persists it on pointerup. Pure decoration for
 * a11y — hidden ≤768px, where the drawer override owns the width.
 */
export function SidebarResizeHandle({
	onWidth,
}: {
	/** Clamped width in px; commit=true fires only on pointerup. */
	onWidth: (width: number, commit: boolean) => void;
}) {
	const dragFrom = (e: ReactPointerEvent<HTMLDivElement>) => {
		e.preventDefault();
		e.currentTarget.setPointerCapture(e.pointerId);
	};
	const dragTo = (e: ReactPointerEvent<HTMLDivElement>, commit: boolean) => {
		if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
		const left =
			e.currentTarget.parentElement?.getBoundingClientRect().left ?? 0;
		onWidth(clampSidebarWidth(e.clientX - left), commit);
	};
	return (
		<div
			className="sidebar-resize"
			aria-hidden="true"
			onPointerDown={dragFrom}
			onPointerMove={(e) => dragTo(e, false)}
			onPointerUp={(e) => dragTo(e, true)}
			onPointerCancel={(e) =>
				e.currentTarget.releasePointerCapture(e.pointerId)
			}
		/>
	);
}

function countDocs(node: TreeNode): number {
	let n = 0;
	for (const c of node.children ?? []) {
		n += c.type === "doc" ? 1 : countDocs(c);
	}
	return n;
}

/** "today 09:42" for today, else "Aug 14" — the card/bin/doc-head date word. */
export function shortDate(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "";
	const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
	if (d.toDateString() === new Date().toDateString()) return `today ${time}`;
	return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

/**
 * The card's draft chip word (M4-2 item 2, cross-branch): on a draft, the
 * CURRENT branch's entry; on main (or no draft model), any entry. "new" for
 * additions, "draft" for edits. A deleted-status entry keeps the generic
 * "draft" word — the doc is only absent on that branch, never here on main.
 */
function chipWord(meta: RepoMeta, path: string): string | null {
	const entries = meta.drafts[path];
	if (!entries?.length) return null;
	const entry =
		meta.main && meta.current !== meta.main
			? entries.find((e) => e.branch === meta.current)
			: entries[0];
	if (!entry) return null;
	return entry.status === "new" ? "new" : "draft";
}

/** One inbox card — ghost docs (draft-only, not in this branch's tree) reuse it. */
function DocCard({
	node,
	active,
	meta,
	ghostBranch,
	onSelect,
	onOpenGhost,
	dnd,
}: {
	node: TreeNode;
	active: boolean;
	meta: RepoMeta | null;
	/** Set for ghost cards: clicking checks out this branch and opens the doc. */
	ghostBranch?: string;
	onSelect: (path: string) => void;
	onOpenGhost: (path: string, branch: string) => void;
	/** Drag source wiring (M4-3 b5) — ghosts don't drag: their path doesn't
	 *  exist on this branch, so a move would miss server-side. */
	dnd: SidebarDnd;
}) {
	const dm: DocMeta | undefined = meta?.docs[node.path];
	const chip = meta ? chipWord(meta, node.path) : null;
	const dragging = dnd.drag?.type === "doc" && dnd.drag.path === node.path;
	// M4-3 b4: indicators sit inline right after the name — nothing is
	// right-aligned on the row, so overflow can never hide them.
	return (
		<button
			type="button"
			className={`doc-card${active ? " active" : ""}${dragging ? " dragging" : ""}`}
			title={node.path}
			draggable={!ghostBranch}
			onDragStart={(e) => {
				if (ghostBranch) return;
				// Firefox won't start a drag without payload data; the readable
				// copy lives in currentDrag (dataTransfer is write-only mid-drag).
				e.dataTransfer.effectAllowed = "move";
				e.dataTransfer.setData("text/plain", node.path);
				dnd.startDrag({ type: "doc", path: node.path });
			}}
			onDragEnd={dnd.endDrag}
			onClick={() =>
				ghostBranch ? onOpenGhost(node.path, ghostBranch) : onSelect(node.path)
			}
		>
			<span className="dc-top">
				<span className="dc-title">{displayTitle(dm?.title, node.name)}</span>
				{dm?.version !== undefined && (
					<span className="dc-ver">v{dm.version}</span>
				)}
			</span>
			{(dm || chip) && (
				<span className="dc-meta">
					{dm && `${dm.author} · ${shortDate(dm.date)}`}
					{chip && <span className="dc-draft">{chip}</span>}
				</span>
			)}
			{dm?.snippet && <span className="dc-snippet">{dm.snippet}</span>}
		</button>
	);
}

/**
 * The recycle bin (item 9, amended M4-3 b3): a collapsed "Deleted (N)"
 * disclosure pinned at the sidebar bottom — always mounted, even at 0, since
 * the bin doubles as the drag-delete target (M4-3 b5: the whole block is a
 * drop target; it accepts everything, no validity guard). Expanding an empty
 * bin shows nothing to restore. Every Restore button sits on the same right
 * edge; restores run sequentially through App, then tree+meta refresh.
 */
function RecycleBin({
	deleted,
	onRestore,
	dnd,
}: {
	deleted: DeletedDoc[];
	onRestore: (items: DeletedDoc[]) => void;
	/** Drop-target wiring — dragover highlights with danger styling. */
	dnd: SidebarDnd;
}) {
	const [open, setOpen] = useState(false);
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: pointer-only drop target by design (M4-3 b5) — the header's file-action icons are the keyboard path.
		<div
			className={`recycle-bin${dnd.dropKey === "bin" ? " drop-target" : ""}`}
			onDragOver={(e) => {
				if (!currentDrag.item) return;
				e.preventDefault();
				e.dataTransfer.dropEffect = "move";
				dnd.hover("bin");
			}}
			onDragLeave={(e) => dnd.leave(e, "bin")}
			onDrop={(e) => {
				const item = currentDrag.item;
				if (!item) return;
				e.preventDefault();
				dnd.hover(null);
				dnd.dropBin(item);
			}}
		>
			<button
				type="button"
				className="folder-row"
				aria-expanded={open}
				onClick={() => setOpen((o) => !o)}
			>
				<span className="disclosure">
					<ChevronRight aria-hidden="true" />
				</span>
				Deleted
				<span className="count">{deleted.length}</span>
			</button>
			{open && deleted.length > 0 && (
				<ul className="bin-list">
					{deleted.map((d) => (
						<li className="bin-row" key={d.path}>
							<span className="bin-path" title={d.path}>
								{d.path}
							</span>
							<span className="bin-date">{shortDate(d.date)}</span>
							<button
								type="button"
								className="bin-restore"
								onClick={() => onRestore([d])}
							>
								Restore
							</button>
						</li>
					))}
					<li className="bin-all">
						<button
							type="button"
							className="bin-restore"
							onClick={() => onRestore(deleted)}
						>
							Restore all
						</button>
					</li>
				</ul>
			)}
		</div>
	);
}

interface NodesProps {
	nodes: TreeNode[];
	selected: string | null;
	onSelect: (path: string) => void;
	onOpenGhost: (path: string, branch: string) => void;
	collapsed: Set<string>;
	toggle: (path: string) => void;
	meta: RepoMeta | null;
	/** docsRoot path → the drafts branch holding it (not in this branch's tree). */
	ghosts: Map<string, string>;
	/** Drag & drop wiring (M4-3 b5), threaded to every row. */
	dnd: SidebarDnd;
}

function renderNodes({
	nodes,
	selected,
	onSelect,
	onOpenGhost,
	collapsed,
	toggle,
	meta,
	ghosts,
	dnd,
}: NodesProps): ReactNode[] {
	return nodes.map((node) => {
		if (node.type === "dir") {
			const isCollapsed = collapsed.has(node.path);
			// Highlight key + validity share one guard: an invalid target never
			// preventDefaults its dragover, so the browser shows the blocked
			// cursor and no drop can land on it.
			const key = `folder:${node.path}`;
			const validHere = () =>
				dnd.canDrop(currentDrag.item, {
					kind: "folder",
					path: node.path,
				});
			return (
				<li className="folder-group" key={node.path}>
					<div className="tree-row">
						<button
							type="button"
							className={`folder-row${dnd.dropKey === key ? " drop-target" : ""}${
								dnd.drag?.type === "folder" && dnd.drag.path === node.path
									? " dragging"
									: ""
							}`}
							aria-expanded={!isCollapsed}
							draggable
							onClick={() => toggle(node.path)}
							onDragStart={(e) => {
								e.dataTransfer.effectAllowed = "move";
								e.dataTransfer.setData("text/plain", node.path);
								dnd.startDrag({ type: "folder", path: node.path });
							}}
							onDragEnd={dnd.endDrag}
							onDragOver={(e) => {
								// The row is its own target — a hover here must never
								// fall through to the list background (root) behind it,
								// valid or not.
								e.stopPropagation();
								if (!validHere()) return;
								e.preventDefault();
								e.dataTransfer.dropEffect = "move";
								dnd.hover(key);
							}}
							onDragLeave={(e) => dnd.leave(e, key)}
							onDrop={(e) => {
								e.stopPropagation();
								const item = currentDrag.item;
								if (!item || !validHere()) return;
								e.preventDefault();
								dnd.hover(null);
								dnd.dropInto(item, node.path);
							}}
						>
							<span className="disclosure">
								<ChevronRight aria-hidden="true" />
							</span>
							{node.name}
							<span className="count">{countDocs(node)}</span>
						</button>
					</div>
					{!isCollapsed && (
						<ul className="folder-children">
							{renderNodes({
								nodes: node.children ?? [],
								selected,
								onSelect,
								onOpenGhost,
								collapsed,
								toggle,
								meta,
								ghosts,
								dnd,
							})}
						</ul>
					)}
				</li>
			);
		}
		const ghostBranch = ghosts.get(node.path);
		return (
			<li key={node.path}>
				<div className="tree-row">
					<DocCard
						node={node}
						active={node.path === selected}
						meta={meta}
						ghostBranch={ghostBranch}
						onSelect={onSelect}
						onOpenGhost={onOpenGhost}
						dnd={dnd}
					/>
				</div>
			</li>
		);
	});
}

/** Draft-only docs ("new" not in the current tree) → path → holding branch. */
function ghostMap(meta: RepoMeta | null, tree: TreeNode | null) {
	const map = new Map<string, string>();
	if (!meta || !tree) return map;
	const inTree = new Set<string>();
	const walk = (n: TreeNode) => {
		for (const c of n.children ?? []) {
			if (c.type === "doc") inTree.add(c.path);
			else walk(c);
		}
	};
	walk(tree);
	for (const [path, entries] of Object.entries(meta.drafts)) {
		if (inTree.has(path)) continue;
		const added = entries.find((e) => e.status === "new");
		if (added) map.set(path, added.branch);
	}
	return map;
}

/** Insert ghost docs into a throwaway tree copy — folders materialize to hold them. */
function withGhosts(tree: TreeNode, ghosts: Map<string, string>): TreeNode {
	const root = structuredClone(tree);
	if (!root.children) root.children = [];
	let children = root.children;
	for (const path of ghosts.keys()) {
		const segs = path.split("/");
		for (let i = 0; i < segs.length - 1; i++) {
			const dirPath = segs.slice(0, i + 1).join("/");
			let dir = children.find((c) => c.type === "dir" && c.path === dirPath);
			if (!dir) {
				dir = { name: segs[i], path: dirPath, type: "dir", children: [] };
				children.push(dir);
			}
			if (!dir.children) dir.children = [];
			children = dir.children;
		}
		children.push({ name: segs[segs.length - 1], path, type: "doc" });
	}
	return root;
}

export function Sidebar({
	tree,
	selected,
	onSelect,
	meta,
	expandFolder,
	onOpenGhost,
	onRestore,
	onDropItem,
	onDropBin,
}: {
	tree: TreeNode | null;
	selected: string | null;
	onSelect: (path: string) => void;
	meta: RepoMeta | null;
	/** A folder-link click's expand request (M4-3 b6): the path's ancestors
	 *  and the folder itself leave the collapsed set — App bumps `n` so a
	 *  repeat click on the same folder re-arms the effect. */
	expandFolder: { path: string; n: number } | null;
	/** Ghost-card click: checkout the branch, then open the doc (App). */
	onOpenGhost: (path: string, branch: string) => void;
	/** Sequential restores, then App refetches tree + meta. */
	onRestore: (items: DeletedDoc[]) => void;
	/** A valid drop landed (M4-3 b5): move `item` into `folder` ("" = the list
	 *  background = docsRoot root) — App guards and runs the existing ops. */
	onDropItem: (item: DragItem, folder: string) => void;
	/** A drop on the bin — App confirms and deletes (doc or folder). */
	onDropBin: (item: DragItem, name: string) => void;
}) {
	const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
	const toggle = (path: string) =>
		setCollapsed((prev) => {
			const next = new Set(prev);
			if (next.has(path)) next.delete(path);
			else next.add(path);
			return next;
		});

	// Folder-link expansion (M4-3 b6): expand = remove from the collapsed
	// set. Every ancestor prefix leaves too, so the target is reachable.
	useEffect(() => {
		if (!expandFolder) return;
		setCollapsed((prev) => {
			if (prev.size === 0) return prev; // nothing collapsed — already open
			const next = new Set(prev);
			const segs = expandFolder.path.split("/");
			for (let i = 1; i <= segs.length; i++)
				next.delete(segs.slice(0, i).join("/"));
			return next;
		});
	}, [expandFolder]);

	// Drag & drop state (M4-3 b5): `drag` dims the source row, `dropKey`
	// highlights the hovered target. The payload itself lives in currentDrag
	// (dnd.ts) — readable during dragover, cleared by the source's dragend.
	const [drag, setDrag] = useState<DragItem | null>(null);
	const [dropKey, setDropKey] = useState<string | null>(null);
	// The confirm's display name for a bin drop: the title model for docs,
	// the folder's own name for folders.
	const labelFor = (item: DragItem): string =>
		item.type === "doc"
			? displayTitle(meta?.docs[item.path]?.title, basename(item.path))
			: basename(item.path);
	const dnd: SidebarDnd = {
		drag,
		dropKey,
		startDrag: (item) => {
			currentDrag.item = item;
			setDrag(item);
		},
		endDrag: () => {
			currentDrag.item = null;
			setDrag(null);
			setDropKey(null);
		},
		hover: setDropKey,
		leave: (e, key) => {
			// dragleave also fires when the pointer crosses into a child
			// element — keep the highlight then; clear only this row's key.
			const into = e.relatedTarget;
			if (into instanceof Node && e.currentTarget.contains(into)) return;
			setDropKey((k) => (k === key ? null : k));
		},
		dropInto: (item, folder) => onDropItem(item, folder),
		dropBin: (item) => onDropBin(item, labelFor(item)),
		// Collision-aware (M4-4 b1): checked against the real tree, not the
		// ghost-merged one — draft-only docs sit on other branches, so they
		// can't collide with anything on disk here.
		canDrop: (drag, target) => tree !== null && dropAllowed(drag, target, tree),
	};

	const ghosts = useMemo(() => ghostMap(meta, tree), [meta, tree]);
	const merged = useMemo(
		() => (tree && ghosts.size > 0 ? withGhosts(tree, ghosts) : tree),
		[tree, ghosts],
	);

	if (!tree) return null;
	return (
		<>
			{/* The list's own background/padding is the "/" (docsRoot root)
			    target (M4-3 b5): folder rows stop their dragovers so row drops
			    never double-fire as root drops; doc rows bubble — a drop on a
			    card that isn't a folder target lands at root. */}
			<ul
				className={`doc-list${dropKey === "root" ? " drop-root" : ""}`}
				onDragOver={(e) => {
					if (!dnd.canDrop(currentDrag.item, { kind: "root", path: "" }))
						return;
					e.preventDefault();
					e.dataTransfer.dropEffect = "move";
					setDropKey("root");
				}}
				onDragLeave={(e) => dnd.leave(e, "root")}
				onDrop={(e) => {
					const item = currentDrag.item;
					if (!item || !dnd.canDrop(item, { kind: "root", path: "" })) return;
					e.preventDefault();
					setDropKey(null);
					onDropItem(item, "");
				}}
			>
				{renderNodes({
					nodes: merged?.children ?? [],
					selected,
					onSelect,
					onOpenGhost,
					collapsed,
					toggle,
					meta,
					ghosts,
					dnd,
				})}
			</ul>
			{meta && (
				<RecycleBin deleted={meta.deleted} onRestore={onRestore} dnd={dnd} />
			)}
		</>
	);
}
