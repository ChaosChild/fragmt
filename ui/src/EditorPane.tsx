import type { Transaction } from "@tiptap/pm/state";
import { EditorContent, useEditor } from "@tiptap/react";
import {
	type Ref,
	useEffect,
	useImperativeHandle,
	useRef,
	useState,
} from "react";
import { BubbleToolbar } from "./editor/BubbleToolbar";
import { editorExtensions } from "./editor/extensions";
import { ImagePopover } from "./editor/ImageForm";
import { SlashMenuView } from "./editor/SlashMenu";
import type { SlashMenuState } from "./editor/slash";

export interface EditorPaneHandle {
	getMarkdown(): string;
}

/**
 * The Tiptap pane — one rendering path for both modes (M4 review decision 3):
 * read mode is this same editor with `editable: false`, so a read-mode
 * selection maps to exact ProseMirror positions and entering edit is a mode
 * flip on the mounted editor (no remount, no reflow). Mounts fresh per doc
 * (keyed by path), loads the body through tiptap-markdown's setContent, and
 * hands the serialized markdown back via `onSave`. Esc cancels, Ctrl/Cmd+S
 * saves (DESIGN §8). M2-2 adds the contextual formatting surfaces:
 * right-click bubble, slash menu, and the image popover — edit-mode only.
 * M4 mounts the bubble in BOTH modes: read mode carries only the comment
 * action, whose anchoring flow (`onComment`) runs on the non-editable
 * instance without ever flipping the mode (review decision 3).
 */
export function EditorPane({
	markdown,
	editable,
	onSave,
	onCancel,
	onComment,
	saving,
	onDirtyChange,
	ref,
}: {
	markdown: string;
	editable: boolean;
	onSave: (markdown: string) => void;
	onCancel: () => void;
	onComment: (id: string, quote: string, body: string) => void;
	saving: boolean;
	onDirtyChange?: (dirty: boolean) => void;
	ref?: Ref<EditorPaneHandle>;
}) {
	const [slashState, setSlashState] = useState<SlashMenuState | null>(null);
	const [imageAt, setImageAt] = useState<number | null>(null);
	const [bubbleOpen, setBubbleOpen] = useState(false);
	const [dirty, setDirty] = useState(false);
	const slashKeydown = useRef<(event: KeyboardEvent) => boolean>(() => false);

	const editor = useEditor({
		extensions: editorExtensions({
			onState: setSlashState,
			onKeyDown: (event) => slashKeydown.current(event),
			onImage: (insertAt) => setImageAt(insertAt),
		}),
		content: "",
		editable,
		// Focus is the editable-flip effect's job — read mode never
		// autofocuses, edit mode focuses on flip (autofocus here would grab
		// focus on a read-mode mount).
		autofocus: false,
		// The content-editable div carries the read-mode typography class, so
		// edit mode IS the rendered document (DESIGN: "Editor (M2)") — no
		// reflow, no re-skin.
		editorProps: { attributes: { class: "markdown" } },
	});
	// The tiptap-markdown override of setContent parses markdown; the plain
	// `content` option would be read as HTML. Loading a doc resets dirty —
	// the setContent dispatch would otherwise count as a change.
	useEffect(() => {
		editor?.commands.setContent(markdown);
		setDirty(false);
	}, [editor, markdown]);

	// Edit/Cancel flips editability on the SAME mounted editor — the DOM
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
				onKeyDown={(e) => {
					// Read mode owns no edit-session keys — Esc just clears
					// the selection (PM's own handling), Ctrl+S would save a
					// buffer the user cannot see they are editing.
					if (!editable) return;
					// Escape order (M2-2): popover → slash menu → bubble →
					// selection → edit-cancel-with-confirm. Each surface
					// dismisses itself first; the bubble runs a capture-phase
					// listener, so by the time Escape reaches here no surface
					// is open. (PM preventDefaults every Escape, so
					// defaultPrevented cannot detect consumption.)
					if (e.key === "Escape") {
						e.preventDefault();
						if (slashState || imageAt !== null || bubbleOpen) return;
						if (!editor.state.selection.empty) {
							// Clears the selection, which hides the bubble.
							editor
								.chain()
								.focus()
								.setTextSelection(editor.state.selection.to)
								.run();
						} else {
							onCancel();
						}
					} else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
						e.preventDefault();
						if (!saving) onSave(editor.storage.markdown.getMarkdown());
					}
				}}
			/>
			<BubbleToolbar
				editor={editor}
				editable={editable}
				onComment={onComment}
				onVisibilityChange={setBubbleOpen}
			/>
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
		</>
	);
}
