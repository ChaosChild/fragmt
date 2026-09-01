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
