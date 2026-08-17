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
import { Placeholder } from "@tiptap/extensions/placeholder";
import StarterKit from "@tiptap/starter-kit";
import {
	Markdown,
	type MarkdownMarkSpec,
	type MarkdownStorage,
} from "tiptap-markdown";
// "./slash.js" (not "./slash"): this file is typechecked by BOTH configs —
// the root nodenext program reaches it via tests/roundtrip.test.ts.
import {
	SlashCommands,
	type SlashKeydownHandler,
	type SlashRenderer,
	slashItems,
} from "./slash.js";

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

	// The DOM render carries .comment-highlight (read-mode visibility, M4).
	// The markdown tags are pinned EXPLICITLY because tiptap-markdown's
	// fallback for unconfigured marks serializes through renderHTML — the
	// class would leak into the saved file and break the corpus gate.
	addStorage(): { markdown: MarkdownMarkSpec } {
		return {
			markdown: {
				serialize: {
					open: (_state, mark) =>
						mark.attrs.dataC ? `<span data-c="${mark.attrs.dataC}">` : "",
					close: (_state, mark) => (mark.attrs.dataC ? "</span>" : ""),
				},
			},
		};
	},

	renderHTML({ HTMLAttributes }) {
		return [
			"span",
			mergeAttributes({ class: "comment-highlight" }, HTMLAttributes),
			0,
		];
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
 * tests/roundtrip.test.ts both build from this factory, so any change to the
 * editor config is judged by the permanent corpus gate.
 *
 * The optional callbacks wire the slash menu's UI (state/keydown/image handoff)
 * without making the extension set React-bound — headless consumers omit them.
 */
export function editorExtensions(slash?: {
	onState?: SlashRenderer;
	onKeyDown?: SlashKeydownHandler;
	onImage?: (insertAt: number) => void;
}): Extensions {
	return [
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
		Placeholder.configure({
			placeholder: 'Type "/" for blocks · right-click to format',
			showOnlyCurrent: true,
		}),
		SlashCommands.configure({ items: slashItems, ...slash }),
		Markdown.configure({ html: true }),
	];
}
