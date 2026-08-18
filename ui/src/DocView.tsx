import { Check, MessageSquare, Pencil, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
	addComment,
	type DocMeta,
	type DocResponse,
	SaveError,
	saveDoc,
} from "./api";
import { EditorPane, type EditorPaneHandle } from "./EditorPane";
import { shortDate } from "./Sidebar";

/**
 * The email-parallel avatar (item 3): the keyless GitHub noreply heuristic —
 * `123456+user@` or `user@` → avatars.githubusercontent.com/<user>?s=76; a
 * load error or non-matching email falls back to the author's initials.
 */
function Avatar({ author, email }: { author: string; email: string }) {
	const [broken, setBroken] = useState(false);
	const user = /^(\d+\+)?([a-z0-9-]+)@users\.noreply\.github\.com$/i.exec(
		email,
	)?.[2];
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
 * flips the SAME mounted Tiptap editor to editable (M4 review decision 3 —
 * one rendering path, no reflow between modes). Save commits via PUT; a 409
 * shows a non-destructive banner and keeps the user's buffer (M2 spec).
 * Comment anchoring (M4-2) is one combined POST — doc body and sidecar
 * thread in a single server-side commit — without ever flipping the mode.
 * The rail lives in App; DocView keeps only the doc-bar badge (fed from
 * App's sidecar state) and forwards highlight-span clicks to it.
 */
export function DocView({
	doc,
	selected,
	onSaved,
	onReload,
	onDirtyChange,
	commentCount,
	onOpenComments,
	onCommentsChanged,
	onSpanClick,
	pendingBranch,
	onPendingBranchCancel,
	onPendingBranchGo,
	conflict,
	onDismissConflict,
	onBeforeEdit,
	docMeta,
	branch,
	led,
	ledLabel,
	draftBranch,
	onOpenDraft,
}: {
	doc: DocResponse | null;
	selected: string | null;
	onSaved: (doc: DocResponse) => void;
	onReload: () => void;
	onDirtyChange: (dirty: boolean) => void;
	/** Live thread count (App owns the sidecar state) — 0 hides the button. */
	commentCount: number;
	/** Opens/scrolls the comments rail (App); the mobile sheet's entry point. */
	onOpenComments: () => void;
	/** Bumps App's sidecar refetch after a successful create. */
	onCommentsChanged: () => void;
	/** A comment highlight was activated in the doc — jump the rail to it. */
	onSpanClick: (id: string) => void;
	/** A branch switch waiting on the save-or-discard choice (M3). */
	pendingBranch: string | null;
	onPendingBranchCancel: () => void;
	onPendingBranchGo: () => void;
	/** Sync conflict message (M3) — the calm banner, never a merge UI. */
	conflict: string | null;
	onDismissConflict: () => void;
	onBeforeEdit: () => void;
	/** The open doc's git metadata (author/version/date) — the doc-head lines. */
	docMeta?: DocMeta;
	/** Current branch name — the "vN · branch" segment. */
	branch: string | null;
	/** App's LED color/word — reused verbatim in the head (one vocabulary). */
	led: string;
	ledLabel: string;
	/** The branch a draft pill would check out; null = no pill (App computes). */
	draftBranch: string | null;
	onOpenDraft: () => void;
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
	const editorRef = useRef<EditorPaneHandle>(null);
	const paneRef = useRef<HTMLDivElement>(null);

	// The confirm banners render at the top of the pane — bring them into view
	// when one appears, otherwise a mid-document Esc raises it unseen.
	useEffect(() => {
		if (confirmingCancel || pendingBranch) {
			paneRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
		}
	}, [confirmingCancel, pendingBranch]);

	const conflictBanner = conflict && (
		<div className="conflict-banner" role="alert">
			<div>
				<strong>Sync conflict</strong>
				{conflict} Resolve the file in your editor or on GitHub — the next sync
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
	const breadcrumb = (
		<nav className="breadcrumb" aria-label="Breadcrumb">
			{dir ? `${dir} / ` : ""}
			<span>{file}</span>
		</nav>
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
				setSaveError("changed on disk — copy your changes, then reload");
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
	// body + base hash AND the thread — the server writes both files in a
	// single commit. A failure (e.g. a stale base hash → 409) leaves disk
	// untouched; the banner shows it and the buffer's mark just sits there
	// until saved or discarded. The mode is never flipped — commenting from
	// read mode stays in read mode.
	async function handleComment(id: string, quote: string, body: string) {
		if (!doc || saving) return;
		setSaving(true);
		setSaveError(null);
		try {
			await addComment(doc.path, {
				id,
				quote,
				body,
				docBody: editorRef.current?.getMarkdown() ?? "",
				docBaseHash: doc.hash,
			});
			// The doc changed on disk (mark included) — refetch for the
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

	// A blocked branch switch: same save-or-discard shape as requestCancel,
	// but confirming performs the switch instead of just exiting (M3).
	const pendingBanner = pendingBranch && (
		<div className="conflict-banner" role="alert">
			<div>
				<strong>Switch to {pendingBranch}?</strong>
				This document has unsaved changes.
			</div>
			<div className="doc-actions">
				<button
					type="button"
					className="iconbtn subtle dismiss"
					onClick={onPendingBranchCancel}
				>
					Keep editing
				</button>
				<button
					type="button"
					className="iconbtn"
					onClick={() => {
						discardAndClose();
						onPendingBranchGo();
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
							if (ok) onPendingBranchGo();
						})
					}
				>
					Save
				</button>
			</div>
		</div>
	);

	// The doc-head meta line (item 3): "vN · branch · saved <time>" in read
	// mode, "editing vN · branch" in edit mode, then the sync LED + word —
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
	// BOTH modes — read is `editable: false` on the same instance, Edit/Save/
	// Cancel are mode flips with no remount (only a discard bumps the key to
	// drop the buffer). The pane classes share their layout rule; the editor
	// carries the `markdown` typography class, so the document reads
	// identically in both modes (M2 pixel parity).
	return (
		<div className={editing ? "editor-pane" : "doc-pane"} ref={paneRef}>
			<div className="doc-bar">{breadcrumb}</div>
			{doc && (
				<header className="doc-head">
					<Avatar
						author={docMeta?.author ?? ""}
						email={docMeta?.authorEmail ?? ""}
					/>
					<div className="dh-main">
						<div className="dh-author">{docMeta?.author ?? "—"}</div>
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
					    touches this doc — click checks the draft out (App). */}
					{draftBranch && (
						<button type="button" className="draft-pill" onClick={onOpenDraft}>
							<Pencil aria-hidden="true" />
							draft exists — open
						</button>
					)}
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
							<>
								{/* comments-btn stays desktop-hidden (mock rule) — it
								    surfaces ≤1180px, where the rail becomes a sheet. */}
								{commentCount > 0 && (
									<button
										type="button"
										className="iconbtn comments-btn"
										aria-label={`Comments (${commentCount})`}
										onClick={onOpenComments}
									>
										<MessageSquare aria-hidden="true" />
										<span className="label">Comments</span>
										<span className="badge">{commentCount}</span>
									</button>
								)}
								<button
									type="button"
									className="iconbtn"
									onClick={() => {
										onBeforeEdit();
										setEditing(true);
										setSaveError(null);
									}}
								>
									<Pencil aria-hidden="true" />
									<span className="label">Edit</span>
								</button>
							</>
						)}
					</div>
				</header>
			)}
			{conflictBanner}
			{pendingBanner}
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
					onComment={(id, quote, body) => void handleComment(id, quote, body)}
					onSpanClick={onSpanClick}
				/>
			) : null}
		</div>
	);
}
