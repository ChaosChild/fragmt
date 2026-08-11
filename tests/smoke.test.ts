import { expect, test } from "vitest";

import { usage } from "../src/cli/index.js";

test("CLI usage advertises the init and serve commands", () => {
	expect(usage).toMatch(/init/);
	expect(usage).toMatch(/serve/);
});
