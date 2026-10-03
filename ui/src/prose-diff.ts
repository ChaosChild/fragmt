/**
 * The rendered PR diff's pure half (ui v1, phase 9): frontmatter by key,
 * the body by markdown block, changed blocks by word. No dependencies –
 * the review renders these as React text nodes, never as HTML.
 */
import { sourceBlockSpans } from "./draft-gutter.js";

// --- frontmatter ---------------------------------------------------------

export interface FmChange {
	key: string;
	kind: "same" | "added" | "removed" | "changed";
	before?: unknown;
	after?: unknown;
}

/** JSON with object keys sorted at every level – equal values, equal text. */
function stable(v: unknown): string {
	return JSON.stringify(v, (_k, val) =>
		val && typeof val === "object" && !Array.isArray(val)
			? Object.fromEntries(
					Object.entries(val as Record<string, unknown>).sort(([a], [b]) =>
						a < b ? -1 : a > b ? 1 : 0,
					),
				)
			: val,
	);
}

/** Per key, in the base's order then the head's new keys. */
export function diffFrontmatter(
	a: Record<string, unknown> | null,
	b: Record<string, unknown> | null,
): FmChange[] {
	const before = a ?? {};
	const after = b ?? {};
	const keys = [
		...Object.keys(before),
		...Object.keys(after).filter((k) => !(k in before)),
	];
	return keys.map((key) => {
		if (!(key in after)) return { key, kind: "removed", before: before[key] };
		if (!(key in before)) return { key, kind: "added", after: after[key] };
		return stable(before[key]) === stable(after[key])
			? { key, kind: "same", before: before[key], after: after[key] }
			: { key, kind: "changed", before: before[key], after: after[key] };
	});
}

// --- blocks ----------------------------------------------------------------

/**
 * Comment anchors out, their text kept – the client copy of core's
 * stripCommentSpan rule (src/core/comments.ts), applied to every span at
 * once. Keep the two in sync; prose-diff.test.ts checks them on the same
 * fixtures.
 */
export function stripCommentSpans(body: string): string {
	return body.replace(/<span data-c="[^"]*">([\s\S]*?)<\/span>/g, "$1");
}

export type BlockKind =
	| "fence"
	| "heading"
	| "list"
	| "quote"
	| "table"
	| "html"
	| "paragraph";

/** Blocks whose words are never diffed – they compare whole. */
const WHOLE: ReadonlySet<BlockKind> = new Set(["fence", "table", "html"]);

