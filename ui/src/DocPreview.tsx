import type { DocResponse } from "./api";
import { EditorPane } from "./EditorPane";
import type { AtDoc } from "./editor/at";

/**
 * The slideout's Preview mode (#15 b4): the linked doc as a second,
 * READ-ONLY EditorPane. Every edit surface is inert by wiring — the comment
 * bubble and highlight jumps are off (`commenting: false`), the save/cancel
 * keys are editable-gated — and the one live interaction is the point: doc
 * links re-target the preview itself (App's previewPath), so following a
 * trail never touches the editor's doc or its buffer. Non-doc links keep
 * the main pane's dispatch: external and raw open tabs, folders expand the
 * sidebar, dead links get this pane's quiet note.
 */
export function DocPreview({
	path,
	doc,
	error,
	deadLink,
	anchor,
	onAnchorConsumed,
	docs,
	folders,
	onSelectDoc,
	onSelectFolder,
	onLinkNotFound,
}: {
	/** The previewed docsRoot-relative path (App owns it and the fetch). */
	path: string | null;
	/** The fetched doc; null while loading, and on error. */
	doc: DocResponse | null;
	/** The load failed — the quiet inline message (missing doc, network). */
	error: string | null;
	/** A dead .md link was clicked in the preview — the quiet note. */
	deadLink: string | null;
	/** A #fragment pending scroll inside the preview (App owns it). */
	anchor: string | null;
	onAnchorConsumed: () => void;
	/** The tree's docs — the preview's own link dispatch. */
	docs: AtDoc[];
	/** The tree's folders — the preview's own link dispatch. */
	folders: string[];
	/** A doc link resolved in the preview — re-target the preview (App). */
	onSelectDoc: (path: string, anchor?: string) => void;
	/** A folder link resolved in the preview — expand the sidebar (App). */
	onSelectFolder: (path: string) => void;
	/** A relative .md link matched nothing — App notes it here. */
	onLinkNotFound: (href: string) => void;
}) {
	if (!path) {
		return (
			<div className="preview-body">
				<p className="label-meta" style={{ padding: "4px 4px 16px" }}>
					Nothing previewed &mdash; Shift+click a link (or press ⇧↵ in search)
					to read it here.
				</p>
			</div>
		);
	}
	return (
		<div className="preview-body">
			{error && (
				<p className="rail-error" role="status">
					Couldn&rsquo;t load {path} &mdash; {error}
				</p>
			)}
			{!error && deadLink && (
				<p className="rail-error" role="status">
					Link not found &mdash; {deadLink}
				</p>
			)}
			{!error && !doc && (
				// The quiet load state: static skeleton bars, no spinner.
				<div className="preview-skeleton" aria-hidden="true">
					<span />
					<span />
					<span />
				</div>
			)}
			{!error && doc && (
				<EditorPane
					key={doc.path}
					markdown={doc.markdown}
					editable={false}
					commenting={false}
					saving={false}
					// Read mode can't reach these (the keys are editable-gated);
					// the no-ops keep the inert contract explicit.
					onSave={() => {}}
					onCancel={() => {}}
					onComment={() => {}}
					onSpanClick={() => {}}
					docPath={doc.path}
					docs={docs}
					folders={folders}
					onSelectDoc={onSelectDoc}
					// Shift and the hover-↗ zone re-target the preview too —
					// same callback, same destination.
					onOpenPreview={onSelectDoc}
					onSelectFolder={onSelectFolder}
					onLinkNotFound={onLinkNotFound}
					anchor={anchor}
					onAnchorConsumed={onAnchorConsumed}
				/>
			)}
		</div>
	);
}
