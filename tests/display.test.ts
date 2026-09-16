// The avatar's email → user contract (owner round: initials where a GitHub
// avatar was expected), plus the metadata editor's stale_after conversion
// (#33): datetime-local ↔ ISO and the §5.5 chip staleness – pure,
// timezone-honest (the browser-local input converts through the local
// clock; the round trip is what must hold).
import { describe, expect, test } from "vitest";
import {
	avatarUser,
	isReservedDoc,
	isoToLocal,
	isStaleIso,
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
