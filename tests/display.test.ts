// The avatar's email → user contract (owner round: initials where a GitHub
// avatar was expected). Pure resolution, tested without React (highlight's
// model): the authors map first, the two GitHub noreply forms keyless, a
// plain git email resolves only through the map.
import { describe, expect, test } from "vitest";
import { avatarUser } from "../ui/src/display.js";

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
