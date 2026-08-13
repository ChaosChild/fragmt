import { EditorContent, useEditor } from "@tiptap/react";
import { type Ref, useEffect, useImperativeHandle } from "react";
import { editorExtensions } from "./editor/extensions";

export interface EditorPaneHandle {
	getMarkdown(): string;
}

/**
 * The Tiptap pane. Mounts fresh per edit session (keyed by doc path), loads
 * the body through tiptap-markdown's setContent, and hands the serialized
 * markdown back via `onSave`. Esc cancels, Ctrl/Cmd+S saves (DESIGN §8).
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
	const editor = useEditor({
		extensions: editorExtensions,
		content: "",
		autofocus: true,
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
		<EditorContent
			editor={editor}
			className="edit-area"
			aria-label="Document editor"
			onKeyDown={(e) => {
				if (e.key === "Escape") {
					e.preventDefault();
					onCancel();
				} else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
					e.preventDefault();
					if (!saving) onSave(editor.storage.markdown.getMarkdown());
				}
			}}
		/>
	);
}
