import { expect, test } from "vitest";
import type { CommentFile, CommentThread } from "../src/core/comments.js";
import {
	ConflictParseError,
	mergeSidecars,
	parseConflicts,
} from "../src/core/conflict.js";

// parseConflicts — pure marker splitting (M4-4 b2). The load-bearing contract
// beyond shape: parts keep their line newlines, so reassembling with a side
// chosen per hunk reproduces a well-formed file minus the marker lines.

test("no markers → the whole text as one part, verbatim; empty text → no parts", () => {
	expect(parseConflicts("plain\ntext\n")).toEqual([{ text: "plain\ntext\n" }]);
	expect(parseConflicts("no trailing newline")).toEqual([
		{ text: "no trailing newline" },
	]);
	expect(parseConflicts("")).toEqual([]);
});

test("one hunk → text before / ours vs theirs / text after", () => {
	expect(
		parseConflicts(
			"before\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> drafts/x\nafter\n",
		),
	).toEqual([
		{ text: "before\n" },
		{ ours: "ours\n", theirs: "theirs\n" },
		{ text: "after\n" },
	]);
});

test("several hunks, including two adjacent with no text between", () => {
	expect(
		parseConflicts(
			"<<<<<<< HEAD\na\n=======\nb\n>>>>>>> d1\nmid\n<<<<<<< HEAD\nc\n=======\nd\n>>>>>>> d2\n",
		),
	).toEqual([
		{ ours: "a\n", theirs: "b\n" },
		{ text: "mid\n" },
		{ ours: "c\n", theirs: "d\n" },
	]);
});

test("hunk adjacent to frontmatter", () => {
	expect(
		parseConflicts(
			"---\ntitle: T\n---\n<<<<<<< HEAD\n# ours\n=======\n# theirs\n>>>>>>> d\nrest\n",
		),
	).toEqual([
		{ text: "---\ntitle: T\n---\n" },
		{ ours: "# ours\n", theirs: "# theirs\n" },
		{ text: "rest\n" },
	]);
});

test("reassembly: choosing a side per hunk rebuilds the file exactly", () => {
	const text =
		"x\n<<<<<<< HEAD\nours body\nline2\n=======\ntheirs body\n>>>>>>> b\ntail no newline";
	const parts = parseConflicts(text);
	const pick = (side: "ours" | "theirs") =>
		parts.map((p) => ("text" in p ? p.text : p[side])).join("");
	expect(pick("ours")).toBe("x\nours body\nline2\ntail no newline");
	expect(pick("theirs")).toBe("x\ntheirs body\ntail no newline");
});

test("malformed markers throw ConflictParseError", () => {
	// separator with no open hunk
	expect(() => parseConflicts("a\n=======\nb\n")).toThrow(ConflictParseError);
	// close with no open hunk
	expect(() => parseConflicts("a\n>>>>>>> b\n")).toThrow(ConflictParseError);
	// unterminated hunk at EOF
	expect(() => parseConflicts("<<<<<<< HEAD\nours\n")).toThrow(
		ConflictParseError,
	);
	// close before the separator
	expect(() => parseConflicts("<<<<<<< HEAD\nours\n>>>>>>> b\n")).toThrow(
		ConflictParseError,
	);
	// a second open marker inside a hunk
	expect(() =>
		parseConflicts(
			"<<<<<<< HEAD\na\n<<<<<<< HEAD2\nb\n=======\nc\n>>>>>>> d\n",
		),
	).toThrow(ConflictParseError);
});

// mergeSidecars — the approved survival rules (Q4), one per row.

const open = { author: "Seed", body: "open", at: "2026-01-01T00:00:00.000Z" };
const thread = (
	id: string,
	over: Partial<CommentThread> = {},
): CommentThread => ({
	id,
	quote: `q-${id}`,
	author: "Ours",
	createdAt: "2026-01-01T00:00:00.000Z",
	resolved: false,
	replies: [open],
	...over,
});
const file = (comments: Record<string, CommentThread>): CommentFile => ({
	comments,
});

test("identical sidecars → merged equals both, all counts zero movement", () => {
	const ours = file({ t1: thread("t1"), t2: thread("t2") });
	const { merged, summary } = mergeSidecars(
		ours,
		file({ t1: thread("t1"), t2: thread("t2") }),
	);
	expect(merged).toEqual(ours);
	expect(summary).toEqual({
		keptFromOurs: 2,
		keptFromTheirs: 0,
		resolvedCarried: 0,
		repliesMerged: 0,
	});
});

test("thread only in ours → kept verbatim", () => {
	const ours = file({ t1: thread("t1") });
	const { merged, summary } = mergeSidecars(ours, file({}));
	expect(merged).toEqual(ours);
	expect(summary.keptFromOurs).toBe(1);
	expect(summary.keptFromTheirs).toBe(0);
});

