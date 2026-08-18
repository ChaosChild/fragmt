import { type Editor, Extension } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion, { type SuggestionProps } from "@tiptap/suggestion";

/**
 * The @ reference menu (M4-2 item 5): typing "@" queries the tree's docs
 * (title + docsRoot-relative path) and Enter applies StarterKit's link mark
 * (href = the path verbatim — the form links in docs use, e.g. docs/PLAN.md).
 * Mirrors slash.ts: the extension owns trigger/query/exit and hands the menu
 * state to callbacks, so the React surface lives in the UI and headless
 * builds stay React-free. `docs` is a getter (not an array) so the list
 * stays live across tree refreshes without remounting the editor.
 */
export interface AtDoc {
	/** Display title — the file name without .md. */
	title: string;
	/** docsRoot-relative path — the link href, used verbatim. */
	path: string;
}

export function filterAtDocs(docs: AtDoc[], query: string): AtDoc[] {
	const q = query.trim().toLowerCase();
	if (!q) return docs;
	return docs.filter((d) => `${d.title} ${d.path}`.toLowerCase().includes(q));
}

/** The menu item the shared SlashMenuView renders (its id/label/hint shape). */
export interface AtMenuItem {
	id: string;
	label: string;
	hint: string;
	doc: AtDoc;
}

export interface AtMenuState {
	query: string;
	items: AtMenuItem[];
	range: { from: number; to: number };
	execute: (item: AtMenuItem) => void;
	dismiss: () => void;
}

export type AtRenderer = (state: AtMenuState | null) => void;
export type AtKeydownHandler = (event: KeyboardEvent) => boolean;

/** Delete the "@query" range, then insert the title carrying a link mark. */
export function applyAtReference(
	editor: Editor,
	range: { from: number; to: number },
	doc: AtDoc,
): void {
	// insertContentAt (not insertContent): the position-explicit form
	// Suggestion's range implies — the chain's selection may sit elsewhere.
	editor
		.chain()
		.focus()
		.deleteRange(range)
		.insertContentAt(range.from, {
			type: "text",
			text: doc.title,
			marks: [{ type: "link", attrs: { href: doc.path } }],
		})
		.run();
}

export interface AtReferencesOptions {
	docs: () => AtDoc[];
	/** Called with menu state on open/change, and with null on close. */
	onState?: AtRenderer;
	/** Keydown while the menu is open (arrows/enter/escape); true = handled. */
	onKeyDown?: AtKeydownHandler;
}

export const AtPluginKey = new PluginKey("atReferencesMenu");

export const AtReferences = Extension.create<AtReferencesOptions>({
	name: "atReferences",

	addProseMirrorPlugins() {
		const { docs, onState, onKeyDown } = this.options;
		return [
			Suggestion({
				editor: this.editor,
				pluginKey: AtPluginKey,
				char: "@",
				items: ({ query }) => filterAtDocs(docs(), query),
				command: ({ editor, range, props: doc }) =>
					applyAtReference(editor, range, doc),
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

function toMenuState(props: SuggestionProps<AtDoc>): AtMenuState {
	return {
		query: props.query,
		items: props.items.map((d) => ({
			id: d.path,
			label: d.title,
			hint: d.path,
			doc: d,
		})),
		range: props.range,
		execute: (item) => props.command(item.doc),
		dismiss: () => props.editor.chain().focus().deleteRange(props.range).run(),
	};
}
