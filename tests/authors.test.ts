// The rung-B classification + notice, the pure side of init/serve's
// avatar-path check: the same buckets avatarUser (ui/src/display.ts) resolves
// by, deduped, and the capped notice text.
import { describe, expect, test } from "vitest";
import { authorsNotice, classifyAuthorEmails } from "../src/core/index.js";

describe("classifyAuthorEmails", () => {
	test("mapped via the config map, both noreply shapes, plain emails unresolvable", () => {
		expect(
			classifyAuthorEmails(
				[
					"me@work.dev",
					"octocat@users.noreply.github.com",
					"583231+hubot@users.noreply.github.com",
					"owner@example.com",
				],
				{ "me@work.dev": "octocat" },
			),
		).toEqual({
			mapped: ["me@work.dev"],
			noreply: [
				"octocat@users.noreply.github.com",
				"583231+hubot@users.noreply.github.com",
			],
			unresolvable: ["owner@example.com"],
		});
	});

	test("repeated emails dedupe – each bucket holds unique entries", () => {
		expect(classifyAuthorEmails(["a@x.dev", "a@x.dev", "a@x.dev"], {})).toEqual(
			{ mapped: [], noreply: [], unresolvable: ["a@x.dev"] },
		);
	});

	test("the map wins even over a noreply-shaped email (avatarUser's order)", () => {
		const email = "123456+hubot@users.noreply.github.com";
		expect(classifyAuthorEmails([email], { [email]: "explicit" })).toEqual({
			mapped: [email],
			noreply: [],
			unresolvable: [],
		});
	});
});

describe("authorsNotice", () => {
	test("null when every author resolves", () => {
		expect(authorsNotice([])).toBeNull();
	});

	test("count, the full short list, and the first-email config snippet", () => {
		expect(authorsNotice(["one@example.com", "two@example.com"])).toBe(
			"⚠ 2 commit author(s) have no avatar path:\n" +
				"  one@example.com, two@example.com\n" +
				'  add to .fragmt.json:  "authors": { "one@example.com": "login" }\n',
		);
	});

	test("the list caps at 3 visible + '+N more'; the snippet keeps the first", () => {
		const notice = authorsNotice([
			"1@x.dev",
			"2@x.dev",
			"3@x.dev",
			"4@x.dev",
			"5@x.dev",
		]);
		expect(notice).toContain("5 commit author(s)");
		expect(notice).toContain("1@x.dev, 2@x.dev, 3@x.dev +2 more");
		expect(notice).not.toContain("4@x.dev");
		expect(notice).toContain('"authors": { "1@x.dev": "login" }');
	});
});
