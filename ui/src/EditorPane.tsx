import type { Editor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";
import { EditorContent, useEditor } from "@tiptap/react";
import {
	type Ref,
	useEffect,
	useImperativeHandle,
	useRef,
	useState,
} from "react";
import type { AtDoc, AtMenuState } from "./editor/at";
import { BubbleToolbar } from "./editor/BubbleToolbar";
import { editorExtensions } from "./editor/extensions";
import { ImagePopover } from "./editor/ImageForm";
import { resolveLinkTarget, slugifyHeading } from "./editor/links";
import { SlashMenuView } from "./editor/SlashMenu";
import type { SlashMenuState } from "./editor/slash";

export interface EditorPaneHandle {
	getMarkdown(): string;
}

/** Scroll a heading id into view – the anchor dispatch's one action (M4-3
 *  b6). Scoped to THIS editor's DOM (#15): the slideout preview is a second
 *  EditorPane, and both panes slug the same heading texts to the same ids –
 *  a document-wide lookup could scroll the wrong one. */
function scrollToHeadingId(editor: Editor, id: string) {
	editor.view.dom
		.querySelector(`#${CSS.escape(id)}`)
		?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/**
 * The Tiptap pane – one rendering path for both modes (M4 review decision 3):
 * read mode is this same editor with `editable: false`, so a read-mode
 * selection maps to exact ProseMirror positions and entering edit is a mode
 * flip on the mounted editor (no remount, no reflow). Mounts fresh per doc
 * (keyed by path), loads the body through tiptap-markdown's setContent, and
 * hands the serialized markdown back via `onSave`. Esc cancels, Ctrl/Cmd+S
 * saves (DESIGN §8). M2-2 adds the contextual formatting surfaces:
 * right-click bubble, slash menu, and the image popover – edit-mode only.
 * M4 mounts the bubble in BOTH modes: read mode carries only the comment
 * action, whose anchoring flow (`onComment`) runs on the non-editable
 * instance without ever flipping the mode (review decision 3).
 */
export function EditorPane({
	markdown,
	editable,
	onSave,
	onCancel,
	onEscapeSurfacesClear,
	onComment,
	onSpanClick,
	saving,
	onDirtyChange,
	docPath,
	docs,
	folders,
	onSelectDoc,
	onOpenPreview,
	onSelectFolder,
	onLinkNotFound,
	anchor,
	onAnchorConsumed,
	commenting = true,
	spanTitleFor,
	ref,
}: {
	markdown: string;
	editable: boolean;
	onSave: (markdown: string) => void;
	onCancel: () => void;
	/** The Escape chain's slideout slot (#15 b5): App's
	 *  close-slideout-if-open, called in EDIT mode once popover/slash/@/bubble
	 *  are clear and the selection is collapsed. True = the pane was open and
	 *  just closed (the Escape is spent, edit-cancel keeps the next press);
	 *  false/absent = nothing was open, fall through to onCancel. Read mode
	 *  needs no leg here – PM never runs keydown on a non-editable view, so
	 *  its un-consumed Escapes reach App's window fallback instead. */
	onEscapeSurfacesClear?: () => boolean;
	onComment: (id: string, quote: string, body: string) => void;
	/** A comment highlight (span[data-c]) was activated – jump the rail to it. */
	onSpanClick: (id: string) => void;
	saving: boolean;
	onDirtyChange?: (dirty: boolean) => void;
	/** The open doc's docsRoot-relative path – the base link resolution joins. */
	docPath: string;
	/** The tree's docs – @ menu items and the known-path set for link clicks. */
	docs: AtDoc[];
	/** The tree's folder paths – the link dispatch's folder set (M4-3 b6). */
	folders: string[];
	/** An in-doc link resolved to a tree doc – navigate in-app (App), with the
	 *  #fragment when the link carried one (scrolled after the doc loads). */
	onSelectDoc: (path: string, anchor?: string) => void;
	/** A doc-link click chose the slideout (#15, dogfooded): edit-mode
	 *  Ctrl/Cmd and read-mode Shift – the buffer is never navigated away. */
	onOpenPreview: (path: string, anchor?: string) => void;
	/** A link resolved to a tree folder – App expands it in the sidebar. */
	onSelectFolder: (path: string) => void;
	/** A relative link matched nothing and ends .md – DocView shows the note. */
	onLinkNotFound: (href: string) => void;
	/** A cross-doc #fragment pending scroll after this doc's content loads. */
	anchor?: string | null;
	/** The pending anchor was consumed (scrolled or dropped) – App clears it. */
	onAnchorConsumed: () => void;
	/** The read-mode comment surfaces – the bubble and highlight jumps. False
	 *  for the slideout preview (#15): its editor is a viewer, selections
	 *  there are just selections. */
	commenting?: boolean;
	/** Per-span tooltip text (dogfood round, #15): the preview overrides the
	 *  mark's static "View comment" with the thread's summary – see the
	 *  title pass below. Absent = the mark's own title stands. */
	spanTitleFor?: (id: string) => string;
	ref?: Ref<EditorPaneHandle>;
}) {
	const [slashState, setSlashState] = useState<SlashMenuState | null>(null);
	const [atState, setAtState] = useState<AtMenuState | null>(null);
	const [imageAt, setImageAt] = useState<number | null>(null);
	const [bubbleOpen, setBubbleOpen] = useState(false);
	const [dirty, setDirty] = useState(false);
	const slashKeydown = useRef<(event: KeyboardEvent) => boolean>(() => false);
	const atKeydown = useRef<(event: KeyboardEvent) => boolean>(() => false);
	// A getter over the ref keeps the @ menu's doc list live across tree
	// refreshes – the extension captured it once at plugin creation.
	const docsRef = useRef(docs);
	docsRef.current = docs;
	const knownDocPaths = new Set(docs.map((d) => d.path));
	const knownFolderPaths = new Set(folders);

	const editor = useEditor({
		extensions: editorExtensions(
			{
				onState: setSlashState,
				onKeyDown: (event) => slashKeydown.current(event),
				onImage: (insertAt) => setImageAt(insertAt),
			},
			{
				docs: () => docsRef.current,
				onState: setAtState,
				onKeyDown: (event) => atKeydown.current(event),
			},
		),
		content: "",
		editable,
		// Focus is the editable-flip effect's job – read mode never
		// autofocuses, edit mode focuses on flip (autofocus here would grab
		// focus on a read-mode mount).
		autofocus: false,
		// The content-editable div carries the read-mode typography class, so
		// edit mode IS the rendered document (DESIGN: "Editor (M2)") – no
		// reflow, no re-skin.
		editorProps: { attributes: { class: "markdown" } },
	});
	// The tiptap-markdown override of setContent parses markdown; the plain
	// `content` option would be read as HTML. Loading a doc resets dirty –
	// the setContent dispatch would otherwise count as a change. setContent
	// is a whole-doc replace that maps the caret to the END, so the
	// Edit-flip focus() would scroll the end into view; reset the selection
	// to the doc start right after it (position 0 clamps to the first valid
	// text position) and the caret matches the visible top. A selection-only
	// command never sets docChanged (dirty stays false), and it is safe in
	// read mode – the non-editable view stays focusable.
	useEffect(() => {
		editor?.commands.setContent(markdown);
		editor?.commands.setTextSelection(0);
		// Heading ids (M4-3 b6), both modes – one code path: #fragment and
		// doc#frag links scroll to these. A cheap idempotent walk per doc
		// load; the ids live only in the rendered DOM, never the markdown.
		const seen = new Set<string>();
		for (const el of Array.from(
			editor?.view.dom.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6") ?? [],
		)) {
			el.id = slugifyHeading(el.textContent ?? "", seen);
		}
		setDirty(false);
	}, [editor, markdown]);

	// A cross-doc #fragment (a doc link click carried one): scroll once the
	// new content and its heading ids exist (the load effect above runs first
	// in the same commit), then hand the anchor back – App clears it either
	// way, so an unknown fragment never scrolls a later, unrelated doc.
	useEffect(() => {
		if (!editor || !anchor) return;
		scrollToHeadingId(editor, anchor);
		onAnchorConsumed();
	}, [editor, anchor, onAnchorConsumed]);

	// Span-title pass (dogfood round, #15): the mark renders a static
	// "View comment"; a pane that knows the sidecar (the preview) rewrites
	// each span's title from it. The heading-id walk's pattern – ids/titles
	// live only in the rendered DOM – re-run on content load AND when the
	// caller's function changes identity (its map landed after the render).
	// biome-ignore lint/correctness/useExhaustiveDependencies: markdown is the content-load signal – a same-path refetch re-renders the spans with the mark's default title, and the walk must fire again; spanTitleFor's identity alone can miss it.
	useEffect(() => {
		if (!editor || !spanTitleFor) return;
		for (const el of Array.from(
			editor.view.dom.querySelectorAll<HTMLElement>("span[data-c]"),
		)) {
			el.title = spanTitleFor(el.getAttribute("data-c") ?? "");
		}
	}, [editor, markdown, spanTitleFor]);

	// Edit/Cancel flips editability on the SAME mounted editor – the DOM
	// never rebuilds, so the text cannot reflow (M2 rule). A stale bubble
	// flag (bubble open when Save was clicked) would eat one Escape later;
	// clear it on the way out. Tiptap's built-in tabindex extension keeps
	// the non-editable view focusable, so selections work in read mode.
	useEffect(() => {
		if (!editor) return;
		editor.setEditable(editable);
		if (editable) editor.commands.focus();
		else setBubbleOpen(false);
	}, [editor, editable]);

	// Dirty = any doc-changing transaction since load (DocView uses it to
	// confirm before dropping the buffer).
	useEffect(() => {
		if (!editor) return;
		const onTransaction = ({ transaction }: { transaction: Transaction }) => {
			if (transaction.docChanged) setDirty(true);
		};
		editor.on("transaction", onTransaction);
		return () => {
			editor.off("transaction", onTransaction);
		};
	}, [editor]);

	useEffect(() => {
		onDirtyChange?.(dirty);
	}, [dirty, onDirtyChange]);

	useImperativeHandle(
		ref,
		() => ({
			getMarkdown: () => editor?.storage.markdown.getMarkdown() ?? "",
		}),
		[editor],
	);

	if (!editor) return null;

	return (
		<>
			<EditorContent
				editor={editor}
				className="edit-area"
				aria-label="Document editor"
				// Highlight jumps (M4-5) and link clicks (M4-2), delegated over
				// the editor DOM. Edit mode is excluded from span jumps (clicks
				// are selection there) and follows links only on Ctrl/Cmd; a
				// drag selection landing on the target doesn't fire either.
				// M4-3 b6 widens the dispatch: anchors, folder links, raw
				// assets, and dead .md links (links.ts' table is normative).
				onClick={(e) => {
					// #15, dogfooded 2026-08-26: read mode's drag guard exempts
					// Shift (Shift+click opens the preview AND extends the
					// browser selection – the intent is the click). Edit mode:
					// a plain click is normal editing – cursor placement, PM's
					// default, nothing opens; Ctrl/Cmd is v0.5.0's
					// ctrl-to-follow, retargeted at the preview for doc links.
					if (!editable && !e.shiftKey && !window.getSelection()?.isCollapsed)
						return;
					const follows = !editable || e.ctrlKey || e.metaKey;
					const target = e.target as HTMLElement;
					const span = target.closest("[data-c]");
					if (span) {
						if (follows && commenting)
							onSpanClick(span.getAttribute("data-c") ?? "");
						return;
					}
					if (!follows) return;
					const anchorEl = target.closest("a[href]");
					if (!anchorEl) return;
					const href = anchorEl.getAttribute("href") ?? "";
					const resolved = resolveLinkTarget(
						href,
						docPath,
						knownDocPaths,
						knownFolderPaths,
					);
					switch (resolved.kind) {
						case "doc":
							e.preventDefault();
							// Same doc + fragment: no reload – scroll in place.
							if (resolved.anchor && resolved.path === docPath) {
								scrollToHeadingId(editor, resolved.anchor);
							} else if (editable || e.shiftKey) {
								// #15: edit mode's Ctrl/Cmd and read mode's Shift
								// open the slideout preview – the buffer is never
								// navigated away from. A plain read click keeps
								// the navigate; App guards it.
								onOpenPreview(resolved.path, resolved.anchor);
							} else {
								onSelectDoc(resolved.path, resolved.anchor);
							}
							break;
						case "anchor":
							e.preventDefault();
							scrollToHeadingId(editor, resolved.id);
							break;
						case "folder":
							e.preventDefault();
							onSelectFolder(resolved.path);
							break;
						case "raw":
							e.preventDefault();
							window.open(
								`/api/raw/${encodeURI(resolved.path)}`,
								"_blank",
								"noopener,noreferrer",
							);
							break;
						case "dead":
							e.preventDefault();
							onLinkNotFound(resolved.href);
							break;
						case "external":
							e.preventDefault();
							window.open(href, "_blank", "noopener,noreferrer");
							break;
						default:
							// default: leave the browser to it.
							break;
					}
				}}
				onKeyDown={(e) => {
					// Read mode owns no edit-session keys – Esc just clears
					// the selection (the bubble's capture listener, which
					// consumes the event; PM never runs keydown on a
					// non-editable view, so an Esc with no bubble reaches
					// App's window fallback and can close the slideout, #15
					// b5), Ctrl+S would save a buffer the user cannot see
					// they are editing. Enter/Space on a focused highlight
					// (the mark carries tabindex) jumps to its thread instead.
					if (!editable) {
						const span = (e.target as HTMLElement).closest("[data-c]");
						if (span && commenting && (e.key === "Enter" || e.key === " ")) {
							e.preventDefault();
							onSpanClick(span.getAttribute("data-c") ?? "");
						}
						return;
					}
					// Escape order (#15 b5): popover → slash menu → bubble →
					// selection → slideout → edit-cancel-with-confirm. Each
					// surface dismisses itself first; the bubble runs a
					// capture-phase listener, so by the time Escape reaches
					// here no surface is open. (The editor preventDefaults
					// every Escape, so defaultPrevented cannot detect
					// consumption elsewhere.)
					if (e.key === "Escape") {
						e.preventDefault();
						if (slashState || atState || imageAt !== null || bubbleOpen) return;
						if (!editor.state.selection.empty) {
							// Clears the selection, which hides the bubble.
							editor
								.chain()
								.focus()
								.setTextSelection(editor.state.selection.to)
								.run();
						} else {
							// The slideout slot (#15 b5): a true return means
							// the pane was open and just closed – the Escape
							// is spent; edit-cancel keeps the next press.
							if (!onEscapeSurfacesClear?.()) onCancel();
						}
					} else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
						e.preventDefault();
						if (!saving) onSave(editor.storage.markdown.getMarkdown());
					}
				}}
			/>
			{/* The bubble is a commenting surface – the preview (commenting:
				    false) doesn't mount it; its read-only selections are just
				    selections (#15). */}
			{commenting && (
				<BubbleToolbar
					editor={editor}
					editable={editable}
					onComment={onComment}
					onVisibilityChange={setBubbleOpen}
				/>
			)}
			{editable && slashState && (
				// Keyed by query: a new filter remounts the menu, resetting the
				// highlight to the first item.
				<SlashMenuView
					key={slashState.query}
					editor={editor}
					state={slashState}
					registerKeydown={(handler) => {
						slashKeydown.current = handler;
					}}
				/>
			)}
			{editable && imageAt !== null && (
				<ImagePopover
					editor={editor}
					insertAt={imageAt}
					onClose={() => setImageAt(null)}
				/>
			)}
			{editable && atState && (
				// Same shape as the slash menu – keyed by query so a new filter
				// remounts it, resetting the highlight to the first item.
				<SlashMenuView
					key={`at-${atState.query}`}
					editor={editor}
					state={atState}
					ariaLabel="Reference a document"
					registerKeydown={(handler) => {
						atKeydown.current = handler;
					}}
				/>
			)}
		</>
	);
}
