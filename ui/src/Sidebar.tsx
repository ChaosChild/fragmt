import { ChevronRight } from "lucide-react";
import {
	type ReactNode,
	type PointerEvent as ReactPointerEvent,
	useMemo,
	useState,
} from "react";
import type { DeletedDoc, DocMeta, RepoMeta, TreeNode } from "./api";
import { type FileOp, RowActions } from "./Menus";
import { clampSidebarWidth } from "./sidebar-geometry";

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
}: {
	node: TreeNode;
	active: boolean;
	meta: RepoMeta | null;
	/** Set for ghost cards: clicking checks out this branch and opens the doc. */
	ghostBranch?: string;
	onSelect: (path: string) => void;
	onOpenGhost: (path: string, branch: string) => void;
}) {
	const dm: DocMeta | undefined = meta?.docs[node.path];
	const chip = meta ? chipWord(meta, node.path) : null;
	return (
		<button
			type="button"
			className={`doc-card${active ? " active" : ""}`}
			title={node.path}
			onClick={() =>
				ghostBranch ? onOpenGhost(node.path, ghostBranch) : onSelect(node.path)
			}
		>
			<span className="dc-top">
				<span className="dc-title">{node.name.replace(/\.md$/i, "")}</span>
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
 * the bin doubles as the drag-delete target. Expanding an empty bin shows
 * nothing to restore. Every Restore button sits on the same right edge;
 * restores run sequentially through App, then tree+meta refresh.
 */
function RecycleBin({
	deleted,
	onRestore,
}: {
	deleted: DeletedDoc[];
	onRestore: (items: DeletedDoc[]) => void;
}) {
	const [open, setOpen] = useState(false);
	return (
		<div className="recycle-bin">
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
	onFileOp: (op: FileOp) => void;
	onOpenGhost: (path: string, branch: string) => void;
	collapsed: Set<string>;
	toggle: (path: string) => void;
	meta: RepoMeta | null;
	/** docsRoot path → the drafts branch holding it (not in this branch's tree). */
	ghosts: Map<string, string>;
}

function renderNodes({
	nodes,
	selected,
	onSelect,
	onFileOp,
	onOpenGhost,
	collapsed,
	toggle,
	meta,
	ghosts,
}: NodesProps): ReactNode[] {
	return nodes.map((node) => {
		if (node.type === "dir") {
			const isCollapsed = collapsed.has(node.path);
			return (
				<li className="folder-group" key={node.path}>
					<div className="tree-row">
						<button
							type="button"
							className="folder-row"
							aria-expanded={!isCollapsed}
							onClick={() => toggle(node.path)}
						>
							<span className="disclosure">
								<ChevronRight aria-hidden="true" />
							</span>
							{node.name}
							<span className="count">{countDocs(node)}</span>
						</button>
						<span className="row-corner">
							<RowActions
								kind="folder"
								path={node.path}
								name={node.name}
								onFileOp={onFileOp}
							/>
						</span>
					</div>
					{!isCollapsed && (
						<ul className="folder-children">
							{renderNodes({
								nodes: node.children ?? [],
								selected,
								onSelect,
								onFileOp,
								onOpenGhost,
								collapsed,
								toggle,
								meta,
								ghosts,
							})}
						</ul>
					)}
				</li>
			);
		}
		const ghostBranch = ghosts.get(node.path);
		const ver = meta?.docs[node.path]?.version;
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
					/>
					{/* Dogfood revision of item 1: the actions sit INSIDE the card's
					    top-right corner, left of the version — no dead column beside
					    the card. Ghosts carry no actions (no doc on this branch). */}
					<span className="row-corner">
						{!ghostBranch && (
							<RowActions
								kind="doc"
								path={node.path}
								name={node.name}
								onFileOp={onFileOp}
							/>
						)}
						{ver !== undefined && <span className="dc-ver">v{ver}</span>}
					</span>
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
	onFileOp,
	meta,
	onOpenGhost,
	onRestore,
}: {
	tree: TreeNode | null;
	selected: string | null;
	onSelect: (path: string) => void;
	onFileOp: (op: FileOp) => void;
	meta: RepoMeta | null;
	/** Ghost-card click: checkout the branch, then open the doc (App). */
	onOpenGhost: (path: string, branch: string) => void;
	/** Sequential restores, then App refetches tree + meta. */
	onRestore: (items: DeletedDoc[]) => void;
}) {
	const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
	const toggle = (path: string) =>
		setCollapsed((prev) => {
			const next = new Set(prev);
			if (next.has(path)) next.delete(path);
			else next.add(path);
			return next;
		});

	const ghosts = useMemo(() => ghostMap(meta, tree), [meta, tree]);
	const merged = useMemo(
		() => (tree && ghosts.size > 0 ? withGhosts(tree, ghosts) : tree),
		[tree, ghosts],
	);

	if (!tree) return null;
	return (
		<>
			<ul className="doc-list">
				{renderNodes({
					nodes: merged?.children ?? [],
					selected,
					onSelect,
					onFileOp,
					onOpenGhost,
					collapsed,
					toggle,
					meta,
					ghosts,
				})}
			</ul>
			{meta && <RecycleBin deleted={meta.deleted} onRestore={onRestore} />}
		</>
	);
}
