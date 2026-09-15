// #16 nested docs repo: the outer AGENTS.md redirect block (content + the
// shared marker-splice: file absent / unmarked / replaces the old body) and
// initNestedRepo's folder validation. The git mechanics (init/add/commit)
// need a real repo – e2e territory, not here.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import {
	AGENTS_BEGIN,
	AGENTS_BODY,
	AGENTS_END,
	AGENTS_OUTER_BODY,
	writeOuterAgentsBlock,
} from "../src/core/agents.js";
import { ConfigError } from "../src/core/config.js";
import { initNestedRepo } from "../src/core/init.js";

let root: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "fragmt-nested-"));
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

const read = () => readFileSync(join(root, "AGENTS.md"), "utf8");
const outerBlock = (folder: string) =>
	`${AGENTS_BEGIN}\n${AGENTS_OUTER_BODY(folder)}${AGENTS_END}`;

test("AGENTS_OUTER_BODY names the folder and locks the redirect meaning", () => {
	expect(AGENTS_OUTER_BODY("docs")).toBe(
		`## fragmt – docs live in the nested repo at docs/
Do NOT edit docs in this repo. \`cd docs\` and follow the AGENTS.md there; fragmt commands run from that root.
`,
	);
});

test("writeOuterAgentsBlock creates AGENTS.md holding only the block", () => {
	writeOuterAgentsBlock(root, "docs");
	expect(read()).toBe(`${outerBlock("docs")}\n`);
});

test("writeOuterAgentsBlock appends after a blank line to an unmarked file", () => {
	const mine = "# My repo\n\nMy own rules."; // no trailing \n
	writeFileSync(join(root, "AGENTS.md"), mine);
	writeOuterAgentsBlock(root, "docs");
	expect(read()).toBe(`${mine}\n\n${outerBlock("docs")}\n`);
});

test("writeOuterAgentsBlock replaces the standard block between the markers", () => {
	// The plain init's block becomes the redirect; nothing else moves.
	const before = "# Mine before\n";
	const after = "# Mine after";
	writeFileSync(
		join(root, "AGENTS.md"),
		`${before}${AGENTS_BEGIN}\n${AGENTS_BODY}${AGENTS_END}\n${after}`,
	);
	writeOuterAgentsBlock(root, "docs");
	expect(read()).toBe(`${before}${outerBlock("docs")}\n${after}`);
});

test("writeOuterAgentsBlock refreshes an older redirect to a new folder", () => {
	writeOuterAgentsBlock(root, "docs");
	writeOuterAgentsBlock(root, "documentation");
	expect(read()).toBe(`${outerBlock("documentation")}\n`);
});

test("initNestedRepo rejects folders that escape, are absolute, or are the outer root", async () => {
	await expect(initNestedRepo(root, "../outside")).rejects.toThrow(ConfigError);
	await expect(initNestedRepo(root, ".")).rejects.toThrow(ConfigError);
	await expect(initNestedRepo(root, join(root, "docs"))).rejects.toThrow(
		ConfigError,
	);
});

test("initNestedRepo rejects a folder occupied by a file", async () => {
	writeFileSync(join(root, "occupied"), "not a dir");
	await expect(initNestedRepo(root, "occupied")).rejects.toThrow(ConfigError);
});
