import { type ChainedCommands, Extension } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion, { type SuggestionProps } from "@tiptap/suggestion";

/**
 * The slash menu (M2-2): typing "/" starts an item query, filtering the list
 * below. Items run Tiptap commands against a chain that has already deleted
 * the "/query" range – the slash text is command syntax, never content.
 * The `image` item is intercepted by the UI (`popover: true`) which opens the
 * URL/alt form instead of running a command.
 */
export interface SlashItem {
	id: string;
	label: string;
	hint?: string;
	keywords?: string;
	popover?: boolean;
	run?: (chain: ChainedCommands) => boolean;
}

export interface SlashMenuState {
	query: string;
	items: SlashItem[];
	range: { from: number; to: number };
	/** Delete "/query", then run the item (or hand off to the image popover). */
	execute: (item: SlashItem) => void;
	/** Dismiss the menu and delete the "/query" text. */
	dismiss: () => void;
}

export type SlashRenderer = (state: SlashMenuState | null) => void;
export type SlashKeydownHandler = (event: KeyboardEvent) => boolean;

export const slashItems: SlashItem[] = [
	{
		id: "text",
		label: "Text",
		keywords: "paragraph plain body",
		run: (c) => c.setParagraph().run(),
	},
	{
		id: "h1",
		label: "Heading 1",
		keywords: "title header",
		run: (c) => c.setHeading({ level: 1 }).run(),
	},
	{
		id: "h2",
		label: "Heading 2",
		keywords: "subtitle header",
		run: (c) => c.setHeading({ level: 2 }).run(),
	},
	{
		id: "h3",
		label: "Heading 3",
		keywords: "header",
		run: (c) => c.setHeading({ level: 3 }).run(),
	},
	{
		id: "quote",
		label: "Quote",
		keywords: "blockquote callout",
		run: (c) => c.setBlockquote().run(),
	},
	{
		id: "code",
		label: "Code block",
		keywords: "code fence monospace",
		run: (c) => c.setCodeBlock().run(),
	},
	{
		id: "bullet",
		label: "Bullet list",
		keywords: "unordered list",
		run: (c) => c.toggleBulletList().run(),
	},
	{
		id: "numbered",
		label: "Numbered list",
		keywords: "ordered list",
		run: (c) => c.toggleOrderedList().run(),
	},
	{
		id: "task",
		label: "Task list",
		keywords: "todo checkbox",
		run: (c) => c.toggleTaskList().run(),
	},
	{
		id: "divider",
		label: "Divider",
		keywords: "hr rule separator line",
		run: (c) => c.setHorizontalRule().run(),
	},
	{
		id: "table",
		label: "Table",
		hint: "3×3 + header",
		keywords: "grid cells rows columns",
		run: (c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
	},
	{
		id: "image",
		label: "Image",
		hint: "URL + alt",
		keywords: "picture photo img",
		popover: true,
	},
];

export function filterSlashItems(
	items: SlashItem[],
	query: string,
): SlashItem[] {
	const q = query.trim().toLowerCase();
	if (!q) return items;
	return items.filter((item) =>
		`${item.label} ${item.keywords ?? ""}`.toLowerCase().includes(q),
	);
}

export interface SlashCommandsOptions {
	items: SlashItem[];
	/** Called with menu state on open/change, and with null on close. */
	onState?: SlashRenderer;
	/** Keydown while the menu is open (arrows/enter/escape); true = handled. */
	onKeyDown?: SlashKeydownHandler;
	/** The image item: insertion position after the "/query" range is deleted. */
	onImage?: (insertAt: number) => void;
}

export const SlashPluginKey = new PluginKey("slashCommandsMenu");

export const SlashCommands = Extension.create<SlashCommandsOptions>({
	name: "slashCommands",

	addOptions() {
		return { items: slashItems };
	},

	addProseMirrorPlugins() {
		const { items, onState, onKeyDown, onImage } = this.options;
		return [
			Suggestion({
				editor: this.editor,
				pluginKey: SlashPluginKey,
				char: "/",
				items: ({ query }) => filterSlashItems(items, query),
				command: ({ editor, range, props: item }) => {
					if (item.popover) {
						editor.chain().focus().deleteRange(range).run();
						onImage?.(range.from);
						return;
					}
					item.run?.(editor.chain().focus().deleteRange(range));
				},
				render: () => ({
					onStart: (props) => onState?.(toMenuState(props)),
					onUpdate: (props) => onState?.(toMenuState(props)),
					onExit: () => onState?.(null),
					onKeyDown: ({ event }) => onKeyDown?.(event) ?? false,
				}),
			}),
		];
	},
});

function toMenuState(props: SuggestionProps<SlashItem>): SlashMenuState {
	return {
		query: props.query,
		items: props.items,
		range: props.range,
		// props.command wraps the item with editor/range itself – pass the bare item.
		execute: (item) => props.command(item),
		dismiss: () => props.editor.chain().focus().deleteRange(props.range).run(),
	};
}
