import { Link2, SquareArrowOutUpRight, X } from "lucide-react";
import type { ReactNode, PointerEvent as ReactPointerEvent } from "react";
import { clampSlideoutShare } from "./slideout-geometry";

/**
 * The 7px drag divider between <main> and the slideout pane (#15) – the
 * sidebar resize handle's pattern (SidebarResizeHandle) in percentages
 * instead of pixels: pointer capture carries the drag, App owns the value
 * and persists it on pointerup. Pure decoration for a11y, like the sidebar
 * handle – no keyboard resize; the clamp bounds keep both panes usable.
 */
function SlideoutDivider({
	onShare,
}: {
	/** Clamped share; commit=true fires only on pointerup. */
	onShare: (share: number, commit: boolean) => void;
}) {
	const dragFrom = (e: ReactPointerEvent<HTMLDivElement>) => {
		e.preventDefault();
		e.currentTarget.setPointerCapture(e.pointerId);
	};
	const dragTo = (e: ReactPointerEvent<HTMLDivElement>, commit: boolean) => {
		if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
		// The split is read off the siblings: main's left and the pane's right
		// edges bound the combined area, and both stay fixed through the drag.
		const main =
			e.currentTarget.previousElementSibling?.getBoundingClientRect();
		const pane = e.currentTarget.nextElementSibling?.getBoundingClientRect();
		if (!main || !pane) return;
		onShare(
			clampSlideoutShare((e.clientX - main.left) / (pane.right - main.left)),
			commit,
		);
	};
	return (
		<div
			className="slideout-divider"
			aria-hidden="true"
			onPointerDown={dragFrom}
			onPointerMove={(e) => dragTo(e, false)}
			onPointerUp={(e) => dragTo(e, true)}
			onPointerCancel={(e) =>
				e.currentTarget.releasePointerCapture(e.pointerId)
			}
		/>
	);
}

/**
 * The preview pane (#15, ui v1): the second sheet beside the doc, split by
 * the draggable divider. The head carries the "Preview — <path>" kicker,
 * Link at cursor, open-in-main and close. `open` matters only ≤1180px,
 * where the CSS turns the pane into the bottom sheet. (The comment threads
 * moved into the sheet's margin and the PRs into their drawer and review
 * with ui v1 – this pane is the preview alone.)
 */
export function Slideout({
	open,
	previewPath,
	onPromote,
	onLinkAtCursor,
	onClose,
	onShare,
	children,
}: {
	/** The ≤1180px bottom sheet's open state (App owns it). */
	open: boolean;
	/** The previewed doc's path – the head's kicker. */
	previewPath: string;
	/** The head's open-in-main act (#15): App closes the pane and sends the
	 *  previewed doc through the navigation queue. */
	onPromote: () => void;
	/** "Link at cursor" (ui v1): link the previewed doc at the main
	 *  editor's cursor; null = the main doc isn't being edited (the button
	 *  shows, disabled, saying so). */
	onLinkAtCursor: (() => void) | null;
	onClose: () => void;
	onShare: (share: number, commit: boolean) => void;
	children: ReactNode;
}) {
	return (
		<>
			<SlideoutDivider onShare={onShare} />
			<aside
				className={`slideout preview${open ? " open" : ""}`}
				aria-label="Preview"
			>
				<div className="slideout-head">
					<span className="kicker slideout-kicker" title={previewPath}>
						<span className="type">Preview</span>
						<span className="rule" />
						<span className="kicker-path">{previewPath}</span>
					</span>
					<button
						type="button"
						className="btn line"
						disabled={onLinkAtCursor === null}
						title={
							onLinkAtCursor === null
								? "Start editing the main doc to insert a link"
								: "Insert a link to this doc at the main editor's cursor"
						}
						onClick={onLinkAtCursor ?? undefined}
					>
						<Link2 aria-hidden="true" />
						Link at cursor
					</button>
					{/* Open in main pane (#15): the previewed doc becomes the
					    main one – through the navigation queue. */}
					<button
						type="button"
						className="btn"
						title="Open in main pane"
						aria-label="Open in main pane"
						onClick={onPromote}
					>
						<SquareArrowOutUpRight aria-hidden="true" />
						Open
					</button>
					<button
						type="button"
						className="slideout-close"
						aria-label="Close preview"
						onClick={onClose}
					>
						<X aria-hidden="true" />
					</button>
				</div>
				<div className="slideout-panel">{children}</div>
			</aside>
		</>
	);
}
