// OKF rung 4 (#33): trust stamping and derivation, pure – stampGenerated's
// one-line flow mapping (rewritten in place), appendVerified's empty→list,
// bare-mapping→migrate (§5.2's MUST), and list→append walks (including the
// spec's canonical block-form YAML, which must not leave orphan lines),
// actorOf/AGENT_DEFAULT (D3/D4), trustTier's §5.3 boundaries, and isStale's
// §5.5 comparison with malformed-date tolerance. The commit-wrapped flows
// live in okf-agent-actor.test.ts.
import matter from "gray-matter";
import { expect, test } from "vitest";
import {
	AGENT_DEFAULT,
	actorOf,
	appendVerified,
	isStale,
	stampGenerated,
	trustTier,
} from "../src/core/index.js";

const DOC = "---\ntype: Metric\ntitle: T\n---\n\n# T\n";
const front = (text: string) =>
	matter(text, {}).data as Record<string, unknown>;
const iso = (v: unknown) =>
	typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v);

// --- stampGenerated ----------------------------------------------------------

test("stampGenerated writes one flow-mapping line, appended at the fence end", () => {
	const next = stampGenerated(DOC, "human:alice") ?? "";
	const gen = front(next).generated as { by: string; at: string };
	expect(next).toBe(
		`---\ntype: Metric\ntitle: T\ngenerated: { by: "human:alice", at: "${gen.at}" }\n---\n\n# T\n`,
	);
	expect(gen.by).toBe("human:alice");
	expect(iso(gen.at)).toBe(true);
});

test("stampGenerated rewrites in place; a fence-less doc gains type first", () => {
	const existing =
		'---\ntype: Metric\ngenerated: { by: "old/1", at: "2026-01-01T00:00:00.000Z" }\ntitle: T\n---\n\n# T\n';
	const next = stampGenerated(existing, "claude/4.5") ?? "";
	expect(next.split("\n")).toHaveLength(existing.split("\n").length);
	expect((front(next).generated as { by: string }).by).toBe("claude/4.5");
	// Neighbors keep their positions.
	expect(next.indexOf("type: Metric")).toBeLessThan(next.indexOf("generated:"));
	expect(next.indexOf("generated:")).toBeLessThan(next.indexOf("title: T"));

	const fenceless = stampGenerated("# bare\n", "process:nightly") ?? "";
	const bare = front(fenceless).generated as { by: string; at: string };
	expect(fenceless).toBe(
		`---\ntype: "concept"\ngenerated: { by: "process:nightly", at: "${bare.at}" }\n---\n# bare\n`,
	);
});

// --- appendVerified ----------------------------------------------------------

test("appendVerified: absent key becomes a one-event list", () => {
	const next = appendVerified(DOC, "human:alice") ?? "";
	const events = front(next).verified as { by: string; at: string }[];
	expect(events).toHaveLength(1);
	expect(events[0].by).toBe("human:alice");
	expect(iso(events[0].at)).toBe(true);
	expect(next).toContain("verified: [{ by: ");
});

test("appendVerified: a bare mapping migrates to a two-element list (§5.2)", () => {
	// Hand-written shorthand: js-yaml hands `at` over as a Date – the
	// migration normalizes it to an ISO string.
	const bare =
		"---\ntype: Metric\nverified: { by: human:alice, at: 2026-06-25T09:00:00Z }\n---\n\n# T\n";
	const next = appendVerified(bare, "process:nightly") ?? "";
	const events = front(next).verified as { by: string; at: string }[];
	expect(events).toHaveLength(2);
	expect(events[0]).toEqual({
		by: "human:alice",
		at: "2026-06-25T09:00:00.000Z",
	});
	expect(events[1].by).toBe("process:nightly");
});

