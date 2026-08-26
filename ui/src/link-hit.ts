/** #15 link interception: the hover-↗ affordance's hit zone. The glyph is a
 *  CSS pseudo-element (no DOM, no markdown/serialization change), so it
 *  cannot be a hit target — a click that lands in the last few pixels of
 *  the link's own bounding rect is read as a click on it instead.
 *
 *  ponytail: a geometric zone over the bounding rect is honest for
 *  single-line links and degrades on the edges — a multi-line link's rect
 *  spans lines, and a link narrower than the zone turns every click into an
 *  open. Shift+click is the robust path everywhere; upgrade to a real DOM
 *  icon beside the link if the zone ever misfires.
 */
export const DOC_LINK_ICON_PX = 18;

/** True when clickX sits inside the link's own rect AND within the last
 *  DOC_LINK_ICON_PX of its right edge. Zero/inverted-width rects have no
 *  zone (nothing visible to aim at); clicks outside the rect never count. */
export function isIconHit(
	clickX: number,
	rect: { left: number; right: number },
): boolean {
	if (rect.right - rect.left <= 0) return false;
	if (clickX < rect.left || clickX > rect.right) return false;
	return rect.right - clickX <= DOC_LINK_ICON_PX;
}
