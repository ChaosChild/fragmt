import { X } from "lucide-react";
import type { ReactNode, PointerEvent as ReactPointerEvent } from "react";
import { clampSlideoutShare } from "./slideout-geometry";

/** The slideout's modes (#15): Comments (the old rail's thread list) today;
 *  Preview — the linked doc, read-only — is batch b4. */
export type SlideoutMode = "comments" | "preview";

/**
 * The 7px drag divider between <main> and the slideout pane (#15) — the
 * sidebar resize handle's pattern (SidebarResizeHandle) in percentages
 * instead of pixels: pointer capture carries the drag, App owns the value
 * and persists it on pointerup. Pure decoration for a11y, like the sidebar
 * handle — no keyboard resize; the clamp bounds keep both panes usable.
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
 * The link slideout shell (#15): a right pane beside <main> that replaces
 * the permanent comment rail. Comments mode is the refactored rail content
 * (passed as children); Preview is b4 — its tab renders disabled until that
 * lands. The head carries the mode tabs + close. App owns open/mode/share;
 * ≤1180px the CSS turns the pane into the bottom sheet the rail used to be.
 */
export function Slideout({
	open,
	mode,
	commentCount,
	onModeChange,
	onClose,
	onShare,
	children,
}: {
	open: boolean;
	mode: SlideoutMode;
	/** The Comments tab's count — the old rail title's "Comments · N". */
	commentCount: number;
	onModeChange: (mode: SlideoutMode) => void;
	onClose: () => void;
	onShare: (share: number, commit: boolean) => void;
	children: ReactNode;
}) {
	return (
		<>
			{open && <SlideoutDivider onShare={onShare} />}
			<aside
				className={`slideout${open ? " open" : ""}`}
				aria-label={mode === "comments" ? "Comments" : "Preview"}
			>
				<div className="slideout-head">
					{/* ponytail: aria-pressed pills, not a tablist — one selectable
					    mode until b4's Preview lands; promote to real tabs then. */}
					<button
						type="button"
						className={`slideout-tab${mode === "comments" ? " on" : ""}`}
						aria-pressed={mode === "comments"}
						onClick={() => onModeChange("comments")}
					>
						Comments{commentCount > 0 ? ` · ${commentCount}` : ""}
					</button>
					<button
						type="button"
						className={`slideout-tab${mode === "preview" ? " on" : ""}`}
						aria-pressed={mode === "preview"}
						disabled
						title="Opening links in the slideout lands next"
					>
						Preview
					</button>
					<span className="slideout-spacer" />
					<button
						type="button"
						className="slideout-close"
						aria-label="Close panel"
						onClick={onClose}
					>
						<X aria-hidden="true" />
					</button>
				</div>
				{children}
			</aside>
		</>
	);
}
