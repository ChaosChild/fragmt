/**
 * The shared popover's position math (Menus.tsx's MenuPopover): hug the
 * anchor's bottom-left corner, nudged fully inside the viewport by the
 * popover's OWN measured size. The hardcoded 280/230 reservations this
 * replaced were sized for the branch menu and pulled narrow popovers (the
 * auth chip's "Sign out") far left of right-edge anchors. Pure so the
 * geometry is testable without a DOM.
 */
export function popoverPosition(
	r: { left: number; bottom: number },
	size: { width: number; height: number },
	view: { width: number; height: number },
): { top: number; left: number } {
	const gap = 6;
	const margin = 8;
	return {
		top: Math.max(
			margin,
			Math.min(r.bottom + gap, view.height - size.height - margin),
		),
		left: Math.max(margin, Math.min(r.left, view.width - size.width - margin)),
	};
}
