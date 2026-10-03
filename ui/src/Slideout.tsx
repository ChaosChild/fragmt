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
 * The right pane (#15): the draggable split beside main, mounted only for
 * a preview or the PR mode (#27 b4) – the comment threads moved into the
 * sheet's margin with ui v1 (phase 5), and the References mode left for
 * the sheet's Connections. The head row carries the previewed title or the
 * PR line App supplies (PRPane reports it), open-in-main, and close. `open`
 * matters only ≤1180px, where the CSS turns the pane into the bottom
 * sheet. Precedence: a preview wins over the PR mode.
 */
export function Slideout({
	open,
	preview,
	prTitle,
	previewPath,
	onPromote,
	onLinkAtCursor,
	onClose,
	onShare,
	children,
}: {
	/** The ≤1180px bottom sheet's open state (App owns it). */
	open: boolean;
	/** A preview is open – the wide split state, with its head row. */
	preview: boolean;
	/** #27 (b4): the PR mode's head line – "Pull requests · N open" or
	 *  "PR #n · title" (App holds what PRPane reports, with a plain
	 *  "Pull requests" fallback). Non-null = the fourth state, riding the
	 *  same wide split as a preview. */
	prTitle: string | null;
	/** The previewed doc's path – the head's "Preview — <path>" kicker
	 *  (null with nothing previewed). */
	previewPath: string | null;
	/** The head's open-in-main act (preview state, #15): App closes the pane
	 *  and sends the previewed doc through the navigation queue. Absent =
	 *  no button (nothing previewed). */
	onPromote?: () => void;
	/** "Link at cursor" (ui v1): link the previewed doc at the main
	 *  editor's cursor; null = the main doc isn't being edited (the button
	 *  shows, disabled, saying so). */
	onLinkAtCursor?: (() => void) | null;
	onClose: () => void;
	onShare: (share: number, commit: boolean) => void;
	children: ReactNode;
}) {
	// #27 (b4): the wide split serves a preview OR the PR mode – the
	// .preview class is the shared wide machinery (divider, flexed width).
	const wide = preview || prTitle !== null;
	return (
		<>
			{wide && <SlideoutDivider onShare={onShare} />}
			<aside
				className={`slideout${open ? " open" : ""}${wide ? " preview" : ""}`}
				aria-label={preview ? "Preview" : "Pull requests"}
			>
				<div className="slideout-head">
					{preview ? (
						previewPath && (
							<span className="kicker slideout-kicker" title={previewPath}>
								<span className="type">Preview</span>
								<span className="rule" />
								<span className="kicker-path">{previewPath}</span>
							</span>
						)
					) : (
						<span className="slideout-title" title={prTitle ?? undefined}>
							{prTitle}
						</span>
					)}
					<span className="slideout-spacer" />
					{preview && onLinkAtCursor !== undefined && (
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
					)}
					{/* Open in main pane (#15): the previewed doc becomes the
					    main one – through the navigation queue. */}
					{preview && onPromote && (
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
					)}
					<button
						type="button"
						className="slideout-close"
						aria-label={preview ? "Close preview" : "Close pull requests"}
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
