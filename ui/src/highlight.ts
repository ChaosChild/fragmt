export interface HighlightPart {
	text: string;
	/** True inside a case-insensitive query match – renders as <mark>. */
	hit: boolean;
}

/**
 * Split `text` into plain/matched segments around every case-insensitive
 * occurrence of trimmed `q` (left-to-right, non-overlapping) – the search
 * modal's <mark> render source (#14). Pure: testable without React.
 */
export function highlightSegments(text: string, q: string): HighlightPart[] {
	const needle = q.trim();
	if (!needle) return [{ text, hit: false }];
	const lower = text.toLowerCase();
	const target = needle.toLowerCase();
	const parts: HighlightPart[] = [];
	let from = 0;
	for (;;) {
		const at = lower.indexOf(target, from);
		if (at === -1) {
			if (from < text.length || parts.length === 0)
				parts.push({ text: text.slice(from), hit: false });
			return parts;
		}
		if (at > from) parts.push({ text: text.slice(from, at), hit: false });
		parts.push({ text: text.slice(at, at + target.length), hit: true });
		from = at + target.length;
	}
}
