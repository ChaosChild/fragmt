import { Check, FolderInput, Pencil, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
	addComment,
	type DocMeta,
	type DocResponse,
	getDraftDiff,
	SaveError,
	saveDoc,
	setTitle,
} from "./api";
import { avatarUser, displayTitle } from "./display";
import { EditorPane, type EditorPaneHandle } from "./EditorPane";
import type { AtDoc } from "./editor/at";
import { MenuPopover, useMenu } from "./Menus";
import { shortDate } from "./Sidebar";

/**
 * The email-parallel avatar (item 3): the config authors map first (email →
 * GitHub username, App passes it from meta), then the keyless GitHub noreply
 * heuristic – `123456+user@` or `user@` – either way
 * avatars.githubusercontent.com/<user>?s=76; a load error or non-matching
 * email falls back to the author's initials.
 */
function Avatar({
	author,
	email,
	authors,
}: {
	author: string;
	email: string;
	authors: Record<string, string>;
}) {
	const [broken, setBroken] = useState(false);
	const user = avatarUser(email, authors);
	if (user && !broken) {
		return (
			<img
				className="avatar"
				src={`https://avatars.githubusercontent.com/${user}?s=76`}
				alt=""
				width={38}
				height={38}
				onError={() => setBroken(true)}
			/>
		);
	}
	const initials = author
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((w) => w[0] ?? "")
		.join("")
		.toUpperCase();
	return (
		<span className="avatar" aria-hidden="true">
			{initials}
		</span>
	);
}

/**
 * The doc pane: reading mode by default (DESIGN §3), one explicit Edit action
 * flips the SAME mounted Tiptap editor to editable (M4 review decision 3 –
 * one rendering path, no reflow between modes). Save commits via PUT; a 409
 * shows a non-destructive banner and keeps the user's buffer (M2 spec).
 * Comment anchoring (M4-2) is one combined POST – doc body and sidecar
 * thread in a single server-side commit – without ever flipping the mode.
 * The comments rail lives in App, always present beside this pane; DocView
 * only forwards highlight-span clicks to it.
 */
