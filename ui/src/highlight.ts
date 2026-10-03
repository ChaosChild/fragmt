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

/**
 * The search preview's excerpt (ui v1): a doc body as plain-text paragraphs,
 * about `limit` characters in all. Markdown is flattened, never rendered –
 * code fences and HTML (the comment spans) drop out, links keep their text,
 * block markers and emphasis characters go. The last paragraph may be cut.
 */
export function plainExcerpt(markdown: string, limit = 600): string[] {
	const text = markdown
		.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, "")
		.replace(/<[^>]+>/g, "")
		.replace(/!\[[^\]]*\]\([^)]*\)/g, "")
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(
			/^[ \t]{0,3}(#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+|\d+[.)][ \t]+)/gm,
			"",
		)
		.replace(/[*_`]/g, "");
	const out: string[] = [];
	let left = limit;
	for (const para of text.split(/\n\s*\n/)) {
		const p = para.replace(/\s+/g, " ").trim();
		if (!p) continue;
		if (p.length >= left) {
			out.push(`${p.slice(0, left).trimEnd()}…`);
			break;
		}
		out.push(p);
		left -= p.length;
	}
	return out;
}
