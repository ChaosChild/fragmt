import { SquareArrowOutUpRight, X } from "lucide-react";
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
 * The right pane (#15, dogfooded 2026-08-26): the v0.5.0 comments rail,
 * restored as the default – a permanent 316px margin column with the open
 * doc's threads – that widens into the draggable split only while a preview
 * is open (the head row, with the previewed title, open-in-main, and close,
 * exists in that state alone). No mode tabs: the two states are previewPath's
 * presence, nothing to switch. `open` matters only where the CSS turns the
 * pane into the bottom sheet (≤1180px); the head row in the comments state
 * is that sheet's affordance – desktop CSS hides it with the whole head.
 */
export function Slideout({
	open,
	preview,
	commentCount,
	previewTitle,
	led,
	ledLabel,
	onPromote,
	onClose,
	onShare,
	children,
}: {
	/** The ≤1180px bottom sheet's open state (App owns it). */
	open: boolean;
	/** A preview is open – the wide split state, with its head row. */
	preview: boolean;
	/** The comments head's "Comments · N" (the sheet's title line). */
	commentCount: number;
	/** The previewed doc's display title – the head's "Preview · <title>"
	 *  line (null with nothing previewed). */
	previewTitle: string | null;
	/** The sync LED + one-word status (App's), the rail head's right end –
	 *  the v0.5.0 header restored (testing round 2026-08-26). */
	led: string;
	ledLabel: string;
	/** The head's open-in-main act (preview state, #15): App closes the pane
	 *  and sends the previewed doc through the navigation queue. Absent =
	 *  no button (nothing previewed). */
	onPromote?: () => void;
	onClose: () => void;
	onShare: (share: number, commit: boolean) => void;
	children: ReactNode;
}) {
	return (
		<>
			{preview && <SlideoutDivider onShare={onShare} />}
			<aside
				className={`slideout${open ? " open" : ""}${preview ? " preview" : ""}`}
				aria-label={preview ? "Preview" : "Comments"}
			>
				<div className="slideout-head">
					{preview ? (
						previewTitle && (
							<span className="slideout-title" title={previewTitle}>
								Preview · {previewTitle}
							</span>
						)
					) : (
						<span className="slideout-title">Comments · {commentCount}</span>
					)}
					<span className="slideout-spacer" />
					{/* The rail head's right end (v0.5.0): the sync LED + word.
					    Preview state keeps it too – the split hides the sidebar,
					    so this stays the one always-visible sync cue. Hidden
					    ≤1180px (the topbar's LED covers it there). */}
					<span
						className={`sync-indicator${led === "amber" ? " warn" : led === "red" ? " err" : ""}`}
						role="status"
						title={ledLabel}
					>
						<span className={`led ${led}`} aria-hidden="true" />
						{ledLabel}
					</span>
					{/* Open in main pane (#15): the previewed doc becomes the
					    main one – through the navigation queue. The icon reads
					    as move-to-main, not edit. */}
					{preview && onPromote && (
						<button
							type="button"
							className="tool-btn"
							title="Open in main pane"
							aria-label="Open in main pane"
							onClick={onPromote}
						>
							<SquareArrowOutUpRight aria-hidden="true" />
						</button>
					)}
					<button
						type="button"
						className="slideout-close"
						aria-label={preview ? "Close preview" : "Close comments"}
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
