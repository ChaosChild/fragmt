/**
 * Whether the body carries hard-wrapped paragraphs – true when any plain
 * paragraph block spans two or more lines. Drives the edit-mode warning:
 * the editor saves each paragraph as a single line, so a hard-wrapped body
 * reflows wholesale on the first save.
 */

/** A line that STARTS a block construct – never paragraph content (heading,
 *  list marker, quote, table, fence, hr; a `---` run also covers the setext
 *  underline so "Title\\n---" reads as a heading pair, not a wrapped run). */
const BLOCK_START = /^(?:#{1,6}\s|[-+*]\s|\d+[.)]\s|>|\||\*{3,}|-{3,}|_{3,})/;

/**
 * ponytail: a naive line scan with a known ceiling – wrapped list
 * continuations also reflow on save but are not detected (a `-` or `1.` line
 * starts a block construct, its wrapped follow-ups look like paragraphs only
 * when they don't); the warning targets prose paragraphs.
 */
export function hasHardWraps(body: string): boolean {
	let inFence = false;
	let run = 0;
	for (const line of body.split("\n")) {
		// Fenced regions (``` / ~~~) toggle a skipped region – wrapped lines
		// inside a code block are content, never a reflow risk.
		if (line.startsWith("```") || line.startsWith("~~~")) {
			inFence = !inFence;
			run = 0;
			continue;
		}
		if (inFence || line.trim() === "" || BLOCK_START.test(line)) {
			run = 0;
			continue;
		}
		run += 1;
		if (run >= 2) return true;
	}
	return false;
}
