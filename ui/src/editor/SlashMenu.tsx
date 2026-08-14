import type { Editor } from "@tiptap/core";
import { useEffect, useRef, useState } from "react";
import type { SlashMenuState } from "./slash";

/**
 * The slash menu's React surface (M2-2). Suggestion owns trigger/query/exit
 * and hands state over via the extension's onState callback; this component
 * renders the filtered list, positions it at the caret, and answers the
 * extension's keydown callback for ↑/↓/Enter/Escape.
 */
export function SlashMenuView({
	editor,
	state,
	registerKeydown,
}: {
	editor: Editor;
	state: SlashMenuState;
	registerKeydown: (handler: (event: KeyboardEvent) => boolean) => void;
}) {
	const [selected, setSelected] = useState(0);
	const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
	const stateRef = useRef(state);
	const selectedRef = useRef(0);

	useEffect(() => {
		stateRef.current = state;
	}, [state]);
	useEffect(() => {
		selectedRef.current = selected;
	}, [selected]);

	useEffect(() => {
		const coords = editor.view.coordsAtPos(state.range.from);
		setPos({
			top: Math.min(coords.bottom + 6, window.innerHeight - 260),
			left: Math.min(coords.left, window.innerWidth - 290),
		});
	}, [editor, state.range.from]);

	useEffect(() => {
		registerKeydown((event) => {
			const current = stateRef.current;
			if (event.key === "ArrowDown") {
				setSelected((i) => Math.min(i + 1, current.items.length - 1));
				return true;
			}
			if (event.key === "ArrowUp") {
				setSelected((i) => Math.max(0, i - 1));
				return true;
			}
			if (event.key === "Enter") {
				const item = current.items[selectedRef.current];
				if (item) current.execute(item);
				return true;
			}
			if (event.key === "Escape") {
				current.dismiss();
				return true;
			}
			return false;
		});
		return () => registerKeydown(() => false);
	}, [registerKeydown]);

	if (!pos) return null;
	return (
		<div
			className="slash-menu"
			role="menu"
			aria-label="Insert block"
			tabIndex={-1}
			aria-activedescendant={
				state.items[selected] ? `slash-${state.items[selected].id}` : undefined
			}
			style={pos}
		>
			{state.items.map((item, i) => (
				<button
					key={item.id}
					type="button"
					id={`slash-${item.id}`}
					role="menuitem"
					data-selected={i === selected || undefined}
					onMouseEnter={() => setSelected(i)}
					onMouseDown={(e) => e.preventDefault()}
					onClick={() => state.execute(item)}
				>
					<span>{item.label}</span>
					{item.hint && <span className="kbd">{item.hint}</span>}
				</button>
			))}
			{state.items.length === 0 && <p className="slash-empty">No matches</p>}
			<div className="slash-foot">↑↓ navigate · ↵ insert · esc dismiss</div>
		</div>
	);
}