test("thread only in theirs → presence wins, it joins (keptFromTheirs)", () => {
	const t = thread("t9", { author: "Theirs" });
	const { merged, summary } = mergeSidecars(file({}), file({ t9: t }));
	expect(merged).toEqual(file({ t9: t }));
	expect(summary).toMatchObject({ keptFromTheirs: 1, keptFromOurs: 0 });
});

test("both have the thread → creation fields (quote/author/createdAt) from ours", () => {
	const ours = file({
		t1: thread("t1", {
			quote: "ours quote",
			author: "Ours Author",
			createdAt: "2026-05-05T00:00:00.000Z",
		}),
	});
	const theirs = file({
		t1: thread("t1", {
			quote: "theirs quote",
			author: "Theirs Author",
			createdAt: "2026-06-06T00:00:00.000Z",
		}),
	});
	const { merged } = mergeSidecars(ours, theirs);
	expect(merged.comments.t1).toMatchObject({
		quote: "ours quote",
		author: "Ours Author",
		createdAt: "2026-05-05T00:00:00.000Z",
	});
});

test("resolved is sticky: theirs resolved carries over ours' open thread", () => {
	const ours = file({ t1: thread("t1", { resolved: false }) });
	const theirs = file({ t1: thread("t1", { resolved: true }) });
	const { merged, summary } = mergeSidecars(ours, theirs);
	expect(merged.comments.t1.resolved).toBe(true);
	expect(summary.resolvedCarried).toBe(1);
});

test("resolved is sticky: ours already resolved → true, nothing carried", () => {
	const ours = file({ t1: thread("t1", { resolved: true }) });
	const theirs = file({ t1: thread("t1", { resolved: false }) });
	const { merged, summary } = mergeSidecars(ours, theirs);
	expect(merged.comments.t1.resolved).toBe(true);
	expect(summary.resolvedCarried).toBe(0);
});

test("a theirs-only thread arriving resolved counts as carried too", () => {
	const { merged, summary } = mergeSidecars(
		file({}),
		file({ t9: thread("t9", { resolved: true }) }),
	);
	expect(merged.comments.t9.resolved).toBe(true);
	expect(summary).toMatchObject({ keptFromTheirs: 1, resolvedCarried: 1 });
});

test("replies: theirs' entries append only when (author, at) is new; ours' order leads", () => {
	const dup = {
		author: "Dup",
		body: "same pair",
		at: "2026-02-02T00:00:00.000Z",
	};
	const ours = file({
		t1: thread("t1", {
			replies: [
				open,
				dup,
				{ author: "A", body: "b", at: "2026-03-03T00:00:00.000Z" },
			],
		}),
	});
	const theirs = file({
		t1: thread("t1", {
			replies: [
				open, // identical pair (the common ancestor's opening reply)
				{ ...dup, body: "same pair, different body" }, // same (author, at) → dropped
				{ author: "A", body: "other body", at: "2026-04-04T00:00:00.000Z" }, // same author, new at → kept
				{ author: "B", body: "b", at: "2026-03-03T00:00:00.000Z" }, // same at, new author → kept
			],
		}),
	});
	const { merged, summary } = mergeSidecars(ours, theirs);
	expect(merged.comments.t1.replies).toEqual([
		open,
		dup,
		{ author: "A", body: "b", at: "2026-03-03T00:00:00.000Z" },
		{ author: "A", body: "other body", at: "2026-04-04T00:00:00.000Z" },
		{ author: "B", body: "b", at: "2026-03-03T00:00:00.000Z" },
	]);
	expect(summary.repliesMerged).toBe(2);
});

test("summary counts across a mixed file", () => {
	const ours = file({
		both: thread("both", { resolved: true }),
		onlyOurs: thread("onlyOurs"),
		carried: thread("carried", {
			replies: [
				open,
				{ author: "O", body: "o", at: "2026-02-02T00:00:00.000Z" },
			],
		}),
	});
	const theirs = file({
		both: thread("both", { resolved: false }),
		carried: thread("carried", {
			resolved: true,
			replies: [
				open,
				{ author: "T", body: "t", at: "2026-05-05T00:00:00.000Z" },
			],
		}),
		onlyTheirs: thread("onlyTheirs"),
	});
	const { merged, summary } = mergeSidecars(ours, theirs);
	expect(Object.keys(merged.comments).sort()).toEqual([
		"both",
		"carried",
		"onlyOurs",
		"onlyTheirs",
	]);
	expect(summary).toEqual({
		keptFromOurs: 3, // both + onlyOurs + carried
		keptFromTheirs: 1,
		resolvedCarried: 1, // carried (theirs resolved, ours not); both was ours-resolved
		repliesMerged: 1, // T's reply
	});
});
