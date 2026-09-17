// The avatar's email → user contract (owner round: initials where a GitHub
// avatar was expected), plus the metadata editor's stale_after conversion
// (#33): datetime-local ↔ ISO and the §5.5 chip staleness – pure,
// timezone-honest (the browser-local input converts through the local
// clock; the round trip is what must hold).
import { describe, expect, test } from "vitest";
import {
	avatarUser,
	extensionRows,
	isoToLocal,
	isReservedDoc,
	isStaleIso,
	metaViewRows,
	toIsoUtc,
} from "../ui/src/display.js";

describe("avatarUser", () => {
	test("the authors map wins – any email shape resolves through it", () => {
		expect(avatarUser("me@work.dev", { "me@work.dev": "octocat" })).toBe(
			"octocat",
		);
		expect(
			avatarUser("123456+octocat@users.noreply.github.com", {
				"123456+octocat@users.noreply.github.com": "hubot",
			}),
		).toBe("hubot");
	});

	test("the bare noreply form resolves the login", () => {
		expect(avatarUser("octocat@users.noreply.github.com", {})).toBe("octocat");
	});

	test("the <id>+<login> noreply form (the auth era's commitAuthor) resolves the login", () => {
		expect(avatarUser("583231+octocat@users.noreply.github.com", {})).toBe(
			"octocat",
		);
	});

	test("a plain (non-noreply) email without a map entry is undefined", () => {
		expect(avatarUser("owner@example.com", {})).toBeUndefined();
	});
});

describe("toIsoUtc / isoToLocal", () => {
	test("a datetime-local value converts to ISO UTC and seeds back losslessly", () => {
		const iso = toIsoUtc("2027-06-01T12:00");
		expect(iso).toMatch(/^2027-06-01T\d{2}:00:00\.000Z$/); // hour rides the local zone
		expect(isoToLocal(iso)).toBe("2027-06-01T12:00");
	});

	test("empty and unparseable values read as unset, never as epoch", () => {
		expect(toIsoUtc("")).toBe("");
		expect(toIsoUtc("not a date")).toBe("");
		expect(isoToLocal(null)).toBe("");
		expect(isoToLocal("junk")).toBe("");
	});
});

describe("isStaleIso (the badge chips' §5.5 rule)", () => {
	test("now >= stale_after, boundary inclusive; missing/malformed reads fresh", () => {
		expect(isStaleIso("2020-01-01T00:00:00Z")).toBe(true);
		expect(isStaleIso("2999-01-01T00:00:00Z")).toBe(false);
		expect(
			isStaleIso("2999-01-01T00:00:00Z", Date.parse("2999-01-01T00:00:00Z")),
		).toBe(true);
		expect(isStaleIso(undefined)).toBe(false);
		expect(isStaleIso("junk")).toBe(false);
	});
});

test("isReservedDoc: basename match, path-aware, case-insensitive (§3.1)", () => {
	expect(isReservedDoc("index.md")).toBe(true);
	expect(isReservedDoc("docs/sub/INDEX.MD")).toBe(true);
	expect(isReservedDoc("log.md")).toBe(true);
	expect(isReservedDoc("docs/logs.md")).toBe(false);
	expect(isReservedDoc("my-index.md")).toBe(false);
});

// Operator round C: the metadata editor's §4.1 extension rows – the
// partitioning the form renders from (scalars editable, everything else
// read-only, the mirror's named keys never rows).
describe("extensionRows (the §4.1 extension-row partitioning)", () => {
	test("scalars become editable rows (stringified), named keys never do", () => {
		const rows = extensionRows({
			type: "concept",
			title: "Named",
			verified: [{ by: "human:x" }],
			references: [],
			owner: "ops",
			priority: 2,
			published: true,
		});
		expect(rows.editable).toEqual([
			{ key: "owner", value: "ops" },
			{ key: "priority", value: "2" },
			{ key: "published", value: "true" },
		]);
		expect(rows.readOnly).toEqual([]);
	});

	test("string arrays (and anything else) render read-only, JSON-stringified; null edits as empty", () => {
		const rows = extensionRows({
			"reviewed-by": ["alice", "bob"],
			missing: null,
		});
		expect(rows.editable).toEqual([{ key: "missing", value: "" }]);
		expect(rows.readOnly).toEqual([
			{ key: "reviewed-by", value: '["alice","bob"]' },
		]);
	});
});

// Operator round D: the metadata view block's rows – curated + §4.1
// extension + the managed/derived family, friendly-formatted. `fmt` is
// injected so the date words are fixture-stable.
describe("metaViewRows (the metadata view block)", () => {
	const fmt = (iso: string) => `«${iso}»`;

	test("one row per key, curated first, then extensions, then managed", () => {
		const rows = metaViewRows(
			{
				type: "decision",
				description: "why",
				tags: ["x", "y"],
				status: "draft",
				stale_after: "2027-06-01T00:00:00Z",
				owner: "ops",
				"reviewed-by": ["alice"],
				generated: { by: "human:a", at: "2026-09-16T00:00:00Z" },
				verified: [
					{ by: "human:b", at: "2026-09-16T01:00:00Z" },
					{ by: "human:a", at: "2026-09-16T02:00:00Z" },
				],
				references: ["b.md"],
				"referenced-by": ["c.md", "d.md"],
			},
			fmt,
		);
		expect(rows).toEqual([
			{ key: "type", value: "decision" },
			{ key: "description", value: "why" },
			{ key: "tags", value: "x, y" },
			{ key: "status", value: "draft" },
			{ key: "stale_after", value: "«2027-06-01T00:00:00Z»" },
			{ key: "owner", value: "ops" },
			{ key: "reviewed-by", value: '["alice"]' },
			{ key: "generated", value: "human:a · «2026-09-16T00:00:00Z»" },
			{
				key: "verified",
				value: "2 events · latest by human:a «2026-09-16T02:00:00Z»",
			},
			{ key: "references", value: "b.md" },
			{ key: "referenced-by", value: "c.md, d.md" },
		]);
	});

	test("absent keys render no row; undated stamps and events degrade", () => {
		const rows = metaViewRows(
			{
				type: "concept",
				generated: { by: "fragmt-agent/x" },
				verified: [{ by: "human:b" }],
			},
			fmt,
		);
		expect(rows).toEqual([
			{ key: "type", value: "concept" },
			{ key: "generated", value: "fragmt-agent/x" },
			{ key: "verified", value: "1 event · latest by human:b" },
		]);
	});
});
