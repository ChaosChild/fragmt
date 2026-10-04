import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/**
 * Links to docs that do not exist (deleted, renamed, never written) render
 * as broken – `.link-dead` plus a title – in read AND edit mode. Pure view
 * decoration: the markdown, and so the diff, never changes. `isDead` is the
 * caller's resolver (EditorPane: links.ts' `dead` kind against the live
 * tree); dispatch a transaction with DEAD_LINKS meta when the tree changes.
 */
export const DeadLinksKey = new PluginKey<DecorationSet>("deadLinks");

function decorate(doc: PMNode, isDead: (href: string) => boolean) {
	const decos: Decoration[] = [];
	doc.descendants((node, pos) => {
		if (!node.isText) return;
		const link = node.marks.find((m) => m.type.name === "link");
		const href = link?.attrs.href;
		if (typeof href === "string" && isDead(href))
			decos.push(
				Decoration.inline(pos, pos + node.nodeSize, {
					class: "link-dead",
					title: `No such document: ${href}`,
				}),
			);
	});
	return DecorationSet.create(doc, decos);
}

export const DeadLinks = Extension.create<{
	isDead: (href: string) => boolean;
}>({
	name: "deadLinks",
	addOptions() {
		return { isDead: () => false };
	},
	addProseMirrorPlugins() {
		const { isDead } = this.options;
		return [
			new Plugin<DecorationSet>({
				key: DeadLinksKey,
				state: {
					init: (_, { doc }) => decorate(doc, isDead),
					apply: (tr, old) =>
						tr.docChanged || tr.getMeta(DeadLinksKey)
							? decorate(tr.doc, isDead)
							: old,
				},
				props: {
					decorations: (state) => DeadLinksKey.getState(state),
				},
			}),
		];
	},
});
