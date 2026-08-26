/** Slideout split bounds (#15): the main pane keeps 40–60% of the combined
 *  area — either side can win the majority, both always stay usable. */
export const SLIDEOUT_SHARE_MIN = 0.4;
export const SLIDEOUT_SHARE_MAX = 0.6;
export const SLIDEOUT_SHARE_DEFAULT = 0.55;
const SLIDEOUT_SHARE_KEY = "fragmt.slideoutShare";

/** Clamp a dragged/stored share into [0.4, 0.6], rounded to 4 decimals so
 *  pointer math never grows a float tail in localStorage. */
export function clampSlideoutShare(share: number): number {
	if (!Number.isFinite(share)) return SLIDEOUT_SHARE_DEFAULT;
	const inRange = Math.min(
		SLIDEOUT_SHARE_MAX,
		Math.max(SLIDEOUT_SHARE_MIN, share),
	);
	return Math.round(inRange * 10_000) / 10_000;
}

/** Persisted split share; the 0.55 default when absent, empty, or invalid —
 *  App always needs a number (the flex variable has no "unset" state). */
export function readStoredSlideoutShare(): number {
	const raw = localStorage.getItem(SLIDEOUT_SHARE_KEY);
	if (raw === null || raw === "") return SLIDEOUT_SHARE_DEFAULT;
	return clampSlideoutShare(Number(raw));
}

/** Persist the split (pointerup — one write per drag, not per move). */
export function storeSlideoutShare(share: number): void {
	localStorage.setItem(SLIDEOUT_SHARE_KEY, String(share));
}
