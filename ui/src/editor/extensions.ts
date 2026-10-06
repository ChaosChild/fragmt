import {
	Extension,
	type Extensions,
	Mark,
	mergeAttributes,
	Node,
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
import type { MarkdownSerializerState } from "prosemirror-markdown";
import {
	Markdown,
	type MarkdownMarkSpec,
	type MarkdownNodeSpec,
	type MarkdownStorage,
} from "tiptap-markdown";
// "./slash.js" (not "./slash"): this file is typechecked by BOTH configs –
// the root nodenext program reaches it via tests/roundtrip.test.ts.
import {
	type AtDoc,
	type AtKeydownHandler,
	AtReferences,
	type AtRenderer,
} from "./at.js";
import { DeadLinks } from "./dead-links.js";
import {
	SlashCommands,
	type SlashKeydownHandler,
	type SlashRenderer,
	slashItems,
} from "./slash.js";

// tiptap-markdown attaches `storage.markdown` but doesn't augment the core
// Storage interface itself – do it here so every consumer is typed.
declare module "@tiptap/core" {
	interface Storage {
		markdown: MarkdownStorage;
	}
}

/**
 * Comment anchor mark (ARCHITECTURE §2): a ProseMirror mark carrying only an
 * id, serialized into markdown as `<span data-c="...">text</span>`.
 * TypeScript port of the spike's mark – behavior unchanged on purpose; the
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
	// fallback for unconfigured marks serializes through renderHTML – the
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
		// tabindex/role make the read-mode highlight a keyboard-reachable
		// jump-to-thread control (app.html's reference markup) – the staged
		// .comment-highlight:focus-visible ring exists for exactly this.
		// ponytail: attrs stay on in edit mode too (renderHTML has no mode
		// context); tab stops inside the editable are the accepted ceiling.
		return [
			"span",
			mergeAttributes(
				{
					class: "comment-highlight",
					tabindex: "0",
					role: "button",
					title: "View comment",
				},
				HTMLAttributes,
			),
			0,
		];
	},
});

/**
 * Pipe escaping inside GFM table cells (#56). tiptap-markdown's table
 * serializer writes cell text through prosemirror-markdown's esc(), which
 * never escapes `|` – and markdown-it splits cells on unescaped pipes before
 * inline parsing, so a pipe in a cell shifts the columns on reload (cells
 * beyond the header column count are dropped). GFM's escape inside a cell is
 * `\|` – markdown-it's table rule unescapes it BEFORE inline parsing, so the
 * model text is a bare `|` again and blanket-escaping on the way out is
 * correct. Everywhere else the output must stay byte-identical: the
 * serialization mirrors tiptap-markdown's own text extension
 * (node_modules/tiptap-markdown/src/extensions/nodes/text.js), whose body is
 * `state.text(escapeHTML(node.text))` with escapeHTML = `<`→`&lt;`, `>`→`&gt;`
 * – then the in-table output slice gets `\|` post-applied (esc() never
 * touches `|`, so every `|` in the slice is unescaped content).
 *
 * Replaces StarterKit's text node (configured off below) – the schema spec
 * (group, markdown parse/render) is copied from @tiptap/extension-text v3.
 * KNOWN CEILING: a pipe inside an inline code span in a cell still goes out
 * raw – the code mark serializes with escape:false, so renderInline writes
 * its content through a no-escape branch that skips the text node serializer
 * entirely, and hooks at the mark level cannot intercept that one write (the
 * method value is resolved before its arguments build). The load-time
 * fidelity check (roundtrip.ts) flags any doc that hits this as lossy, so it
 * saves only behind the explicit acknowledge.
 */
export const TablePipeText = Node.create({
	name: "text",
	group: "inline",
	parseMarkdown: (token) => ({
		type: "text",
		text: token.text || "",
	}),
	renderMarkdown: (node) => node.text || "",
	addStorage(): { markdown: MarkdownNodeSpec } {
		return {
			markdown: {
				serialize(state, node) {
					// The runtime state is tiptap-markdown's subclass of
					// prosemirror-markdown's MarkdownSerializerState (its table
					// serializer toggles inTable; `out` is the output buffer).
					const s = state as MarkdownSerializerState & {
						out: string;
						inTable?: boolean;
					};
					const start = s.out.length;
					// Same transform as tiptap-markdown's escapeHTML (not
					// exported): < and > become entities so typed markup
					// cannot re-parse as HTML. Backslashes are left to
					// state.text's esc(), which runs before the pipe pass below
					// – escaping them here as well would get doubled by esc.
					// split/join on purpose: a .replace chain here reads to
					// CodeQL as an incomplete escape (it cannot see esc() two
					// stages later) and fails the CI gate.
					const text = node.text ?? "";
					state.text(text.split("<").join("&lt;").split(">").join("&gt;"));
					if (s.inTable) {
						s.out = `${s.out.slice(0, start)}${s.out
							.slice(start)
							.replace(/\|/g, "\\|")}`;
					}
				},
			},
		};
	},
});

/**
 * tiptap-markdown's tight-lists extension only covers bulletList/orderedList –
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
 * The editor's extension set – single source of truth. The React editor AND
 * tests/roundtrip.test.ts both build from this factory, so any change to the
 * editor config is judged by the permanent corpus gate.
 *
 * The optional callbacks wire the slash menu's UI (state/keydown/image handoff)
 * without making the extension set React-bound – headless consumers omit them.
 */
export function editorExtensions(
	slash?: {
		onState?: SlashRenderer;
		onKeyDown?: SlashKeydownHandler;
		onImage?: (insertAt: number) => void;
	},
	// The @ references (M4-2 item 5) – omitted by headless consumers, in
	// which case the extension is NOT added at all (mirrors slash's
	// optionality one step further: no docs, no plugin, no corpus impact).
	at?: {
		docs: () => AtDoc[];
		docPath?: () => string;
		onState?: AtRenderer;
		onKeyDown?: AtKeydownHandler;
	},
	// Broken doc links (owner round) – omitted headless, like at.
	dead?: { isDead: (href: string) => boolean },
): Extensions {
	return [
		// openOnClick off in BOTH directions: Tiptap's own click plugin
		// window.opens on plain clicks in edit mode, and read mode would
		// fall through to browser navigation – EditorPane's onClick is the
		// single click authority (doc → in-app, external → new tab).
		// text off: TablePipeText below replaces it (the pipe-escaping
		// markdown serializer, #56) – a second `text` extension would be a
		// duplicate-name collision where only one storage wins.
		StarterKit.configure({ link: { openOnClick: false }, text: false }),
		CommentMark,
		TablePipeText,
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
		...(at ? [AtReferences.configure(at)] : []),
		...(dead ? [DeadLinks.configure(dead)] : []),
		Markdown.configure({ html: true }),
	];
}
