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
	AGENTS_BODY_OKF,
	AGENTS_END,
	writeAgentsBlock,
} from "../src/core/agents.js";
import { writeConfig } from "../src/core/config.js";
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

test("writeAgentsBlock picks the body from the config's mode – same v1 fences", () => {
	// No config (or a legacy one) ⇒ the plain body, byte-for-byte.
	writeAgentsBlock(root);
	expect(read()).toBe(`${AGENTS_BEGIN}\n${AGENTS_BODY}${AGENTS_END}\n`);

	// OKF mode recorded ⇒ the taught variant, nothing else about the splice
	// changes: the OKF section rides AGENTS_BODY verbatim inside the fences.
	writeConfig(root, ".", true);
	writeAgentsBlock(root);
	// The file already existed (created plain above): the refresh never adds
	// frontmatter to it – creation-only, `validate --fix` owns the rest.
	expect(read()).toBe(`${AGENTS_BEGIN}\n${AGENTS_BODY_OKF}${AGENTS_END}\n`);
	expect(AGENTS_BODY_OKF.startsWith(AGENTS_BODY)).toBe(true);
	expect(AGENTS_BODY_OKF).toContain("## OKF rules");
});

test("OKF config: a created AGENTS.md is born with the frontmatter prefix", () => {
	writeConfig(root, ".", true);
	writeAgentsBlock(root);
	expect(read()).toBe(
		`---\ntype: concept\nstatus: "draft"\n---\n${AGENTS_BEGIN}\n${AGENTS_BODY_OKF}${AGENTS_END}\n`,
	);
});

test("OKF config: refresh preserves existing frontmatter exactly – no duplication", () => {
	writeConfig(root, ".", true);
	const mine = '---\ntype: tutorial\nstatus: "stable"\nnote: mine\n---\n';
	writeFileSync(
		join(root, "AGENTS.md"),
		`${mine}${AGENTS_BEGIN}\nSTALE\n${AGENTS_END}\n`,
	);
	writeAgentsBlock(root);
	expect(read()).toBe(
		`${mine}${AGENTS_BEGIN}\n${AGENTS_BODY_OKF}${AGENTS_END}\n`,
	);
});

test("isAgent: exact-name membership against the config list", () => {
	expect(isAgent("Claude", ["Claude", "Rex"])).toBe(true);
	expect(isAgent("claude", ["Claude"])).toBe(false);
	expect(isAgent("Anyone", [])).toBe(false);
});
