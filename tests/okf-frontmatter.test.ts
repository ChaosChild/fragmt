// OKF rung 3 (#33): the metadata editor's raw-splice core – setFrontmatterKeys
// scalar/list edits, replace-in-place vs append-at-fence-end, the fence-less
// gain (type first), the A2 status enum gate at the seam, free-text
// round-trips through JSON.stringify'd lines, and unknown-key byte
// preservation. Pure string in/out; the commit discipline that wraps these
// lives in okf-agent-actor.test.ts.
import matter from "gray-matter";
import { expect, test } from "vitest";
import {
	OkfFieldError,
	STATUS_VALUES,
	setFrontmatterKeys,
} from "../src/core/index.js";

const DOC =
	"---\ntype: Metric\ndescription: old\ntags: [a]\n---\n\n# T\n\nbody\n";

const edit = (
	text: string,
	...edits: Parameters<typeof setFrontmatterKeys>[1]
) => setFrontmatterKeys(text, edits);

test("scalar keys are replaced in place, position kept", () => {
	expect(edit(DOC, { key: "description", value: "new" })).toBe(
		'---\ntype: Metric\ndescription: "new"\ntags: [a]\n---\n\n# T\n\nbody\n',
	);
	expect(edit(DOC, { key: "type", value: "Playbook" })).toBe(
		'---\ntype: "Playbook"\ndescription: old\ntags: [a]\n---\n\n# T\n\nbody\n',
	);
});

test("absent scalar keys append at the fence end", () => {
	expect(edit(DOC, { key: "stale_after", value: "2026-09-23T00:00:00Z" })).toBe(
		'---\ntype: Metric\ndescription: old\ntags: [a]\nstale_after: "2026-09-23T00:00:00Z"\n---\n\n# T\n\nbody\n',
	);
});

test("list keys use the flow-line form; an empty list removes the key", () => {
	expect(edit(DOC, { key: "tags", list: ["x", "y"] })).toBe(
		'---\ntype: Metric\ndescription: old\ntags: ["x", "y"]\n---\n\n# T\n\nbody\n',
	);
	expect(edit(DOC, { key: "tags", list: [] })).toBe(
		"---\ntype: Metric\ndescription: old\n---\n\n# T\n\nbody\n",
	);
	expect(edit(DOC, { key: "categories", list: ["one"] })).toContain(
		'categories: ["one"]',
	);
});

test("a fence-less doc gains a fence, type first, original bytes after it", () => {
	expect(edit("# Just body\n", { key: "description", value: "d" })).toBe(
		'---\ntype: "concept"\ndescription: "d"\n---\n# Just body\n',
	);
	// Nothing to write, no fence invented.
	expect(edit("# Just body\n")).toBeNull();
});

test("null (or empty-string) scalars remove the key", () => {
	expect(edit(DOC, { key: "description", value: null })).toBe(
		"---\ntype: Metric\ntags: [a]\n---\n\n# T\n\nbody\n",
	);
	expect(edit(DOC, { key: "tags", value: "" })).toBe(
		"---\ntype: Metric\ndescription: old\n---\n\n# T\n\nbody\n",
	);
});

test("status is enum-only: valid values pass, anything else throws at the seam", () => {
	expect(STATUS_VALUES).toEqual(["draft", "stable", "deprecated"]);
	for (const status of STATUS_VALUES) {
		const next = edit(DOC, { key: "status", value: status });
		expect(next).toContain(`status: "${status}"`);
		expect(matter(next ?? "", {}).data.status).toBe(status);
	}
	for (const bad of ["shipped", "Draft", "", "draft\nstable"]) {
		expect(() => edit(DOC, { key: "status", value: bad }), bad).toThrow(
			OkfFieldError,
		);
	}
	// The list form never applies to status.
	expect(() => edit(DOC, { key: "status", list: ["draft"] })).toThrow(
		OkfFieldError,
	);
});

test("free-text values with colons, newlines, and quotes round-trip intact", () => {
	const gnarly = 'line1\nline2: colon "q" #hash \\ back';
	const next = edit(DOC, { key: "description", value: gnarly });
	expect(next).not.toBeNull();
	expect(matter(next ?? "", {}).data.description).toBe(gnarly);
	// The line itself stays single-line – a newline in the value can never
	// break out of the fence.
	expect(
		(next ?? "").split("\n").filter((l) => l.startsWith("description:")),
	).toHaveLength(1);
	// Tags with punctuation ride the same stringify.
	const tagged = edit(DOC, { key: "tags", list: ["a: b", "c#d"] });
	expect(matter(tagged ?? "", {}).data.tags).toEqual(["a: b", "c#d"]);
});

test("unknown keys keep their bytes verbatim; nothing changed → null", () => {
	const raw =
		"---\n# a comment\ntype:   Metric   \nnested:\n  keep: me\nauthor: x\n---\n\n# T\n";
	const next = edit(raw, { key: "description", value: "d" });
	expect(next).toContain("# a comment\ntype:   Metric   ");
	expect(next).toContain("nested:\n  keep: me\nauthor: x");
	expect(next).toContain('description: "d"');
	expect(edit(DOC)).toBeNull();
});
