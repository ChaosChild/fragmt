// M4-4 b5: the AGENTS.md managed block in isolation – create, append to an
// unmarked file, replace between the markers (nothing outside ever moves) –
// plus the rail agent-chip predicate. initRepo's write/refresh and the
// config/meta plumbing live in config.test.ts / meta.test.ts.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import {
	AGENTS_BEGIN,
	AGENTS_BODY,
	AGENTS_END,
	writeAgentsBlock,
} from "../src/core/agents.js";
import { isAgent } from "../ui/src/display.js";

let root: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "fragmt-agents-"));
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

const read = () => readFileSync(join(root, "AGENTS.md"), "utf8");
const block = () => `${AGENTS_BEGIN}\n${AGENTS_BODY}${AGENTS_END}`;

test("writeAgentsBlock creates AGENTS.md holding only the block", () => {
	writeAgentsBlock(root);
	expect(read()).toBe(`${block()}\n`);
});

test("writeAgentsBlock appends after a blank line to an unmarked file", () => {
	const mine = "# My repo\n\nRules of my own, byte-for-byte."; // no trailing \n
	writeFileSync(join(root, "AGENTS.md"), mine);
	writeAgentsBlock(root);
	expect(read()).toBe(`${mine}\n\n${block()}\n`);
});

test("writeAgentsBlock replaces exactly between the markers", () => {
	const before = "# Mine before\n";
	const after = "# Mine after (no trailing newline)";
	writeFileSync(
		join(root, "AGENTS.md"),
		`${before}${AGENTS_BEGIN}\nSTALE v0 copy\n${AGENTS_END}\n${after}`,
	);
	writeAgentsBlock(root);
	expect(read()).toBe(`${before}${block()}\n${after}`);
});

test("a lone end marker counts as unmarked – append, not replace", () => {
	const mine = "# Mine\n";
	writeFileSync(join(root, "AGENTS.md"), `${mine}${AGENTS_END}\n`);
	writeAgentsBlock(root);
	expect(read()).toBe(`${mine}${AGENTS_END}\n\n${block()}\n`);
});

test("isAgent: exact-name membership against the config list", () => {
	expect(isAgent("Claude", ["Claude", "Rex"])).toBe(true);
	expect(isAgent("claude", ["Claude"])).toBe(false);
	expect(isAgent("Anyone", [])).toBe(false);
});
