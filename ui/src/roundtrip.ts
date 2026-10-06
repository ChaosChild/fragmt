/**
 * Load-time round-trip fidelity (#56). The editor parses the body into
 * ProseMirror and re-serializes it on every save, and that model is lossier
 * than the file format: hard-wrapped paragraphs join into one line, table
 * cells can lose pipe escaping, GFM alignment colons drop. The detector runs
 * once per doc load (EditorPane's setContent effect); a lossy doc gets a
 * warning banner and Save is gated behind an explicit acknowledge.
 */

/**
 * src/core/docs.ts' canonicalBody, replicated client-side on purpose (the
 * server code is Node-only): LF endings, no leading newlines, exactly one
 * trailing newline (empty stays empty). Both sides of the comparison go
 * through it, so CRLF sources and fence-boundary newlines never count as
 * editor loss.
 */
export function canonicalBody(content: string): string {
	const trimmed = content
		.replace(/\r\n/g, "\n")
		.replace(/^\n+/, "")
		.replace(/\n+$/, "");
	return trimmed === "" ? "" : `${trimmed}\n`;
}

/**
 * The load-time verdict: the number of lines a save would rewrite between
 * the loaded body and the editor's re-serialization – 0 means the round
 * trip is byte-stable. Counted as the changed region after the shared
 * prefix/suffix lines are trimmed off (an 8-line doc with one reflowed
 * paragraph reports the paragraph's lines, not the whole doc).
 */
export function rewrittenLines(source: string, serialized: string): number {
	const a = canonicalBody(source).split("\n");
	const b = canonicalBody(serialized).split("\n");
	let start = 0;
	while (start < a.length && start < b.length && a[start] === b[start]) {
		start += 1;
	}
	let endA = a.length;
	let endB = b.length;
	while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
		endA -= 1;
		endB -= 1;
	}
	return Math.max(endA - start, endB - start);
}

/**
 * The detector the tests name: true when serializing the loaded doc back
 * out would not change a byte (after canonicalization).
 */
export function roundTripIsStable(source: string, serialized: string): boolean {
	return rewrittenLines(source, serialized) === 0;
}

/** The banner's and the save-confirm's message – one wording, two surfaces. */
export function roundTripWarning(rewritten: number): string {
	return (
		`This document does not round-trip through the editor byte-stably – ` +
		`saving will rewrite ${rewritten} lines (table cells with unescaped ` +
		`pipes, hard-wrapped paragraphs, or similar). The content is ` +
		`reflowed, not lost, but the diff will show it fully changed.`
	);
}
