import {
	type CSSProperties,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	type CommentFile,
	type CommentThread,
	checkoutBranch,
	createBranch,
	createDoc,
	createFolder,
	type DeletedDoc,
	type DocResponse,
	deleteBranch,
	deleteComment,
	deleteDoc,
	deleteFolder,
	getBranches,
	getComments,
	getDoc,
	getMeta,
	getTree,
	mergeDraft,
	moveDoc,
	patchComment,
	type RepoMeta,
	renameFolder,
	restoreDoc,
	SaveError,
	startDraft,
	sync,
	type TreeNode,
} from "./api";
import { CommentsRail } from "./CommentsRail";
import { DocView } from "./DocView";
import { displayTitle } from "./display";
import { type DragItem, movedPath } from "./dnd";
import type { AtDoc } from "./editor/at";
import {
	type BranchAction,
	BranchMenu,
	type FileOp,
	NewDocButton,
} from "./Menus";
import { Sidebar, SidebarResizeHandle } from "./Sidebar";
import { readStoredSidebarWidth, storeSidebarWidth } from "./sidebar-geometry";

function firstDoc(node: TreeNode): string | null {
	for (const child of node.children ?? []) {
		if (child.type === "doc") return child.path;
		const found = firstDoc(child);
		if (found) return found;
	}
	return null;
}

function treeHas(node: TreeNode, path: string): boolean {
	if (!path) return false;
	return (node.children ?? []).some((c) => c.path === path || treeHas(c, path));
}

/** The tree node for a folder path (docsRoot-relative), or null. */
function findDir(node: TreeNode, path: string): TreeNode | null {
	if (!path) return null;
	for (const c of node.children ?? []) {
		if (c.type !== "dir") continue;
		if (c.path === path) return c;
		const found = findDir(c, path);
		if (found) return found;
	}
	return null;
}

/** The tree's docs as {title, path} — the @ menus' items and linkify's set.
 *  Titles come from meta (the display-name model, M4-3 b4); paths stay the
 *  identity and the link hrefs. */
function docItems(node: TreeNode | null, meta: RepoMeta | null): AtDoc[] {
	const out: AtDoc[] = [];
	const walk = (n: TreeNode) => {
		for (const c of n.children ?? []) {
			if (c.type === "doc")
				out.push({
					title: displayTitle(meta?.docs[c.path]?.title, c.name),
					path: c.path,
				});
			else walk(c);
		}
	};
	if (node) walk(node);
	return out;
}

/** Every folder path in the tree — the header move picker's list (M4-3 b4). */
function folderPaths(node: TreeNode | null): string[] {
	const out: string[] = [];
	const walk = (n: TreeNode) => {
		for (const c of n.children ?? []) {
			if (c.type === "dir") {
				out.push(c.path);
				walk(c);
			}
		}
	};
	if (node) walk(node);
	return out;
}

