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
	ref,
}: {
	markdown: string;
	onSave: (markdown: string) => void;
	onCancel: () => void;
	saving: boolean;
	ref?: Ref<EditorPaneHandle>;
}) {
	const [slashState, setSlashState] = useState<SlashMenuState | null>(null);
	const [imageAt, setImageAt] = useState<number | null>(null);
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
	// `content` option would be read as HTML.
	useEffect(() => {
		editor?.commands.setContent(markdown);
	}, [editor, markdown]);

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
					// Escape order (M2-2): popover → slash menu → selection → edit
					// mode. Note: PM's captureKeyDown preventDefaults every Escape,
					// so defaultPrevented CANNOT be used to detect consumption —
					// gate on the surfaces we know are open instead.
					if (e.key === "Escape") {
						e.preventDefault();
						if (slashState) return; // the slash menu dismisses itself
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
			<BubbleToolbar editor={editor} />
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
