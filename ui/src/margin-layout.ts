/** One margin note to place: its anchor's top relative to the margin (null =
 *  orphan – no live span, never placed) and its rendered height. */
export interface NoteBox {
	id: string;
	anchorTop: number | null;
	height: number;
}

/** A note sits a little above its anchor so its first line reads level
 *  with the highlighted text. */
const LIFT = 14;

/**
 * Marginalia layout (ui v1, phase 5): each anchored note sits at
 * max(anchorTop − 14, previous bottom + gap), in anchor order, never above
 * `top`. With a focused note, that note lands exactly at its own position
 * (anchorTop − 14) and the notes before it move up to make room when there
 * is room; if there isn't, they stack from `top` and the focused one sits
 * right below them. Orphans are not placed – they render in the list
 * below. Pure: the caller measures, this only does arithmetic.
 */
export function layoutNotes(
	items: NoteBox[],
	opts: { gap: number; top: number; focused?: string | null },
): Map<string, number> {
	const { gap, top, focused } = opts;
	const anchored = items
		.filter((i): i is NoteBox & { anchorTop: number } => i.anchorTop !== null)
		.sort((a, b) => a.anchorTop - b.anchorTop);
	const want = (i: { anchorTop: number }) => Math.max(top, i.anchorTop - LIFT);
	const out = new Map<string, number>();

	// Forward stacking from `from`, starting at index `start`.
	const stack = (start: number, end: number, from: number) => {
		let floor = from;
		for (let k = start; k < end; k++) {
			const it = anchored[k];
			const y = Math.max(want(it), floor);
			out.set(it.id, y);
			floor = y + it.height + gap;
		}
		return floor;
	};

	const f = focused ? anchored.findIndex((i) => i.id === focused) : -1;
	if (f < 0) {
		stack(0, anchored.length, top);
		return out;
	}

	// Before the focused note: walk backwards from it, each note as low as
	// it wants but clear of the one below.
	let fTop = want(anchored[f]);
	let limit = fTop - gap;
	const before: number[] = [];
	for (let k = f - 1; k >= 0; k--) {
		const it = anchored[k];
		const y = Math.min(want(it), limit - it.height);
		before[k] = y;
		limit = y - gap;
	}
	if (f > 0 && before[0] < top) {
		// No room above: the earlier notes stack from the top, and the
		// focused one waits below them.
		fTop = Math.max(fTop, stack(0, f, top));
	} else {
		for (let k = 0; k < f; k++) out.set(anchored[k].id, before[k]);
	}
	out.set(anchored[f].id, fTop);
	stack(f + 1, anchored.length, fTop + anchored[f].height + gap);
	return out;
}