function kindOf(text: string): BlockKind {
	const first = text.trimStart();
	if (/^(`{3,}|~{3,})/.test(first)) return "fence";
	if (/^#{1,6}\s/.test(first)) return "heading";
	if (/^([-*+]|\d+[.)])\s/.test(first)) return "list";
	if (first.startsWith(">")) return "quote";
	if (first.startsWith("|")) return "table";
	if (first.startsWith("<")) return "html";
	return "paragraph";
}

export interface BlockDiff {
	type: "same" | "reflow" | "changed" | "added" | "removed";
	kind: BlockKind;
	/** The base side's text (absent on added). */
	a?: string;
	/** The head side's text (absent on removed). */
	b?: string;
}

function blocksOf(
	body: string,
): { text: string; kind: BlockKind; norm: string }[] {
	const lines = body.split("\n");
	return sourceBlockSpans(body).map(({ start, end }) => {
		const text = lines.slice(start - 1, end).join("\n");
		return { text, kind: kindOf(text), norm: text.replace(/\s+/g, " ").trim() };
	});
}

/** Longest-common-subsequence pairs (i, j) over two sequences. */
function lcsPairs<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean) {
	const n = a.length;
	const m = b.length;
	// dp[i][j] = LCS length of a[i..] and b[j..]
	const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
	for (let i = n - 1; i >= 0; i--)
		for (let j = m - 1; j >= 0; j--)
			dp[i][j] = eq(a[i], b[j])
				? dp[i + 1][j + 1] + 1
				: Math.max(dp[i + 1][j], dp[i][j + 1]);
	const pairs: [number, number][] = [];
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (eq(a[i], b[j])) {
			pairs.push([i, j]);
			i++;
			j++;
		} else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
		else j++;
	}
	return pairs;
}

/**
 * The body as aligned blocks (fence-aware, comment spans stripped first):
 * equal after whitespace normalization = `same` (or `reflow` when only the
 * line breaks differ); between matches, removed and added blocks of the
 * same kind pair up in order as `changed`; the rest are `removed`/`added`.
 * Fences, tables and HTML never pair – they diff as whole blocks.
 */
export function diffBlocks(aBody: string, bBody: string): BlockDiff[] {
	const a = blocksOf(stripCommentSpans(aBody));
	const b = blocksOf(stripCommentSpans(bBody));
	const pairs = lcsPairs(a, b, (x, y) => x.norm === y.norm);
	const out: BlockDiff[] = [];
	let i = 0;
	let j = 0;
	const flush = (iEnd: number, jEnd: number) => {
		const removed = a.slice(i, iEnd);
		const added = b.slice(j, jEnd);
		let k = 0;
		while (
			k < removed.length &&
			k < added.length &&
			removed[k].kind === added[k].kind &&
			!WHOLE.has(removed[k].kind)
		) {
			out.push({
				type: "changed",
				kind: added[k].kind,
				a: removed[k].text,
				b: added[k].text,
			});
			k++;
		}
		for (const r of removed.slice(k))
			out.push({ type: "removed", kind: r.kind, a: r.text });
		for (const d of added.slice(k))
			out.push({ type: "added", kind: d.kind, b: d.text });
		i = iEnd;
		j = jEnd;
	};
	for (const [pi, pj] of pairs) {
		flush(pi, pj);
		out.push({
			type: a[pi].text === b[pj].text ? "same" : "reflow",
			kind: b[pj].kind,
			a: a[pi].text,
			b: b[pj].text,
		});
		i = pi + 1;
		j = pj + 1;
	}
	flush(a.length, b.length);
	return out;
}

// --- words -----------------------------------------------------------------

export interface WordPart {
	type: "same" | "ins" | "del";
	text: string;
}

/** Beyond this many token pairs the LCS table is too costly – the block
 *  shows as one deletion and one insertion instead. */
const WORD_DIFF_LIMIT = 250_000;

/** Word-level diff of two changed blocks: whitespace runs are kept as
 *  tokens (the head's spelling wins) but any whitespace equals any other –
 *  a rewrap inside a changed block is no change. Adjacent parts of one
 *  type coalesce. */
export function diffWords(a: string, b: string): WordPart[] {
	const ta = a.split(/(\s+)/).filter(Boolean);
	const tb = b.split(/(\s+)/).filter(Boolean);
	if (ta.length * tb.length > WORD_DIFF_LIMIT)
		return [
			{ type: "del", text: a },
			{ type: "ins", text: b },
		];
	const out: WordPart[] = [];
	const push = (type: WordPart["type"], text: string) => {
		const last = out[out.length - 1];
		if (last?.type === type) last.text += text;
		else out.push({ type, text });
	};
	let i = 0;
	let j = 0;
	const blank = (t: string) => /^\s+$/.test(t);
	const eq = (x: string, y: string) => x === y || (blank(x) && blank(y));
	for (const [pi, pj] of lcsPairs(ta, tb, eq)) {
		for (; i < pi; i++) push("del", ta[i]);
		for (; j < pj; j++) push("ins", tb[j]);
		push("same", tb[pj]);
		i = pi + 1;
		j = pj + 1;
	}
	for (; i < ta.length; i++) push("del", ta[i]);
	for (; j < tb.length; j++) push("ins", tb[j]);
	return out;
}
