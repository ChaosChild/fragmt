import type { CommentFile } from "./comments.js";

/** Markers didn't nest the way git writes them — see parseConflicts. */
export class ConflictParseError extends Error {}

/** A file split on conflict markers: plain text runs and ours/theirs hunks. */
export type ConflictPart = { text: string } | { ours: string; theirs: string };

/**
 * Split raw file text on <<<<<<< / ======= / >>>>>>> markers (git's default
 * conflict style). Line-based state machine: text accumulates until a
 * `<<<<<<<` opens a hunk, `=======` flips ours→theirs, `>>>>>>>` closes it.
 * Text and hunk sides keep their line newlines, so reassembling the parts
 * (choosing a side per hunk) reproduces a well-formed file byte-for-byte
 * minus the marker lines. Throws ConflictParseError on malformed nesting —
 * git output is well-formed, so a throw means the text wasn't a conflict.
 */
export function parseConflicts(text: string): ConflictPart[] {
	const lines = text.split("\n");
	const parts: ConflictPart[] = [];
	const buf: string[] = [];
	let ours: string[] | null = null;
	let theirs: string[] | null = null;
	const flush = () => {
		const joined = buf.join("");
		if (joined !== "") parts.push({ text: joined });
		buf.length = 0;
	};
	for (let i = 0; i < lines.length; i++) {
		const raw = lines[i];
		const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
		const eol = i < lines.length - 1 ? "\n" : "";
		if (line.startsWith("<<<<<<<")) {
			if (ours !== null || theirs !== null)
				throw new ConflictParseError("nested or stray conflict open marker");
			flush();
			ours = [];
		} else if (line === "=======") {
			if (ours === null || theirs !== null)
				throw new ConflictParseError("conflict separator outside a hunk");
			theirs = [];
		} else if (line.startsWith(">>>>>>>")) {
			if (ours === null || theirs === null)
				throw new ConflictParseError("conflict close marker outside a hunk");
			parts.push({ ours: ours.join(""), theirs: theirs.join("") });
			ours = null;
			theirs = null;
		} else if (ours !== null && theirs === null) {
			ours.push(raw + eol);
		} else if (theirs !== null) {
			theirs.push(raw + eol);
		} else {
			buf.push(raw + eol);
		}
	}
	if (ours !== null || theirs !== null)
		throw new ConflictParseError("unterminated conflict hunk");
	flush();
	return parts;
}

export interface SidecarMergeSummary {
	/** Threads whose record came from ours (only-in-ours + present-in-both). */
	keptFromOurs: number;
	/** Threads only theirs had — presence wins, so they join. */
	keptFromTheirs: number;
	/** Threads the merge newly resolved relative to ours (ours didn't have
	 *  them resolved — includes theirs-only threads arriving resolved). */
	resolvedCarried: number;
	/** Theirs' reply entries whose (author, at) pair wasn't already present. */
	repliesMerged: number;
}

/**
 * Structural sidecar merge (approved rules, Q4): threads union by id
 * (presence wins), creation fields (quote/author/createdAt) from ours,
 * resolved = ours || theirs (sticky — resolving survives the merge), replies
 * = ours' entries + theirs' entries whose (author, at) pair is new.
 */
export function mergeSidecars(
	ours: CommentFile,
	theirs: CommentFile,
): { merged: CommentFile; summary: SidecarMergeSummary } {
	const merged: CommentFile = { comments: {} };
	const summary: SidecarMergeSummary = {
		keptFromOurs: 0,
		keptFromTheirs: 0,
		resolvedCarried: 0,
		repliesMerged: 0,
	};
	for (const [id, o] of Object.entries(ours.comments)) {
		summary.keptFromOurs++;
		const t = theirs.comments[id];
		if (!t) {
			// only ours has it — verbatim
			merged.comments[id] = o;
			continue;
		}
		const seen = new Set(o.replies.map((r) => `${r.author}\x1f${r.at}`));
		const replies = [...o.replies];
		for (const r of t.replies) {
			const key = `${r.author}\x1f${r.at}`;
			if (seen.has(key)) continue;
			seen.add(key);
			replies.push(r);
			summary.repliesMerged++;
		}
		// Creation fields stay ours (the spread); only resolve state and new
		// replies cross the merge.
		merged.comments[id] = {
			...o,
			resolved: o.resolved || t.resolved,
			replies,
		};
	}
	for (const [id, t] of Object.entries(theirs.comments)) {
		const o = ours.comments[id];
		if (o) {
			if (t.resolved && !o.resolved) summary.resolvedCarried++;
			continue;
		}
		summary.keptFromTheirs++;
		if (t.resolved) summary.resolvedCarried++;
		merged.comments[id] = t;
	}
	return { merged, summary };
}
