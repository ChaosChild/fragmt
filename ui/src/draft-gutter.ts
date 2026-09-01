/**
 * The draft gutter's pure half (#18): markdown source blocks as 1-based
 * inclusive line spans, and the diff-line → block mapping. Zero imports –
 * the EditorPane pass and the tests run the exact same functions.
 */

export interface LineRange {
	start: number;
	end: number;
}

/**
 * Top-level markdown blocks as 1-based inclusive line spans: blank-line
 * separated, fence-aware (a blank line inside ``` / ~~~ never splits; the
 * fence ends on a same-char closer at least as long).
 */
export function sourceBlockSpans(body: string): LineRange[] {
	const lines = body.split("\n");
	const spans: LineRange[] = [];
	let fence: string | null = null;
	let start = -1; // 0-based first line of the block being built
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (fence) {
			const close = line.match(/^\s{0,3}(`{3,}|~{3,})\s*$/);
			if (close && close[1][0] === fence[0] && close[1].length >= fence.length)
				fence = null;
			continue; // inside a fence even a blank line stays in the block
		}
		const open = line.match(/^\s{0,3}(`{3,}|~{3,})/);
		if (open) {
			fence = open[1];
			if (start === -1) start = i;
			continue;
		}
		if (line.trim() === "") {
			if (start !== -1) {
				spans.push({ start: start + 1, end: i });
				start = -1;
			}
			continue;
		}
		if (start === -1) start = i;
	}
	if (start !== -1) spans.push({ start: start + 1, end: lines.length });
	return spans;
}

/**
 * Block indices (0-based) whose span intersects any range. A count mismatch
 * between source spans and the editor's top-level children → an EMPTY set:
 *
 * ponytail: tiptap-markdown exposes no source maps – this blank-line
 * heuristic is the whole mapping, so when the counts disagree we mark
 * nothing rather than mislabel a block (correct-or-absent). Upgrade path:
 * upstream source-map support.
 */
export function mapRangesToBlocks(
	ranges: LineRange[],
	spans: LineRange[],
	blockCount: number,
): Set<number> {
	const out = new Set<number>();
	if (spans.length !== blockCount) return out;
	for (const r of ranges) {
		for (let i = 0; i < spans.length; i++) {
			if (r.start <= spans[i].end && spans[i].start <= r.end) out.add(i);
		}
	}
	return out;
}
