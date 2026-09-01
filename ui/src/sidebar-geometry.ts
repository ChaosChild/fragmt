/** Sidebar drag-resize bounds (M4-3 b3). Below 768px the drawer owns width. */
export const SIDEBAR_W_MIN = 260;
export const SIDEBAR_W_MAX = 560;
const SIDEBAR_W_KEY = "fragmt.sidebarW";

/** Clamp a dragged/stored sidebar width into the [260, 560] px range. */
export function clampSidebarWidth(px: number): number {
	if (!Number.isFinite(px)) return SIDEBAR_W_MIN;
	return Math.min(SIDEBAR_W_MAX, Math.max(SIDEBAR_W_MIN, Math.round(px)));
}

/** Persisted sidebar width; null when absent, empty, or non-numeric. */
export function readStoredSidebarWidth(): number | null {
	const raw = localStorage.getItem(SIDEBAR_W_KEY);
	if (raw === null || raw === "") return null;
	const n = Number(raw);
	if (!Number.isFinite(n) || n <= 0) return null;
	return clampSidebarWidth(n);
}

/** Persist the sidebar width (pointerup – one write per drag, not per move). */
export function storeSidebarWidth(width: number): void {
	localStorage.setItem(SIDEBAR_W_KEY, String(width));
}