test("appendVerified: an existing list appends; block-form YAML leaves no orphans", () => {
	const flow =
		'---\ntype: Metric\nverified: [{ by: "a/1", at: "2026-01-01T00:00:00.000Z" }, { by: "b/2", at: "2026-02-01T00:00:00.000Z" }]\n---\n\n# T\n';
	expect(
		(front(appendVerified(flow, "human:bob") ?? "").verified as unknown[])
			.length,
	).toBe(3);

	// The spec's canonical block shape: the key line AND its indented items
	// are replaced by the one flow line – stray `  - …` lines after it would
	// break the next parse.
	const block =
		"---\ntype: Metric\nverified:\n  - { by: human:alice, at: 2026-06-25T09:00:00Z }\ntitle: T\n---\n\n# T\n";
	const next = appendVerified(block, "human:bob") ?? "";
	expect(front(next).verified).toEqual([
		{ by: "human:alice", at: "2026-06-25T09:00:00.000Z" },
		expect.objectContaining({ by: "human:bob" }),
	]);
	// Column-0 dashes are the fence; an orphaned item would be indented.
	expect(next).not.toMatch(/^[ \t]+-/m);
	expect(next.indexOf("title: T")).toBeGreaterThan(next.indexOf("verified:"));
});

// --- actorOf / AGENT_DEFAULT ---------------------------------------------------

test("actorOf: the email local-part under human:; AGENT_DEFAULT never claims human", () => {
	expect(actorOf({ name: "Alice", email: "alice@example.com" })).toBe(
		"human:alice",
	);
	expect(actorOf({ name: "B", email: "first.last@work.dev" })).toBe(
		"human:first.last",
	);
	expect(actorOf({ name: "C", email: "no-at-sign" })).toBe("human:no-at-sign");
	expect(AGENT_DEFAULT).toBe("fragmt-agent/unspecified");
	expect(AGENT_DEFAULT.startsWith("human:")).toBe(false);
});

// --- trustTier (§5.3) ----------------------------------------------------------

test("trustTier: none → unverified, machine-only → machine-confirmed, any human: → human-reviewed", () => {
	expect(trustTier({})).toBe("unverified");
	expect(trustTier({ verified: [] })).toBe("unverified");
	expect(trustTier({ verified: 42 })).toBe("unverified"); // hand-mangled
	expect(
		trustTier({
			verified: [
				{ by: "process:nightly", at: "2026-01-01T00:00:00.000Z" },
				{ by: "claude/4.5", at: "2026-02-01T00:00:00.000Z" },
			],
		}),
	).toBe("machine-confirmed");
	// The bare mapping is a one-element list (§5.2 MUST).
	expect(
		trustTier({ verified: { by: "human:alice", at: "2026-01-01T00:00:00Z" } }),
	).toBe("human-reviewed");
	expect(
		trustTier({
			verified: [
				{ by: "process:nightly", at: "2026-01-01T00:00:00.000Z" },
				{ by: "human:alice", at: "2026-02-01T00:00:00.000Z" },
				{ by: "bot/9", at: "2026-03-01T00:00:00.000Z" },
			],
		}),
	).toBe("human-reviewed");
});

// --- isStale (§5.5) -------------------------------------------------------------

test("isStale: now >= stale_after; malformed values read fresh, never throw", () => {
	const now = new Date("2026-09-16T12:00:00.000Z");
	const at = (v: unknown) => ({ stale_after: v });
	expect(isStale(at("2026-09-15T00:00:00Z"), now)).toBe(true); // past
	expect(isStale(at("2026-09-16T12:00:00Z"), now)).toBe(true); // boundary
	expect(isStale(at("2026-09-17T00:00:00Z"), now)).toBe(false); // future
	// Hand-written YAML hands unquoted timestamps over as Dates.
	expect(isStale(at(new Date("2026-09-15T00:00:00Z")), now)).toBe(true);
	expect(isStale(at(new Date("2026-09-17T00:00:00Z")), now)).toBe(false);
	// Malformed and absent values are fresh, never a throw.
	for (const v of ["not a date", "", 42, null, {}, undefined]) {
		expect(isStale(at(v), now), String(v)).toBe(false);
	}
	expect(isStale({}, now)).toBe(false);
});
