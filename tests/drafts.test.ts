import { expect, test } from "vitest";
import { nextDraftName } from "../src/core/drafts.js";

// nextDraftName is pure — slug rules and collision suffixes, no git involved.

test("slug: basename minus .md, lowercase, non-[a-z0-9] → '-', trimmed", () => {
	expect(nextDraftName([], "docs/M4-2-drafting.md")).toBe(
		"drafts/m4-2-drafting",
	);
	expect(nextDraftName([], "M4-2-drafting.md")).toBe("drafts/m4-2-drafting");
	expect(nextDraftName([], "PLAN.md")).toBe("drafts/plan");
	expect(nextDraftName([], "My Doc! v2.md")).toBe("drafts/my-doc--v2");
	expect(nextDraftName([], "_Notes_.md")).toBe("drafts/notes");
});

test("collisions append -2, -3, …; free base name taken as-is", () => {
	expect(nextDraftName(["drafts/other"], "plan.md")).toBe("drafts/plan");
	expect(nextDraftName(["drafts/plan"], "plan.md")).toBe("drafts/plan-2");
	expect(nextDraftName(["drafts/plan", "drafts/plan-2"], "plan.md")).toBe(
		"drafts/plan-3",
	);
	// A taken suffixed name does not displace the free base name.
	expect(nextDraftName(["drafts/plan-2"], "plan.md")).toBe("drafts/plan");
});