export function App() {
	const [tree, setTree] = useState<TreeNode | null>(null);
	const [selected, setSelected] = useState<string | null>(null);
	const [doc, setDoc] = useState<DocResponse | null>(null);
	const [error, setError] = useState<string | null>(null);

	// M3: branches, sync, file ops.
	const [branch, setBranch] = useState<string | null>(null);
	const [dirty, setDirty] = useState(false);
	// The save-or-discard guard's payload (M3, generalized M4-3 b4): any
	// action blocked on the choice — a branch switch, a header move/delete.
	// DocView renders the banner; `go` runs after Save/Discard and clears.
	const [pendingAction, setPendingAction] = useState<{
		headline: string;
		go: () => void;
	} | null>(null);
	const [syncing, setSyncing] = useState(false);
	const [conflict, setConflict] = useState<string | null>(null);
	const [ledRed, setLedRed] = useState(false);
	// M4-3 b3: drag-resized sidebar width — applied as --sidebar-w on the
	// .sidebar element itself (not :root), so the ≤768px drawer override
	// keeps owning the width there. Persisted on pointerup only.
	const [sidebarW, setSidebarW] = useState<number | null>(() =>
		readStoredSidebarWidth(),
	);
	const applySidebarW = (width: number, commit: boolean) => {
		setSidebarW(width);
		if (commit) storeSidebarWidth(width);
	};
	// M4-2: repo meta (cards, drafts, recycle bin). Refetched on load, branch
	// switches, file ops, and saves — a failure is quiet (the UI falls back to
	// version-less cards).
	const [meta, setMeta] = useState<RepoMeta | null>(null);
	const refreshMeta = useCallback(() => {
		getMeta()
			.then(setMeta)
			.catch(() => {});
	}, []);
	// Whether a sync has confirmed the latest local commit — splits the
	// amber word: Saved (committed, not yet synced) vs Synced (green).
	const [synced, setSynced] = useState(true);

	// --- comments (M4-5): App owns the sidecar state — the rail, the doc-bar
	// badge, and DocView's create-notification all read from this one fetch;
	// every mutation re-runs it through refreshComments.
	const [commentFile, setCommentFile] = useState<CommentFile>({
		comments: {},
	});
	const [railOpen, setRailOpen] = useState(false);
	const [railError, setRailError] = useState<string | null>(null);
	// Doc→rail jump target; `n` re-arms repeated clicks on the same span.
	const [spanFocus, setSpanFocus] = useState<{ id: string; n: number } | null>(
		null,
	);
	// M4-3 b6 link completion: a cross-doc #fragment waiting for the new doc
	// to render (EditorPane scrolls + consumes it), and a folder link's
	// expand request (the sidebar owns its collapsed set; `n` re-arms repeats).
	const [pendingAnchor, setPendingAnchor] = useState<string | null>(null);
	const clearAnchor = useCallback(() => setPendingAnchor(null), []);
	const [expandFolder, setExpandFolder] = useState<{
		path: string;
		n: number;
	} | null>(null);

	// Latest selected/dirty for the stable interval/focus sync callback.
	const live = useRef({ selected, dirty });
	live.current = { selected, dirty };

	useEffect(() => {
		getTree()
			.then(setTree)
			.catch((e: unknown) =>
				setError(e instanceof Error ? e.message : String(e)),
			);
		getBranches()
			.then((r) => setBranch(r.current))
			.catch(() => {});
		refreshMeta();
	}, [refreshMeta]);

	// Auto-select the first doc once the tree lands.
	useEffect(() => {
		if (tree && !selected) {
			const found = firstDoc(tree);
			if (found) setSelected(found);
		}
	}, [tree, selected]);

	// Load the selected doc.
	useEffect(() => {
		if (!selected) {
			setDoc(null);
			return;
		}
		setDoc(null);
		getDoc(selected)
			.then(setDoc)
			.catch((e: unknown) =>
				setError(e instanceof Error ? e.message : String(e)),
			);
	}, [selected]);

	// Refetch after a discarded/stale buffer (the 409 reload path).
	const reloadSelected = () => {
		if (!selected) return;
		getDoc(selected)
			.then(setDoc)
			.catch((e: unknown) =>
				setError(e instanceof Error ? e.message : String(e)),
			);
	};

	// The sidecar fetch on doc open. A failure is quiet (the rail shows empty;
	// the next action retries).
	useEffect(() => {
		setRailError(null);
		if (!selected) {
			setCommentFile({ comments: {} });
			return;
		}
		let cancelled = false;
		getComments(selected)
			.then((file) => {
				if (!cancelled) setCommentFile(file);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [selected]);

	// Post-mutation refetch — reads the live selection through the same ref
	// the sync callback uses (mutations can't race a doc switch mid-await).
	const refreshComments = () => {
		const path = live.current.selected;
		if (!path) return;
		getComments(path)
			.then(setCommentFile)
			.catch(() => {});
	};

	const threads: CommentThread[] = Object.values(commentFile.comments);
	// The flat doc list (M4-2): one source for the editor's @ menu, its link
	// clicks, the rail's reply @ mentions, and body linkification. Titles
	// ride along from meta (M4-3 b4) — paths stay the identity.
	const docs = useMemo(() => docItems(tree, meta), [tree, meta]);
	// The header move picker's folder list (M4-3 b4).
	const folders = useMemo(() => folderPaths(tree), [tree]);
	// The orphan rule, client-side: core's reconcileThreads check replicated
	// against the RENDERED doc's markdown (doc.markdown is the exact string
	// the editor renders from and is refreshed on every save). Smaller than
	// enumerating live ids through the editor's state. While the doc is still
	// loading, assume live — no orphan flash on mount. Edits that delete a
	// span show as live until the next save, the spec's accepted degradation.
	const liveIds = new Set(
		doc
			? threads
					.filter((t) => doc.markdown.includes(`data-c="${t.id}"`))
					.map((t) => t.id)
			: threads.map((t) => t.id),
	);

	async function railReply(id: string, body: string): Promise<boolean> {
		if (!selected) return false;
		try {
			await patchComment(selected, id, { reply: body });
		} catch (e) {
			setRailError(e instanceof Error ? e.message : String(e));
			return false;
		}
		setRailError(null);
		refreshComments();
		return true;
	}

	// Resolve/reopen — both directions hit the same sidecar-only PATCH.
	async function railResolve(id: string, resolved: boolean) {
		if (!selected) return;
		try {
			await patchComment(selected, id, { resolved });
		} catch (e) {
			setRailError(e instanceof Error ? e.message : String(e));
			return;
		}
		setRailError(null);
		refreshComments();
	}

	// Delete with a CLEAN buffer uses the combined endpoint: the span and the
	// sidecar entry go in ONE commit, and the doc refetch picks up the stripped
	// body immediately. A dirty buffer can't send the doc (its base hash is
	// stale by definition) → sidecar-only, the span leaves on the next save,
	// and no refetch (it would drop unsaved edits).
	async function railDelete(id: string) {
		if (!selected) return;
		if (!window.confirm("Delete this comment thread?")) return;
		try {
			await deleteComment(
				selected,
				id,
				live.current.dirty ? undefined : (doc?.hash ?? undefined),
			);
		} catch (e) {
			setRailError(e instanceof Error ? e.message : String(e));
			return;
		}
		setRailError(null);
		refreshComments();
		if (!live.current.dirty) reloadSelected();
	}

	// --- sync (M3): ~60s interval, window focus; edit-entry fires from
	// DocView. A conflict turns the LED red + the doc-pane banner; network
	// failure turns the LED red quietly — prior state always survives.
	const runSync = useCallback(async () => {
		setSyncing(true);
		try {
			const result = await sync();
			if (result.conflict) {
				setConflict(result.message ?? "sync conflict");
				setLedRed(true);
				return;
			}
			setConflict(null);
			setLedRed(false);
			setSynced(true);
			try {
				setTree(await getTree());
			} catch {
				// keep prior tree
			}
			const s = live.current.selected;
			if (s && !live.current.dirty) {
				try {
					const next = await getDoc(s);
					if (!live.current.dirty) setDoc(next);
				} catch {
					// keep prior doc
				}
			}
		} catch {
			setLedRed(true);
		} finally {
			setSyncing(false);
		}
	}, []);

	useEffect(() => {
		const id = setInterval(() => void runSync(), 60_000);
		const onFocus = () => void runSync();
		window.addEventListener("focus", onFocus);
		return () => {
			clearInterval(id);
			window.removeEventListener("focus", onFocus);
		};
	}, [runSync]);

	// --- branches: switching reloads tree + open doc from the new branch.
	async function switchTo(action: BranchAction) {
		try {
			if (action.kind === "create") await createBranch(action.name);
			else await checkoutBranch(action.name);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
			return;
		}
		setError(null);
		setBranch(action.name);
		refreshMeta();
		try {
			const t = await getTree();
			setTree(t);
			const s = live.current.selected;
			if (s && treeHas(t, s)) setDoc(await getDoc(s));
			else setSelected(firstDoc(t));
		} catch {
			// keep prior state — quiet
		}
	}

	// The save-or-discard guard (M3, generalized M4-3 b4): unsaved edits
	// block the action with the banner (DocView), never a silent loss. The
	// header file actions route through the same gate.
	function guardAction(headline: string, run: () => void) {
		if (live.current.dirty) {
			setPendingAction({
				headline,
				go: () => {
					setPendingAction(null);
					run();
				},
			});
			return;
		}
		run();
	}

	// Branch switches pass through the guard; deletion skips it — it never
	// touches the worktree or the checked-out branch.
	function requestBranch(action: BranchAction) {
		if (action.kind === "delete") {
			void runDeleteBranch(action.name);
			return;
		}
		guardAction(`Switch to ${action.name}`, () => void switchTo(action));
	}

	// Branch deletion (M4-3): confirm → DELETE; an unmerged 409 asks again
	// before the force delete. The server refuses the current branch, so the
	// worktree is never touched — no dirty guard. BranchMenu refetches its
	// list on open; meta and the branch line refresh here.
	async function runDeleteBranch(name: string) {
		if (!window.confirm(`Delete branch "${name}"?`)) return;
		try {
			await deleteBranch(name);
		} catch (e) {
			if (e instanceof SaveError && e.status === 409) {
				if (!window.confirm(`"${name}" has unmerged commits. Force-delete?`))
					return;
				try {
					await deleteBranch(name, true);
				} catch (e2) {
					setError(e2 instanceof Error ? e2.message : String(e2));
					return;
				}
			} else {
				setError(e instanceof Error ? e.message : String(e));
				return;
			}
		}
		setError(null);
		refreshMeta();
		getBranches()
			.then((r) => setBranch(r.current))
			.catch(() => {});
	}

	// --- M4-2: protected main (item 7) --------------------------------------
	// The draft model applies whenever meta names a main and we're on it.
	const onMain = Boolean(meta?.main && branch === meta.main);

	// The one draft-starting seam Edit and read-mode comments share on main.
	// No prompt — the header's branch line names the new branch. startDraft
	// checks the draft out server-side; switchTo's checkout of the branch we
	// already sit on is a no-op that reuses the whole refresh (branch, meta,
	// tree, doc). False (after the error banner) = don't proceed.
	async function draftFirst(): Promise<boolean> {
		const path = live.current.selected;
		if (!path) return false;
		try {
			const { current } = await startDraft(path);
			await switchTo({ kind: "switch", name: current });
			return true;
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
			return false;
		}
	}

	// The Edit gate: on main, draft before the mode flip — DocView awaits
	// this and only flips on true (it stays dumb: no error handling of its
	// own). Off main, the pre-edit sync runs as before; a fresh draft skips
	// it — the checkout just made us current.
	async function beforeEdit(): Promise<boolean> {
		if (!onMain) {
			void runSync();
			return true;
		}
		return draftFirst();
	}

	// The pre-rename gate (M4-3 b4): the title write is a doc-body write, so
	// on main the draft starts (and checks out) first — the doc path never
	// changes, so the flow continues on the draft branch. DocView handles
	// the dirty half with its own banner (the box opens after the choice).
	async function beforeRename(): Promise<boolean> {
		if (!onMain) return true;
		return draftFirst();
	}

	// --- header file actions (M4-3 b4): rename/move/delete on the open doc.

	// A title landed: the frontmatter changed, so the doc reloads and meta
	// (sidebar cards, @ menu labels) refreshes. A local commit — the LED
	// reads Saved, not Synced.
	function onRenamed() {
		setSynced(false);
		reloadSelected();
		refreshMeta();
	}

	// Move any doc (the header picker or a drag, M4-3 b5) into a tree folder
	// ("" = docsRoot root): the guard first, then the existing move op —
	// tree + meta refresh and selection follows the new path (runFileOp's
	// flow).
	function moveDocTo(from: string, folder: string) {
		guardAction(
			`Move to ${folder || "/ (root)"}`,
			() =>
				void runFileOp({
					kind: "move-doc",
					from,
					to: movedPath("doc", from, folder),
				}),
		);
	}

	function requestMoveDoc(folder: string) {
		const from = live.current.selected;
		if (!from) return;
		moveDocTo(from, folder);
	}

	// A folder move arrives only by drag (M4-3 b5 — the header actions are
	// per-doc): the guard, then renameFolder keeping the basename. runFileOp's
	// move-folder branch moves the open doc's selection along with the subtree.
	function requestMoveFolder(from: string, folder: string) {
		guardAction(
			`Move folder to ${folder || "/ (root)"}`,
			() =>
				void runFileOp({
					kind: "move-folder",
					from,
					to: movedPath("folder", from, folder),
				}),
		);
	}

	// Delete: the guard first, then the house confirm, then the existing
	// delete op — selection clears (the path left the tree).
	function deleteDocAt(path: string, displayName: string) {
		guardAction("Delete this document", () => {
			if (!window.confirm(`Delete "${displayName}"? The removal is committed.`))
				return;
			void runFileOp({ kind: "delete-doc", path });
		});
	}

	function requestDeleteDoc(displayName: string) {
		const path = live.current.selected;
		if (!path) return;
		deleteDocAt(path, displayName);
	}

	// The bin's folder drop (M4-3 b5): the dirty guard (an open doc may sit in
	// the subtree), then a confirm that names the cost, then deleteFolder.
	function requestDeleteFolder(path: string, name: string) {
		guardAction(`Delete folder ${name}`, () => {
			if (
				!window.confirm(
					`Delete folder "${name}" and everything in it? The removal is committed.`,
				)
			)
				return;
			void runFileOp({ kind: "delete-folder", path });
		});
	}

	// --- file ops: one commit each server-side; every op refreshes the tree.
	// The dirty guard lives at the entry points now (guardAction, M4-3 b4):
	// the sidebar's NewDocButton ops never target the open doc, and the
	// header's move/delete route through the banner before reaching here.
	async function runFileOp(op: FileOp) {
		try {
			switch (op.kind) {
				case "create-doc":
					// Protected main (item 7): a new doc is a body write — the
					// draft starts first so the create commit lands on it and
					// the card carries the chip. Folders stay on main (not a
					// body write — spec).
					if (onMain) setBranch((await startDraft(op.path)).current);
					await createDoc(op.path);
					break;
				case "create-folder":
					// The tree grows a folder; nothing gets selected.
					await createFolder(op.path);
					break;
				case "move-doc":
					await moveDoc(op.from, op.to);
					break;
				case "delete-doc":
					await deleteDoc(op.path);
					break;
				case "move-folder":
					await renameFolder(op.from, op.to);
					break;
				case "delete-folder":
					await deleteFolder(op.path);
					break;
			}
			setError(null);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
			return;
		}
		refreshMeta();
		try {
			const t = await getTree();
			setTree(t);
			const s = live.current.selected;
			if (op.kind === "create-doc") setSelected(op.path);
			else if (op.kind === "move-doc" && s === op.from) setSelected(op.to);
			else if (op.kind === "move-folder" && s?.startsWith(`${op.from}/`))
				setSelected(op.to + s.slice(op.from.length));
			else if (s && !treeHas(t, s)) setSelected(null);
		} catch {
			// keep prior state — quiet
		}
	}

	// --- M4-2: ghost cards, the recycle bin, the draft pill ----------------

	// A draft-only doc card: check out its branch, then open it. The dirty
	// guard mirrors runFileOp — a checkout never strands unsaved edits.
	async function openGhost(path: string, branchName: string) {
		if (live.current.dirty) {
			setError("save or discard changes to the open document first");
			return;
		}
		await switchTo({ kind: "switch", name: branchName });
		setSelected(path);
	}

	// The draft pill's checkout (main → the branch touching the open doc).
	function openDraft(branchName: string) {
		if (live.current.dirty) {
			setError("save or discard changes to the open document first");
			return;
		}
		void switchTo({ kind: "switch", name: branchName });
	}

	// Merge (item 8): the sanctioned write back to main. A 409 shows the
	// conflict banner — the draft is untouched and still checked out.
	// Success reuses switchTo's refresh; the post-merge checkout is already
	// on main, so the "switch" is a no-op that reloads branch, meta, tree,
	// and the open doc on main's version. (Dirty buffers never get here —
	// the button is disabled; a reload would drop them.)
	async function runMerge() {
		try {
			await mergeDraft();
		} catch (e) {
			if (e instanceof SaveError && e.status === 409) setConflict(e.message);
			else setError(e instanceof Error ? e.message : String(e));
			return;
		}
		const mainName = meta?.main;
		if (mainName) void switchTo({ kind: "switch", name: mainName });
	}

	// One restore commit per entry, sequentially; the first error surfaces
	// after the loop, and tree + meta refresh either way (the bin must reflect
	// what actually restored).
	async function runRestore(items: DeletedDoc[]) {
		let failure: string | null = null;
		for (const d of items) {
			try {
				await restoreDoc(d.path, d.sha);
			} catch (e) {
				failure ??= e instanceof Error ? e.message : String(e);
			}
		}
		setError(failure);
		try {
			setTree(await getTree());
			setMeta(await getMeta());
		} catch {
			// keep prior state — quiet
		}
	}

	// --- M4-3 b6: link-navigation callbacks ----------------------------------

	// A doc link (optionally with a #fragment): navigate, and leave the
	// fragment as the pending anchor — the new doc's EditorPane scrolls to it
	// once the content and heading ids exist.
	function onDocLink(path: string, anchor?: string) {
		setSelected(path);
		setPendingAnchor(anchor ?? null);
	}

	// A folder link: expand the sidebar path (ancestors + target), then select
	// the folder's first doc if one exists — an empty .gitkeep folder just
	// stays visible (the tree amendment); the selection is untouched then.
	function onSelectFolderLink(path: string) {
		setExpandFolder((f) => ({ path, n: (f?.n ?? 0) + 1 }));
		const dir = tree ? findDir(tree, path) : null;
		const first = dir ? firstDoc(dir) : null;
		if (first) setSelected(first);
	}

	// LED + one-word status: amber = not synced yet (the word says which —
	// Unsaved/Saved/Syncing), green = synced, red = error (conflict or sync
	// failure; holds until the next clean sync).
	const led = ledRed ? "red" : dirty || syncing || !synced ? "amber" : "green";
	const ledLabel = ledRed
		? "Error"
		: dirty
			? "Unsaved"
			: syncing
				? "Syncing"
				: synced
					? "Synced"
					: "Saved";

	// The global Merge gate (item 8): a draft branch with unmerged doc changes.
	// Render-only here — batch E wires the click.
	const changedDocs = meta
		? Object.values(meta.drafts)
				.flat()
				.filter((e) => e.branch === meta.current).length
		: 0;
	const canMerge = Boolean(
		meta?.main && meta.current !== meta.main && changedDocs > 0,
	);

	// The doc-head inputs (item 3): per-doc meta, the branch line, and the
	// draft pill's target — only on main, when a draft elsewhere touches the
	// open doc.
	const docMeta = selected ? meta?.docs[selected] : undefined;
	const draftBranch =
		selected &&
		meta?.main &&
		meta.current === meta.main &&
		(meta.drafts[selected]?.length ?? 0) > 0
			? (meta.drafts[selected][0].branch ?? null)
			: null;
	// The pill's flip side (M4-3): on a NON-main branch that touches the
	// open doc — the header's non-clickable "on draft" badge. Per-doc
	// semantics: a branch that doesn't touch the open doc shows nothing.
	const onDraft = Boolean(
		selected &&
			meta?.main &&
			meta.current !== meta.main &&
			(meta.drafts[selected] ?? []).some((e) => e.branch === meta.current),
	);

	return (
		<>
			<div className="ambient" aria-hidden="true" />
			<div className="layout">
				<aside
					className="sidebar"
					aria-label="Documents"
					style={
						sidebarW === null
							? undefined
							: ({ "--sidebar-w": `${sidebarW}px` } as CSSProperties)
					}
				>
					{/* Two-row head (item 11): brand + "+", then branch + Merge. */}
					<div className="side-head">
						<div className="side-head-row">
							<span className="brand">fragmt</span>
							<div className="side-head-spacer" />
							<NewDocButton onFileOp={runFileOp} />
						</div>
						<div className="side-head-row side-head-branch">
							<BranchMenu current={branch} onAction={requestBranch} />
							<button
								type="button"
								className="iconbtn"
								disabled={!canMerge || dirty}
								title={
									canMerge
										? dirty
											? "save or discard changes to the open document first"
											: `${changedDocs} ${changedDocs === 1 ? "doc" : "docs"} changed`
										: undefined
								}
								onClick={() => void runMerge()}
							>
								Merge
							</button>
						</div>
					</div>
					<Sidebar
						tree={tree}
						selected={selected}
						onSelect={setSelected}
						meta={meta}
						expandFolder={expandFolder}
						onOpenGhost={(path, branchName) => void openGhost(path, branchName)}
						onRestore={(items) => void runRestore(items)}
						// Drag & drop (M4-3 b5): the sidebar's dropTargetValid has
						// already no-opped same-parent and self-subtree drops, so every
						// arrival here is a real move/delete through the batch-4 flows.
						onDropItem={(item: DragItem, folder: string) =>
							item.type === "doc"
								? moveDocTo(item.path, folder)
								: requestMoveFolder(item.path, folder)
						}
						onDropBin={(item: DragItem, name: string) =>
							item.type === "doc"
								? deleteDocAt(item.path, name)
								: requestDeleteFolder(item.path, name)
						}
					/>
					{error && (
						<p className="label-meta" style={{ padding: "0 16px 16px" }}>
							{error}
						</p>
					)}
					<SidebarResizeHandle onWidth={applySidebarW} />
				</aside>
				<main className="main">
					<DocView
						doc={doc}
						selected={selected}
						// A successful save commits locally — synced flips back
						// to false: the LED reads Saved (amber), not Synced;
						// the next sync confirms it.
						onSaved={(d) => {
							setDoc(d);
							setSynced(false);
							// A save is a commit — versions/drafts/bin moved.
							refreshMeta();
						}}
						onReload={reloadSelected}
						onDirtyChange={setDirty}
						commentCount={threads.length}
						onOpenComments={() => setRailOpen(true)}
						onCommentsChanged={refreshComments}
						onSpanClick={(id) => {
							setRailOpen(true);
							setSpanFocus((f) => ({ id, n: (f?.n ?? 0) + 1 }));
						}}
						pendingAction={pendingAction}
						onPendingActionCancel={() => setPendingAction(null)}
						conflict={conflict}
						onDismissConflict={() => setConflict(null)}
						onBeforeEdit={beforeEdit}
						// Protected main (item 7): read-mode comments draft
						// first — DocView awaits this before the combined POST
						// (undefined off main: no interception).
						onDraftFirst={onMain ? draftFirst : undefined}
						docMeta={docMeta}
						branch={branch}
						led={led}
						ledLabel={ledLabel}
						draftBranch={draftBranch}
						onOpenDraft={() => draftBranch && openDraft(draftBranch)}
						onDraft={onDraft}
						authors={meta?.authors ?? {}}
						docs={docs}
						onSelectDoc={onDocLink}
						onSelectFolder={onSelectFolderLink}
						pendingAnchor={pendingAnchor}
						onAnchorConsumed={clearAnchor}
						folders={folders}
						onBeforeRename={beforeRename}
						onMoveDoc={requestMoveDoc}
						onDeleteDoc={requestDeleteDoc}
						onRenamed={onRenamed}
					/>
				</main>
				{/* The rail is a layout sibling of <main> (right margin column);
				    the head carries the app's sync LED + theme (review decision 2). */}
				{selected && (
					<CommentsRail
						threads={threads}
						liveIds={liveIds}
						led={led}
						ledLabel={ledLabel}
						open={railOpen}
						onClose={() => setRailOpen(false)}
						focus={spanFocus}
						onReply={(id, body) => railReply(id, body)}
						onResolve={(id) => void railResolve(id, true)}
						onReopen={(id) => void railResolve(id, false)}
						onDelete={(id) => void railDelete(id)}
						error={railError}
						docs={docs}
						onOpenDoc={setSelected}
					/>
				)}
			</div>
		</>
	);
}
