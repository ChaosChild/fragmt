// M4-4 b3: resolution mode's pure seams (ui/src/resolve.ts – the dnd.ts
// pattern). assembleContent is the one function the hunk cards' preview and
// the Stage button both render through; sidecarSummaryLine is the sidecar
// card's one readable line from the b2 mergeSidecars counts.
import { describe, expect, test } from "vitest";
import type { ConflictPart, SidecarMergeSummary } from "../ui/src/api.js";
import { assembleContent, sidecarSummaryLine } from "../ui/src/resolve.js";

describe("assembleContent", () => {
	test("no conflicts – text passes through verbatim", () => {
		const parts: ConflictPart[] = [{ text: "# doc\n\nbody\n" }];
		expect(assembleContent(parts, [])).toBe("# doc\n\nbody\n");
	});

	test("one hunk – ours, theirs, and an edited pick", () => {
		const parts: ConflictPart[] = [
			{ text: "# t\n\n" },
			{ ours: "main line\n", theirs: "draft line\n" },
			{ text: "tail\n" },
		];
		expect(assembleContent(parts, ["main line\n"])).toBe(
			"# t\n\nmain line\ntail\n",
		);
		expect(assembleContent(parts, ["draft line\n"])).toBe(
			"# t\n\ndraft line\ntail\n",
		);
		expect(assembleContent(parts, ["merged line\n"])).toBe(
			"# t\n\nmerged line\ntail\n",
		);
	});

	test("several hunks – picks apply in order", () => {
		const parts: ConflictPart[] = [
			{ ours: "a\n", theirs: "A\n" },
			{ text: "mid\n" },
			{ ours: "b\n", theirs: "B\n" },
			{ ours: "c\n", theirs: "C\n" },
		];
		expect(assembleContent(parts, ["A\n", "b\n", "C\n"])).toBe(
			"A\nmid\nb\nC\n",
		);
	});

	test("frontmatter-adjacent hunks and a missing pick (delete = empty)", () => {
		const parts: ConflictPart[] = [
			{ text: "---\ntitle: T\n---\n" },
			{ ours: "keep\n", theirs: "drop\n" },
		];
		expect(assembleContent(parts, ["keep\n"])).toBe(
			"---\ntitle: T\n---\nkeep\n",
		);
		expect(assembleContent(parts, [])).toBe("---\ntitle: T\n---\n");
		expect(assembleContent(parts, [""])).toBe("---\ntitle: T\n---\n");
	});
});

describe("sidecarSummaryLine", () => {
	test("pluralized counts, threads summed from both sides", () => {
		const s = (n: Partial<SidecarMergeSummary>): SidecarMergeSummary => ({
			keptFromOurs: 0,
			keptFromTheirs: 0,
			resolvedCarried: 0,
			repliesMerged: 0,
			...n,
		});
		expect(sidecarSummaryLine(s({ keptFromOurs: 2, keptFromTheirs: 1 }))).toBe(
			"3 threads kept · 0 resolves carried · 0 replies merged",
		);
		expect(sidecarSummaryLine(s({ keptFromOurs: 1, resolvedCarried: 1 }))).toBe(
			"1 thread kept · 1 resolve carried · 0 replies merged",
		);
		expect(sidecarSummaryLine(s({ keptFromOurs: 0, repliesMerged: 1 }))).toBe(
			"0 threads kept · 0 resolves carried · 1 reply merged",
		);
	});
});
