import { Pencil, X } from "lucide-react";
import {
	type KeyboardEvent as ReactKeyboardEvent,
	type ReactNode,
	type PointerEvent as ReactPointerEvent,
	useRef,
} from "react";
import { clampSlideoutShare } from "./slideout-geometry";

/** The slideout's modes (#15): Comments — the old rail's thread list — and
 *  Preview, the linked doc read-only (b4). */
export type SlideoutMode = "comments" | "preview";

const MODES: SlideoutMode[] = ["comments", "preview"];
const TAB_ID: Record<SlideoutMode, string> = {
	comments: "slideout-tab-comments",
	preview: "slideout-tab-preview",
};

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
 * the permanent comment rail. The head carries the mode tabs (real tabs
 * since b4 put a second mode behind them), the previewed doc's title, the
 * promote-to-editor button, and close; the mode content arrives as
 * children. App owns open/mode/preview state; ≤1180px the CSS turns the
 * pane into the bottom sheet the rail used to be.
 */
export function Slideout({
	open,
	mode,
	commentCount,
	previewTitle,
	onModeChange,
	onPromote,
	onClose,
	onShare,
	children,
}: {
	open: boolean;
	mode: SlideoutMode;
	/** The Comments tab's count — the old rail title's "Comments · N". */
	commentCount: number;
	/** The previewed doc's display title — the head's "Preview · <title>"
	 *  line (null in Comments mode or with nothing previewed). */
	previewTitle: string | null;
	onModeChange: (mode: SlideoutMode) => void;
	/** The head's "open in editor" act (Preview mode, #15): App closes the
	 *  pane and sends the main doc through the navigation queue. Absent =
	 *  no button (nothing previewed). */
	onPromote?: () => void;
	onClose: () => void;
	onShare: (share: number, commit: boolean) => void;
	children: ReactNode;
}) {
	const tabRefs = useRef<Record<SlideoutMode, HTMLButtonElement | null>>({
		comments: null,
		preview: null,
	});
	// APG tabs: the arrows move selection (and focus) between the modes.
	const onTabKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
		if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
		e.preventDefault();
		const dir = e.key === "ArrowRight" ? 1 : -1;
		const next =
			MODES[(MODES.indexOf(mode) + dir + MODES.length) % MODES.length];
		onModeChange(next);
		tabRefs.current[next]?.focus();
	};
	const tab = (m: SlideoutMode, label: string) => (
		<button
			type="button"
			ref={(el) => {
				tabRefs.current[m] = el;
			}}
			id={TAB_ID[m]}
			role="tab"
			className={`slideout-tab${mode === m ? " on" : ""}`}
			aria-selected={mode === m}
			tabIndex={mode === m ? 0 : -1}
			onClick={() => onModeChange(m)}
		>
			{label}
		</button>
	);
	return (
		<>
			{open && <SlideoutDivider onShare={onShare} />}
			<aside
				className={`slideout${open ? " open" : ""}`}
				aria-label={mode === "comments" ? "Comments" : "Preview"}
			>
				<div className="slideout-head">
					<div
						className="slideout-tabs"
						role="tablist"
						aria-label="Panel mode"
						onKeyDown={onTabKey}
					>
						{tab(
							"comments",
							`Comments${commentCount > 0 ? ` · ${commentCount}` : ""}`,
						)}
						{tab("preview", "Preview")}
					</div>
					{previewTitle && (
						<span className="slideout-title" title={previewTitle}>
							Preview · {previewTitle}
						</span>
					)}
					<span className="slideout-spacer" />
					{mode === "preview" &&
						onPromote && ( // Promote (#15): hand the previewed doc to the editor.
							<button
								type="button"
								className="tool-btn"
								title="Open in editor"
								aria-label="Open in editor"
								onClick={onPromote}
							>
								<Pencil aria-hidden="true" />
							</button>
						)}
					<button
						type="button"
						className="slideout-close"
						aria-label="Close panel"
						onClick={onClose}
					>
						<X aria-hidden="true" />
					</button>
				</div>
				<div
					className="slideout-panel"
					role="tabpanel"
					id="slideout-panel"
					aria-labelledby={TAB_ID[mode]}
				>
					{children}
				</div>
			</aside>
		</>
	);
}
