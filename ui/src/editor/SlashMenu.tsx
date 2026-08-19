import type { Editor } from "@tiptap/core";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * The minimal item shape the menu renders — slash items and @ reference
 * items (at.ts) both satisfy it, so one component serves both menus.
 */
export type MenuItem = { id: string; label: string; hint?: string };

export type MenuState<T extends MenuItem> = {
	query: string;
	items: T[];
	range: { from: number; to: number };
	/** Delete the trigger+query, then run the item (or hand off to a popover). */
	execute: (item: T) => void;
	/** Dismiss the menu and delete the trigger+query text. */
	dismiss: () => void;
};

/**
 * The slash menu's React surface (M2-2; shared with the @ menu since M4-2).
 * Suggestion owns trigger/query/exit and hands state over via the
 * extension's onState callback; this component renders the filtered list,
 * positions it at the caret, and answers the extension's keydown callback
 * for ↑/↓/Enter/Escape.
 *
 * Positioning clamps against the MEASURED menu height (flips above the caret
 * when there is no room below) and follows scroll/resize — a position:fixed
 * menu otherwise strands bottom items off-screen while the page scrolls.
 */
export function SlashMenuView<T extends MenuItem>({
	editor,
	state,
	registerKeydown,
	ariaLabel = "Insert block",
}: {
	editor: Editor;
	state: MenuState<T>;
	registerKeydown: (handler: (event: KeyboardEvent) => boolean) => void;
	/** The menu container's accessible name ("Reference a document" for @). */
	ariaLabel?: string;
}) {
	const [selected, setSelected] = useState(0);
	const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
	const menuRef = useRef<HTMLDivElement>(null);
	const stateRef = useRef(state);
	const selectedRef = useRef(0);

	useEffect(() => {
		stateRef.current = state;
	}, [state]);
	useEffect(() => {
		selectedRef.current = selected;
	}, [selected]);

	useLayoutEffect(() => {
		const place = () => {
			const el = menuRef.current;
			if (!el) return;
			const coords = editor.view.coordsAtPos(state.range.from);
			const height = el.offsetHeight;
			const width = el.offsetWidth;
			let top = coords.bottom + 6;
			if (top + height > window.innerHeight - 8) {
				top = Math.max(8, coords.top - height - 6); // flip above the caret
			}
			const left = Math.max(
				8,
				Math.min(coords.left, window.innerWidth - width - 8),
			);
			setPos({ top, left });
		};
		// The menu renders hidden until first placement, so offsetHeight is
		// measurable before it becomes visible.
		place();
		window.addEventListener("scroll", place, true);
		window.addEventListener("resize", place);
		return () => {
			window.removeEventListener("scroll", place, true);
			window.removeEventListener("resize", place);
		};
		// `state` (not just range.from): every keystroke moves the caret and
		// can change the filtered list's height — both need re-placement.
	}, [editor, state]);

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

	return (
		<div
			ref={menuRef}
			className="slash-menu"
			role="menu"
			aria-label={ariaLabel}
			tabIndex={-1}
			aria-activedescendant={
				state.items[selected] ? `slash-${state.items[selected].id}` : undefined
			}
			style={{ ...pos, visibility: pos ? "visible" : "hidden" }}
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
