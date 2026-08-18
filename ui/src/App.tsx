import { useCallback, useEffect, useRef, useState } from "react";
import {
	type CommentFile,
	type CommentThread,
	checkoutBranch,
	createBranch,
	createDoc,
	type DocResponse,
	deleteComment,
	deleteDoc,
	deleteFolder,
	getBranches,
	getComments,
	getDoc,
	getTree,
	moveDoc,
	patchComment,
	renameFolder,
	sync,
	type TreeNode,
} from "./api";
import { CommentsRail } from "./CommentsRail";
import { DocView } from "./DocView";
import {
	type BranchAction,
	BranchMenu,
	type FileOp,
	NewDocButton,
} from "./Menus";
import { Sidebar } from "./Sidebar";

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

export function App() {
	const [tree, setTree] = useState<TreeNode | null>(null);
	const [selected, setSelected] = useState<string | null>(null);
	const [doc, setDoc] = useState<DocResponse | null>(null);
	const [error, setError] = useState<string | null>(null);

	// M3: branches, sync, file ops.
	const [branch, setBranch] = useState<string | null>(null);
	const [dirty, setDirty] = useState(false);
	const [pendingBranch, setPendingBranch] = useState<BranchAction | null>(null);
	const [syncing, setSyncing] = useState(false);
	const [conflict, setConflict] = useState<string | null>(null);
	const [ledRed, setLedRed] = useState(false);
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
	}, []);

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

	async function railResolve(id: string) {
		if (!selected) return;
		try {
			await patchComment(selected, id, { resolved: true });
		} catch (e) {
			setRailError(e instanceof Error ? e.message : String(e));
			return;
		}
		setRailError(null);
		refreshComments();
	}

	// Delete removes the sidecar entry now; the span itself disappears on the
	// doc's next save (spec) — so simply refetch both. The doc refetch is
	// skipped while the buffer is dirty (it would drop unsaved edits).
	async function railDelete(id: string) {
		if (!selected) return;
		if (!window.confirm("Delete this comment thread?")) return;
		try {
			await deleteComment(selected, id);
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

	// The branch-switch guard: unsaved edits block the switch with the
	// save-or-discard banner (DocView), never a silent loss.
	function requestBranch(action: BranchAction) {
		if (live.current.dirty) setPendingBranch(action);
		else void switchTo(action);
	}

	// --- file ops: one commit each server-side; every op refreshes the tree.
	async function runFileOp(op: FileOp) {
		const target =
			op.kind === "move-doc" || op.kind === "move-folder"
				? op.from
				: op.kind === "delete-doc" || op.kind === "delete-folder"
					? op.path
					: null;
		if (
			target &&
			live.current.dirty &&
			(live.current.selected === target ||
				live.current.selected?.startsWith(`${target}/`))
		) {
			setError("save or discard changes to the open document first");
			return;
		}
		try {
			switch (op.kind) {
				case "create-doc":
					await createDoc(op.path);
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

	return (
		<>
			<div className="ambient" aria-hidden="true" />
			<div className="layout">
				<aside className="sidebar" aria-label="Documents">
					<div className="side-head">
						<span className="brand">fragmt</span>
						<div className="side-head-spacer" />
						<NewDocButton onFileOp={runFileOp} />
						<BranchMenu current={branch} onAction={requestBranch} />
					</div>
					<Sidebar
						tree={tree}
						selected={selected}
						onSelect={setSelected}
						onFileOp={runFileOp}
					/>
					{error && (
						<p className="label-meta" style={{ padding: "0 16px 16px" }}>
							{error}
						</p>
					)}
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
						pendingBranch={pendingBranch?.name ?? null}
						onPendingBranchCancel={() => setPendingBranch(null)}
						onPendingBranchGo={() => {
							const action = pendingBranch;
							setPendingBranch(null);
							if (action) void switchTo(action);
						}}
						conflict={conflict}
						onDismissConflict={() => setConflict(null)}
						onBeforeEdit={() => void runSync()}
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
						onResolve={(id) => void railResolve(id)}
						onDelete={(id) => void railDelete(id)}
						error={railError}
					/>
				)}
			</div>
		</>
	);
}