export function DocView({
	doc,
	selected,
	onSaved,
	onReload,
	onDirtyChange,
	onCommentsChanged,
	onSpanClick,
	pendingAction,
	onPendingActionCancel,
	conflict,
	onDismissConflict,
	onEscapeSurfacesClear,
	onBeforeEdit,
	onDraftFirst,
	docMeta,
	branch,
	led,
	ledLabel,
	draftBranch,
	onOpenDraft,
	onDraft,
	docs,
	onSelectDoc,
	onOpenPreview,
	onSelectFolder,
	pendingAnchor,
	onAnchorConsumed,
	authors,
	folders,
	rootMoveValid,
	onBeforeRename,
	onMoveDoc,
	onDeleteDoc,
	onRenamed,
}: {
	doc: DocResponse | null;
	selected: string | null;
	onSaved: (doc: DocResponse) => void;
	onReload: () => void;
	onDirtyChange: (dirty: boolean) => void;
	/** Bumps App's sidecar refetch after a successful create. */
	onCommentsChanged: () => void;
	/** A comment highlight was activated in the doc – jump the rail to it. */
	onSpanClick: (id: string) => void;
	/** An action blocked on the save-or-discard choice – a branch switch or
	 *  a header file op (M3, generalized M4-3 b4); the headline names it and
	 *  `go` runs after Save/Discard (App clears its state). */
	pendingAction: { headline: string; go: () => void } | null;
	onPendingActionCancel: () => void;
	/** Sync conflict message (M3) – the calm banner, never a merge UI. */
	conflict: string | null;
	onDismissConflict: () => void;
	/** The Escape chain's slideout slot (#15 b5, App) – forwarded verbatim to
	 *  EditorPane: true = the slideout was open and the Escape closed it. */
	onEscapeSurfacesClear?: () => boolean;
	/** Pre-edit gate (App): true = flip to edit mode. On main, App drafts
	 *  first (protected main) and returns false on failure – the banner is
	 *  App's; DocView stays dumb. */
	onBeforeEdit: () => Promise<boolean>;
	/** Protected main: awaited before the combined comment POST when the doc
	 *  write must go through a draft (App provides it only on main). */
	onDraftFirst?: () => Promise<boolean>;
	/** The open doc's git metadata (author/version/date) – the doc-head lines. */
	docMeta?: DocMeta;
	/** Current branch name – the "vN · branch" segment. */
	branch: string | null;
	/** App's LED color/word – reused verbatim in the head (one vocabulary). */
	led: string;
	ledLabel: string;
	/** The branch a draft pill would check out; null = no pill (App computes). */
	draftBranch: string | null;
	onOpenDraft: () => void;
	/** On a non-main branch touching THIS doc – the pill's non-clickable
	 *  flip side, the "on draft" badge (App computes; M4-3). */
	onDraft: boolean;
	/** email → GitHub username – Avatar's first lookup (App, from meta). */
	authors: Record<string, string>;
	/** The tree's docs – the editor's @ menu and link-click doc set (M4-2). */
	docs: AtDoc[];
	/** An in-doc link resolved to a tree doc – navigate in-app (App); the
	 *  #fragment rides along and scrolls after the new doc renders (M4-3 b6). */
	onSelectDoc: (path: string, anchor?: string) => void;
	/** A doc-link click chose the slideout preview (#15) – edit-mode clicks
	 *  (any modifier) and read-mode Shift/hover-↗ hits; App opens the pane. */
	onOpenPreview: (path: string, anchor?: string) => void;
	/** An in-doc link resolved to a tree folder – App expands it in the
	 *  sidebar and selects its first doc (M4-3 b6). */
	onSelectFolder: (path: string) => void;
	/** A cross-doc #fragment waiting to scroll after the doc loads (App owns
	 *  it; EditorPane consumes it). */
	pendingAnchor: string | null;
	/** The pending anchor was consumed – App clears it. */
	onAnchorConsumed: () => void;
	/** Collision-free move destinations (M4-4 b1, App pre-filters): every
	 *  tree folder except the current parent and folders already holding a
	 *  child named like this doc – a guaranteed 409 is never offered. */
	folders: string[];
	/** Root ("") is offerable – true only from a subfolder and only when
	 *  root holds no same-named child (App computes; M4-4 b1). */
	rootMoveValid: boolean;
	/** Pre-rename gate (App): on main a title write is a doc-body write, so
	 *  the draft starts (and checks out) first; false = App bannered and
	 *  the box stays closed. The dirty gate is DocView's banner (below). */
	onBeforeRename: () => Promise<boolean>;
	/** Move to a tree folder ("" = docsRoot root) – App runs the dirty guard
	 *  and the existing move op; selection follows the new path. */
	onMoveDoc: (folder: string) => void;
	/** Delete the open doc – App runs the dirty guard, the confirm, and the
	 *  existing delete op; the display name rides along for the confirm. */
	onDeleteDoc: (displayName: string) => void;
	/** A title landed – App reloads the doc (frontmatter changed) + meta. */
	onRenamed: () => void;
}) {
	const [editing, setEditing] = useState(false);
	const [saving, setSaving] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);
	const [dirty, setDirtyLocal] = useState(false);
	// EditorPane reports buffer dirtiness; App needs it for the branch-switch
	// guard (M3), so every change also flows up.
	const setDirty = (d: boolean) => {
		setDirtyLocal(d);
		onDirtyChange(d);
	};
	const [confirmingCancel, setConfirmingCancel] = useState(false);
	// Discard must drop the edited buffer: the editor stays mounted across
	// the mode flip, so bumping the key remounts it fresh from doc.markdown.
	const [resetCount, setResetCount] = useState(0);
	// M4-3 b4 header file actions: the move picker's anchored popover, the
	// rename box, and its blocked-on-dirty state (the local flavor of
	// pendingAction – the box opens after the choice).
	const moveMenu = useMenu();
	const [renaming, setRenaming] = useState(false);
	const [renameValue, setRenameValue] = useState("");
	const [renameError, setRenameError] = useState<string | null>(null);
	const [renameBusy, setRenameBusy] = useState(false);
	const [pendingRename, setPendingRename] = useState(false);
	// M4-3 b6: the dead-link note's payload – a relative .md link that matched
	// nothing in the tree. Cleared on doc change (the note describes the open
	// doc's links) and by its Dismiss button.
	const [linkNotFound, setLinkNotFound] = useState<string | null>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: `selected` is the change trigger – the note describes the open doc's links and clears with it.
	useEffect(() => {
		setLinkNotFound(null);
	}, [selected]);
	// The draft gutter (#18): the main pane marks the blocks the draft's
	// commits touched. Refires on doc/branch changes, skips off-draft, and a
	// failed fetch is just no marking – a decoration never becomes an error.
	const [changedLines, setChangedLines] = useState<
		{ start: number; end: number }[]
	>([]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: `branch` never enters the effect body – it is the refetch trigger (a checkout must refresh the gutter).
	useEffect(() => {
		setChangedLines([]);
		if (!onDraft || !selected) return;
		let live = true;
		getDraftDiff(selected)
			.then((r) => {
				if (live) setChangedLines(r.lines);
			})
			.catch(() => {
				if (live) setChangedLines([]);
			});
		return () => {
			live = false;
		};
	}, [selected, branch, onDraft]);
	const renameRef = useRef<HTMLInputElement>(null);
	const editorRef = useRef<EditorPaneHandle>(null);
	const paneRef = useRef<HTMLDivElement>(null);

	// The confirm banners render at the top of the pane – bring them into view
	// when one appears, otherwise a mid-document Esc raises it unseen.
	useEffect(() => {
		if (confirmingCancel || pendingAction || pendingRename) {
			paneRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
		}
	}, [confirmingCancel, pendingAction, pendingRename]);

	// The rename box opens focused with its initial value selected (and
	// re-selects on refocus).
	useEffect(() => {
		if (renaming) renameRef.current?.select();
	}, [renaming]);

	const conflictBanner = conflict && (
		<div className="conflict-banner" role="alert">
			<div>
				<strong>Sync conflict</strong>
				{conflict} Resolve the file in your editor or on GitHub – the next sync
				picks up the result.
			</div>
			<button
				type="button"
				className="iconbtn subtle dismiss"
				onClick={onDismissConflict}
			>
				Dismiss
			</button>
		</div>
	);

	if (!selected) {
		return (
			<div className="doc-pane">
				{conflictBanner}
				<p className="label-meta">Select a document.</p>
			</div>
		);
	}
	const segs = selected.split("/");
	const file = segs[segs.length - 1];
	const dir = segs.slice(0, -1).join(" / ");
	// The display-name model (M4-3 b4): frontmatter title, else the basename
	// sans .md – the sidebar cards and the @ menu resolve the same way.
	const displayName = displayTitle(doc?.frontmatter.title, file);

	// --- header file actions (M4-3 b4) --------------------------------------
	// Rename gates in the spec's order: a dirty buffer raises the
	// save-or-discard banner first (the branch-switch mechanism, local here
	// because the box opens afterwards), then App's gate – on main the title
	// write is a doc-body write, so a draft starts first. The file path
	// never changes; only the frontmatter title does.
	function requestRename() {
		if (!doc) return;
		if (dirty) {
			setPendingRename(true);
			return;
		}
		void proceedRename();
	}

	async function proceedRename() {
		if (!doc || !(await onBeforeRename())) return;
		setRenameValue(displayName);
		setRenameError(null);
		setRenaming(true);
	}

	function closeRename() {
		setRenaming(false);
		setRenameError(null);
	}

	async function submitRename() {
		if (!doc || renameBusy) return;
		const title = renameValue.trim();
		if (!title) {
			closeRename(); // empty input = cancel
			return;
		}
		setRenameBusy(true);
		setRenameError(null);
		try {
			await setTitle(doc.path, title);
		} catch (e) {
			// The box stays open – the error sits inline next to the input.
			setRenameError(e instanceof Error ? e.message : String(e));
			return;
		} finally {
			setRenameBusy(false);
		}
		closeRename();
		onRenamed();
	}

	const docBar =
		renaming && doc ? (
			<form
				className="rename-form"
				onSubmit={(e) => {
					e.preventDefault();
					void submitRename();
				}}
			>
				<input
					ref={renameRef}
					value={renameValue}
					onChange={(e) => setRenameValue(e.target.value)}
					onFocus={(e) => e.target.select()}
					onKeyDown={(e) => {
						if (e.key === "Escape") {
							// Consumed (#15 b5): the box is an Escape surface –
							// the window fallback must not also close the
							// slideout on the same press.
							e.preventDefault();
							closeRename();
						}
					}}
					aria-label="Document title"
					disabled={renameBusy}
				/>
				<button
					type="submit"
					className="tool-btn"
					aria-label="Confirm rename"
					title="Confirm rename"
					disabled={renameBusy}
				>
					<Check aria-hidden="true" />
				</button>
				<button
					type="button"
					className="tool-btn"
					aria-label="Cancel rename"
					title="Cancel rename"
					onClick={closeRename}
					disabled={renameBusy}
				>
					<X aria-hidden="true" />
				</button>
				{renameError && (
					<span className="rename-error" role="alert">
						{renameError}
					</span>
				)}
			</form>
		) : (
			<div className="doc-bar-main">
				<nav className="breadcrumb" aria-label="Breadcrumb">
					{dir ? `${dir} / ` : ""}
					<span>{displayName}</span>
				</nav>
				{/* Read AND edit mode (M4-3 b4): the three file actions live on
			    the breadcrumb line itself; each is a ≥32px target with an
			    aria-label. */}
				{doc && (
					<>
						<button
							type="button"
							className="tool-btn"
							aria-label="Rename document"
							title="Rename"
							onClick={requestRename}
						>
							<Pencil aria-hidden="true" />
						</button>
						<span className="menu-wrap" ref={moveMenu.wrapRef}>
							<button
								type="button"
								className="tool-btn"
								aria-label="Move document"
								title="Move"
								aria-expanded={moveMenu.open}
								onClick={moveMenu.toggle}
							>
								<FolderInput aria-hidden="true" />
							</button>
							<MenuPopover anchor={moveMenu.anchor} popRef={moveMenu.popRef}>
								{/* App pre-filters (M4-4 b1): folders here are collision-free
								    already – the current parent and occupied folders never
								    arrive, and root rides on rootMoveValid. */}
								{rootMoveValid && (
									<button
										type="button"
										className="menu-item"
										onClick={() => {
											moveMenu.close();
											onMoveDoc("");
										}}
									>
										/ (root)
									</button>
								)}
								{folders.map((f) => (
									<button
										key={f}
										type="button"
										className="menu-item"
										onClick={() => {
											moveMenu.close();
											onMoveDoc(f);
										}}
									>
										{f}
									</button>
								))}
								{folders.length === 0 && !rootMoveValid && (
									<p className="menu-empty">no collision-free destination</p>
								)}
							</MenuPopover>
						</span>
						<button
							type="button"
							className="tool-btn"
							aria-label="Delete document"
							title="Delete"
							onClick={() => onDeleteDoc(displayName)}
						>
							<Trash2 aria-hidden="true" />
						</button>
					</>
				)}
			</div>
		);

	// The one PUT seam both save paths share (M2): sends the buffer with
	// DocView's base hash; on success the doc state/hash refresh through
	// onSaved (App.setDoc → same-content setContent → dirty resets), so the
	// next save doesn't 409 itself.
	async function persist(markdown: string): Promise<boolean> {
		if (!doc || saving) return false;
		setSaving(true);
		setSaveError(null);
		try {
			const { hash } = await saveDoc(doc.path, markdown, doc.hash);
			setDirty(false);
			onSaved({ ...doc, markdown, hash });
			return true;
		} catch (e) {
			if (e instanceof SaveError && e.status === 409) {
				setSaveError("changed on disk – copy your changes, then reload");
			} else {
				setSaveError(e instanceof Error ? e.message : String(e));
			}
			return false;
		} finally {
			setSaving(false);
		}
	}

	async function handleSave(): Promise<boolean> {
		const ok = await persist(editorRef.current?.getMarkdown() ?? "");
		if (ok) {
			setEditing(false);
			setConfirmingCancel(false);
		}
		return ok;
	}

	// Comment anchoring (M4-2's one-commit contract): the mark is already
	// applied locally by the composer; ONE POST carries the serialized doc
	// body + base hash AND the thread – the server writes both files in a
	// single commit. A failure (e.g. a stale base hash → 409) leaves disk
	// untouched; the banner shows it and the buffer's mark just sits there
	// until saved or discarded. The mode is never flipped – commenting from
	// read mode stays in read mode.
	async function handleComment(id: string, quote: string, body: string) {
		if (!doc || saving) return;
		setSaving(true);
		setSaveError(null);
		try {
			// Protected main: on main the doc write drafts first (App) – the
			// baseHash and serialized body stay valid, a fresh checkout
			// doesn't change file content. False = App bannered; no POST.
			if (onDraftFirst && !(await onDraftFirst())) return;
			await addComment(doc.path, {
				id,
				quote,
				body,
				docBody: editorRef.current?.getMarkdown() ?? "",
				docBaseHash: doc.hash,
			});
			// The doc changed on disk (mark included) – refetch for the
			// canonical body + hash the next save or comment builds on.
			setDirty(false);
			onReload();
			onCommentsChanged();
		} catch (e) {
			setSaveError(e instanceof Error ? e.message : String(e));
		} finally {
			setSaving(false);
		}
	}

	// Cancel gates on unsaved work: the first ask raises the banner (Escape or
	// the Cancel button alike), confirming discards. A clean buffer just exits.
	function requestCancel() {
		if (!dirty) {
			setEditing(false);
			setSaveError(null);
			setConfirmingCancel(false);
			return;
		}
		if (confirmingCancel) {
			discardAndClose();
			return;
		}
		setConfirmingCancel(true);
	}

	function discardAndClose() {
		setEditing(false);
		setSaveError(null);
		setConfirmingCancel(false);
		setDirty(false);
		setResetCount((c) => c + 1);
	}

	// The shared save-or-discard banner: Keep editing keeps the buffer;
	// Discard or a successful Save clears it and continues with `onGo`.
	// One shape, three users – a blocked branch switch (App's pendingAction),
	// a blocked header file op (same), and a blocked rename (the box opens
	// afterwards, so its continue is local).
	const guardBanner = (
		headline: string,
		onKeep: () => void,
		onGo: () => void,
	) => (
		<div className="conflict-banner" role="alert">
			<div>
				<strong>{headline}?</strong>
				This document has unsaved changes.
			</div>
			<div className="doc-actions">
				<button
					type="button"
					className="iconbtn subtle dismiss"
					onClick={onKeep}
				>
					Keep editing
				</button>
				<button
					type="button"
					className="iconbtn"
					onClick={() => {
						discardAndClose();
						onGo();
					}}
				>
					Discard
				</button>
				<button
					type="button"
					className="iconbtn primary"
					disabled={saving}
					onClick={() =>
						void handleSave().then((ok) => {
							if (ok) onGo();
						})
					}
				>
					Save
				</button>
			</div>
		</div>
	);
	const pendingBanner =
		pendingAction &&
		guardBanner(
			pendingAction.headline,
			onPendingActionCancel,
			pendingAction.go,
		);
	const pendingRenameBanner =
		pendingRename &&
		guardBanner(
			"Rename this document",
			() => setPendingRename(false),
			() => void proceedRename(),
		);

	// The doc-head meta line (item 3): "vN · branch · saved <time>" in read
	// mode, "editing vN · branch" in edit mode, then the sync LED + word –
	// the rail's one-word vocabulary, reused.
	const syncWord = editing ? "unsaved changes" : ledLabel.toLowerCase();
	const lineSegs: string[] = [];
	if (docMeta)
		lineSegs.push(
			editing ? `editing v${docMeta.version}` : `v${docMeta.version}`,
		);
	if (branch) lineSegs.push(branch);
	if (!editing && docMeta) lineSegs.push(`saved ${shortDate(docMeta.date)}`);

	// One rendering path (M4 review decision 3): the editor is mounted in
	// BOTH modes – read is `editable: false` on the same instance, Edit/Save/
	// Cancel are mode flips with no remount (only a discard bumps the key to
	// drop the buffer). The pane classes share their layout rule; the editor
	// carries the `markdown` typography class, so the document reads
	// identically in both modes (M2 pixel parity).
	return (
		<div className={editing ? "editor-pane" : "doc-pane"} ref={paneRef}>
			<div className="doc-bar">{docBar}</div>
			{/* Dead-link note (M4-3 b6): a relative link that looks like a doc but
			    matches nothing – said plainly under the breadcrumb, dismissable,
			    never a tab hijack. Same visual family as the conflict banner. */}
			{linkNotFound && (
				<div className="conflict-banner" role="status">
					<div>
						<strong>Link not found</strong>
						{linkNotFound}
					</div>
					<button
						type="button"
						className="iconbtn subtle dismiss"
						onClick={() => setLinkNotFound(null)}
					>
						Dismiss
					</button>
				</div>
			)}
			{doc && (
				<header className="doc-head">
					<Avatar
						author={docMeta?.author ?? ""}
						email={docMeta?.authorEmail ?? ""}
						authors={authors}
					/>
					<div className="dh-main">
						<div className="dh-author">{docMeta?.author ?? "–"}</div>
						<div className="dh-line">
							{lineSegs.map((s, i) => (
								<span key={s}>
									{i > 0 && <span className="sep">·</span>}
									{s}
								</span>
							))}
							{lineSegs.length > 0 && <span className="sep">·</span>}
							<span className="dh-sync">
								<span
									className={`led ${editing ? "amber" : led}`}
									role="status"
									aria-label={syncWord}
								/>
								{syncWord}
							</span>
						</div>
					</div>
					{/* The draft pill (item 3): only on main, when a draft elsewhere
					    touches this doc – click checks the draft out (App). Its flip
					    side (M4-3): on a draft branch touching THIS doc, a
					    NON-clickable "on draft" badge (span – nothing to click). */}
					{draftBranch && (
						<button type="button" className="draft-pill" onClick={onOpenDraft}>
							<Pencil aria-hidden="true" />
							draft exists – open
						</button>
					)}
					{onDraft && <span className="draft-pill on-draft">on draft</span>}
					<div className="doc-actions">
						{editing ? (
							<>
								<button
									type="button"
									className="iconbtn subtle"
									onClick={requestCancel}
									disabled={saving}
								>
									<X aria-hidden="true" />
									<span className="label">Cancel</span>
								</button>
								<button
									type="button"
									className="iconbtn primary"
									onClick={() => void handleSave()}
									disabled={saving}
								>
									<Check aria-hidden="true" />
									<span className="label">{saving ? "Saving…" : "Save"}</span>
								</button>
							</>
						) : (
							<button
								type="button"
								className="iconbtn"
								onClick={() => {
									// App gates the flip (protected main: draft
									// first) – only a true enters edit mode.
									void onBeforeEdit().then((proceed) => {
										if (!proceed) return;
										setEditing(true);
										setSaveError(null);
									});
								}}
							>
								<Pencil aria-hidden="true" />
								<span className="label">Edit</span>
							</button>
						)}
					</div>
				</header>
			)}
			{conflictBanner}
			{pendingBanner}
			{pendingRenameBanner}
			{confirmingCancel && (
				<div className="conflict-banner" role="alert">
					<div>
						<strong>Discard unsaved changes?</strong>
						Your edits will be lost.
					</div>
					<div className="doc-actions">
						<button
							type="button"
							className="iconbtn subtle dismiss"
							onClick={() => setConfirmingCancel(false)}
						>
							Keep editing
						</button>
						<button type="button" className="iconbtn" onClick={discardAndClose}>
							Discard
						</button>
					</div>
				</div>
			)}
			{saveError && (
				<div className="conflict-banner" role="alert">
					<div>
						<strong>Save failed</strong>
						{saveError}
					</div>
					<button
						type="button"
						className="iconbtn subtle dismiss"
						onClick={() => {
							setEditing(false);
							setSaveError(null);
							onReload();
						}}
					>
						Reload
					</button>
				</div>
			)}
			{doc ? (
				<EditorPane
					key={`${doc.path}#${resetCount}`}
					ref={editorRef}
					markdown={doc.markdown}
					editable={editing}
					saving={saving}
					onDirtyChange={setDirty}
					onSave={() => void handleSave()}
					onCancel={requestCancel}
					onEscapeSurfacesClear={onEscapeSurfacesClear}
					onComment={(id, quote, body) => void handleComment(id, quote, body)}
					onSpanClick={onSpanClick}
					docPath={selected ?? doc.path}
					docs={docs}
					folders={folders}
					onSelectDoc={onSelectDoc}
					onOpenPreview={onOpenPreview}
					onSelectFolder={onSelectFolder}
					onLinkNotFound={setLinkNotFound}
					anchor={pendingAnchor}
					onAnchorConsumed={onAnchorConsumed}
					changedLines={changedLines}
				/>
			) : null}
		</div>
	);
}
