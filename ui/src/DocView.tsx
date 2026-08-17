import { useEffect, useRef, useState } from "react";
import { type DocResponse, SaveError, saveDoc } from "./api";
import { EditorPane, type EditorPaneHandle } from "./EditorPane";

const PencilIcon = (
	<svg
		aria-hidden="true"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth={2}
		strokeLinecap="round"
		strokeLinejoin="round"
	>
		<path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
	</svg>
);

/**
 * The doc pane: reading mode by default (DESIGN §3), one explicit Edit action
 * flips the SAME mounted Tiptap editor to editable (M4 review decision 3 —
 * one rendering path, no reflow between modes). Save commits via PUT; a 409
 * shows a non-destructive banner and keeps the user's buffer (M2 spec).
 */
export function DocView({
	doc,
	selected,
	onSaved,
	onReload,
	onDirtyChange,
	pendingBranch,
	onPendingBranchCancel,
	onPendingBranchGo,
	conflict,
	onDismissConflict,
	onBeforeEdit,
}: {
	doc: DocResponse | null;
	selected: string | null;
	onSaved: (doc: DocResponse) => void;
	onReload: () => void;
	onDirtyChange: (dirty: boolean) => void;
	/** A branch switch waiting on the save-or-discard choice (M3). */
	pendingBranch: string | null;
	onPendingBranchCancel: () => void;
	onPendingBranchGo: () => void;
	/** Sync conflict message (M3) — the calm banner, never a merge UI. */
	conflict: string | null;
	onDismissConflict: () => void;
	onBeforeEdit: () => void;
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

	async function handleSave(): Promise<boolean> {
		if (!doc || saving) return false;
		const markdown = editorRef.current?.getMarkdown() ?? "";
		setSaving(true);
		setSaveError(null);
		try {
			const { hash } = await saveDoc(doc.path, markdown, doc.hash);
			setEditing(false);
			setDirty(false);
			setConfirmingCancel(false);
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

	// One rendering path (M4 review decision 3): the editor is mounted in
	// BOTH modes — read is `editable: false` on the same instance, Edit/Save/
	// Cancel are mode flips with no remount (only a discard bumps the key to
	// drop the buffer). The pane classes share their layout rule; the editor
	// carries the `markdown` typography class, so the document reads
	// identically in both modes (M2 pixel parity).
	return (
		<div className={editing ? "editor-pane" : "doc-pane"} ref={paneRef}>
			<div className="doc-bar">
				{breadcrumb}
				<div className="doc-actions">
					{editing ? (
						<>
							<button
								type="button"
								className="iconbtn subtle"
								onClick={requestCancel}
								disabled={saving}
							>
								Cancel
							</button>
							<button
								type="button"
								className="iconbtn primary"
								onClick={() => void handleSave()}
								disabled={saving}
							>
								{saving ? "Saving…" : "Save"}
							</button>
						</>
					) : (
						<button
							type="button"
							className="iconbtn"
							onClick={() => {
								onBeforeEdit();
								setEditing(true);
								setSaveError(null);
							}}
							disabled={!doc}
						>
							{PencilIcon}
							Edit
						</button>
					)}
				</div>
			</div>
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
				/>
			) : null}
		</div>
	);
}
