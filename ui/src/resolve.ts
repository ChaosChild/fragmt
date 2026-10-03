/**
 * Resolution mode's pure logic (M4-4 b3) – the dnd.ts pattern: no DOM, no
 * fetch, testable straight from the node suite. The hunk cards' live
 * preview and the Stage button both render through assembleContent, so what
 * you preview is exactly what stages; the sidecar card's summary line is
 * formatted here too (the b2 counts → the one line users read).
 */
import type { ConflictPart, SidecarMergeSummary } from "./api.js";

/**
 * The assembled resolution: plain parts pass through verbatim, each
 * conflicting hunk contributes its picked/edited text. A missing pick reads
 * as empty – deleting a hunk is a valid resolution.
 */
export function assembleContent(
	parts: ConflictPart[],
	picks: string[],
): string {
	let i = 0;
	return parts.map((p) => ("text" in p ? p.text : (picks[i++] ?? ""))).join("");
}

/** The sidecar card's summary line ("2 threads kept · 1 resolve carried ·
 *  3 replies merged") from the b2 mergeSidecars counts. */
export function sidecarSummaryLine(s: SidecarMergeSummary): string {
	const threads = s.keptFromOurs + s.keptFromTheirs;
	return `${threads} ${threads === 1 ? "thread" : "threads"} kept · ${s.resolvedCarried} resolve${s.resolvedCarried === 1 ? "" : "s"} carried · ${s.repliesMerged} ${s.repliesMerged === 1 ? "reply" : "replies"} merged`;
}

/** The `i`-th conflict hunk's place in the file: the nearest markdown
 *  heading above it (scanning the text before it – plain parts, and the
 *  main side of earlier hunks) and its 1-based start line. */
export function hunkPlace(
	parts: ConflictPart[],
	i: number,
): { heading: string | null; line: number } {
	let heading: string | null = null;
	let line = 1;
	let seen = 0;
	for (const p of parts) {
		const isHunk = !("text" in p);
		if (isHunk && seen === i) break;
		const text = "text" in p ? p.text : p.ours;
		for (const l of text.split("\n")) {
			const m = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(l);
			if (m) heading = m[1];
		}
		line += (text.match(/\n/g) ?? []).length;
		if (isHunk) seen++;
	}
	return { heading, line };
}
