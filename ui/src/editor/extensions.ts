import {
	Extension,
	type Extensions,
	Mark,
	mergeAttributes,
} from "@tiptap/core";
import { Image } from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import {
	Table,
	TableCell,
	TableHeader,
	TableRow,
} from "@tiptap/extension-table";
import StarterKit from "@tiptap/starter-kit";
import { Markdown, type MarkdownStorage } from "tiptap-markdown";

// tiptap-markdown attaches `storage.markdown` but doesn't augment the core
// Storage interface itself — do it here so every consumer is typed.
declare module "@tiptap/core" {
	interface Storage {
		markdown: MarkdownStorage;
	}
}

/**
 * Comment anchor mark (ARCHITECTURE §2): a ProseMirror mark carrying only an
 * id, serialized into markdown as `<span data-c="...">text</span>`.
 * TypeScript port of the spike's mark — behavior unchanged on purpose; the
 * round-trip corpus test judges any change to it.
 */
export const CommentMark = Mark.create({
	name: "comment",

	addAttributes() {
		return {
			dataC: {
				default: null,
				parseHTML: (el) => el.getAttribute("data-c"),
				renderHTML: (attrs) => (attrs.dataC ? { "data-c": attrs.dataC } : {}),
			},
		};
	},

	parseHTML() {
		return [{ tag: "span[data-c]" }];
	},

	renderHTML({ HTMLAttributes }) {
		return ["span", mergeAttributes(HTMLAttributes), 0];
	},
});

/**
 * tiptap-markdown's tight-lists extension only covers bulletList/orderedList —
 * taskList serializes loose (blank lines between items), so a single checkbox
 * edit would rewrite the whole list. Mirror its `tight` attribute for taskList
 * (same parsing rule: tight unless the item holds an explicit paragraph).
 */
export const TightTaskList = Extension.create({
	name: "tightTaskList",
	addGlobalAttributes() {
		return [
			{
				types: ["taskList"],
				attributes: {
					tight: {
						default: true,
						parseHTML: (el) =>
							el.getAttribute("data-tight") === "true" ||
							!el.querySelector("p"),
						renderHTML: (attrs) => ({
							class: attrs.tight ? "tight" : null,
							"data-tight": attrs.tight ? "true" : null,
						}),
					},
				},
			},
		];
	},
});

/**
 * The editor's extension set — single source of truth. The React editor AND
 * tests/roundtrip.test.ts both build from this exact array, so any change to
 * the editor config is judged by the permanent corpus gate.
 */
export const editorExtensions: Extensions = [
	StarterKit,
	CommentMark,
	TaskList,
	TaskItem,
	Table,
	TableRow,
	TableCell,
	TableHeader,
	Image,
	TightTaskList,
	Markdown.configure({ html: true }),
];
