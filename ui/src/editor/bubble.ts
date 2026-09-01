import type { EditorState } from "@tiptap/pm/state";
import { NodeSelection } from "@tiptap/pm/state";

/**
 * When the formatting bubble is visible (M2-2): an explicit right-click
 * (forced), a selected image node, or a non-empty selection. Never on a bare
 * cursor – it must not sit over text while the user types.
 *
 * React-free on purpose: tests import it directly under the root program.
 */
export function shouldShowBubble(state: EditorState, forced: boolean): boolean {
	if (forced) return true;
	if (state.selection instanceof NodeSelection) {
		return state.selection.node.type.name === "image";
	}
	return !state.selection.empty;
}
