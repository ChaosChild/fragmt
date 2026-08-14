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
 * The Tiptap pane. Mounts fresh per edit session (keyed by doc path), loads
 * the body through tiptap-markdown's setContent, and hands the serialized
 * markdown back via `onSave`. Esc cancels, Ctrl/Cmd+S saves (DESIGN §8).
 * M2-2 adds the contextual formatting surfaces: selection/right-click bubble,
 * slash menu, and the image popover.
 */
export function EditorPane({
	markdown,
	onSave,
	onCancel,
	saving,
	onDirtyChange,
	ref,
}: {
	markdown: string;
	onSave: (markdown: string) => void;
	onCancel: () => void;
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
		autofocus: true,
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
			<BubbleToolbar editor={editor} onVisibilityChange={setBubbleOpen} />
			{slashState && (
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
			{imageAt !== null && (
				<ImagePopover
					editor={editor}
					insertAt={imageAt}
					onClose={() => setImageAt(null)}
				/>
			)}
		</>
	);
}
