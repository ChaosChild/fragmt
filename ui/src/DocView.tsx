import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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
 * swaps to Tiptap. Save commits via PUT; a 409 shows a non-destructive banner
 * and keeps the user's buffer (M2 spec).
 */
export function DocView({
	doc,
	selected,
	onSaved,
	onReload,
}: {
	doc: DocResponse | null;
	selected: string | null;
	onSaved: (doc: DocResponse) => void;
	onReload: () => void;
}) {
	const [editing, setEditing] = useState(false);
	const [saving, setSaving] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);
	const editorRef = useRef<EditorPaneHandle>(null);

	if (!selected) {
		return (
			<div className="doc-pane">
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

	async function handleSave() {
		if (!doc || saving) return;
		const markdown = editorRef.current?.getMarkdown() ?? "";
		setSaving(true);
		setSaveError(null);
		try {
			const { hash } = await saveDoc(doc.path, markdown, doc.hash);
			setEditing(false);
			onSaved({ ...doc, markdown, hash });
		} catch (e) {
			if (e instanceof SaveError && e.status === 409) {
				setSaveError("changed on disk — copy your changes, then reload");
			} else {
				setSaveError(e instanceof Error ? e.message : String(e));
			}
		} finally {
			setSaving(false);
		}
	}

	if (editing && doc) {
		return (
			<div className="editor-pane">
				<div className="doc-bar">
					{breadcrumb}
					<div className="doc-actions">
						<button
							type="button"
							className="iconbtn subtle"
							onClick={() => {
								setEditing(false);
								setSaveError(null);
							}}
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
					</div>
				</div>
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
				<EditorPane
					key={doc.path}
					ref={editorRef}
					markdown={doc.markdown}
					saving={saving}
					onSave={() => void handleSave()}
					onCancel={() => {
						setEditing(false);
						setSaveError(null);
					}}
				/>
			</div>
		);
	}

	return (
		<div className="doc-pane">
			<div className="doc-bar">
				{breadcrumb}
				<div className="doc-actions">
					<button
						type="button"
						className="iconbtn"
						onClick={() => {
							setEditing(true);
							setSaveError(null);
						}}
						disabled={!doc}
					>
						{PencilIcon}
						Edit
					</button>
				</div>
			</div>
			<article className="markdown">
				{doc ? (
					<ReactMarkdown remarkPlugins={[remarkGfm]}>
						{doc.markdown}
					</ReactMarkdown>
				) : null}
			</article>
		</div>
	);
}
