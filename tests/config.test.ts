import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { AGENTS_BEGIN, AGENTS_BODY, AGENTS_END } from "../src/core/agents.js";
import {
	ConfigError,
	configPath,
	initRepo,
	loadConfig,
	writeConfig,
} from "../src/core/index.js";

let root: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "fragmt-cfg-"));
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

test("writeConfig writes docsRoot + reserved order {}", () => {
	writeConfig(root, "docs");
	const raw = JSON.parse(readFileSync(configPath(root), "utf8"));
	expect(raw).toEqual({ docsRoot: "docs", order: {} });
});

test("loadConfig round-trips docsRoot", () => {
	writeConfig(root, ".");
	expect(loadConfig(root)).toEqual({ docsRoot: "." });
});

test("loadConfig throws when not initialized", () => {
	expect(() => loadConfig(root)).toThrow(ConfigError);
});

test("loadConfig fails loudly with the file path on malformed JSON", () => {
	writeFileSync(configPath(root), "{not json");
	expect(() => loadConfig(root)).toThrow(/fragmt-cfg-/);
});

test("loadConfig rejects a config missing docsRoot", () => {
	writeFileSync(configPath(root), JSON.stringify({ order: {} }));
	expect(() => loadConfig(root)).toThrow(ConfigError);
});

test("initRepo writes the config and counts adopted docs", () => {
	mkdirSync(join(root, "docs"), { recursive: true });
	writeFileSync(join(root, "docs", "a.md"), "# a");
	writeFileSync(join(root, "docs", "b.md"), "# b");
	writeFileSync(join(root, "README.md"), "# readme");

	const result = initRepo(root, ".");
	expect(result).toEqual({ alreadyInitialized: false, count: 3 });
	expect(existsSync(configPath(root))).toBe(true);
	expect(loadConfig(root)).toEqual({ docsRoot: "." });
});

test("initRepo refuses to overwrite an existing config", () => {
	writeConfig(root, "docs");
	const result = initRepo(root, ".");
	// Already initialized → no rewrite, no error.
	expect(result.alreadyInitialized).toBe(true);
	// The original docsRoot is preserved.
	expect(loadConfig(root)).toEqual({ docsRoot: "docs" });
});

test("initRepo rejects a docs root that escapes the repo", () => {
	expect(() => initRepo(root, "../outside")).toThrow(ConfigError);
});

test("initRepo rejects a nonexistent docs root", () => {
	expect(() => initRepo(root, "nope")).toThrow(ConfigError);
});

// --- M4-3: optional authors map (email → GitHub username) ------------------

test("loadConfig parses the authors map", () => {
	writeFileSync(
		configPath(root),
		JSON.stringify({
			docsRoot: ".",
			authors: { "a@example.com": "alice", "b@example.com": "bob-gh" },
		}),
	);
	expect(loadConfig(root)).toEqual({
		docsRoot: ".",
		authors: { "a@example.com": "alice", "b@example.com": "bob-gh" },
	});
});

test("loadConfig drops invalid authors entries silently", () => {
	writeFileSync(
		configPath(root),
		JSON.stringify({
			docsRoot: ".",
			authors: {
				"a@example.com": "alice",
				"empty@example.com": "",
				"num@example.com": 42,
				"nil@example.com": null,
			},
		}),
	);
	expect(loadConfig(root)).toEqual({
		docsRoot: ".",
		authors: { "a@example.com": "alice" },
	});
});

test("loadConfig: absent authors stays undefined; a non-object is ignored", () => {
	writeConfig(root, ".");
	expect(loadConfig(root).authors).toBeUndefined();

	writeFileSync(
		configPath(root),
		JSON.stringify({ docsRoot: ".", authors: ["a@example.com"] }),
	);
	expect(loadConfig(root).authors).toBeUndefined();
	expect(loadConfig(root)).toEqual({ docsRoot: "." });

	writeFileSync(
		configPath(root),
		JSON.stringify({ docsRoot: ".", authors: "nope" }),
	);
	expect(loadConfig(root).authors).toBeUndefined();
});

// --- M4-4 b5: optional agents list (display names → the agent chip) --------

test("initRepo writes the AGENTS.md block; a re-run refreshes it", () => {
	mkdirSync(join(root, "docs"), { recursive: true });
	initRepo(root, "docs");
	const file = join(root, "AGENTS.md");
	const fresh = readFileSync(file, "utf8");
	expect(fresh).toBe(`${AGENTS_BEGIN}\n${AGENTS_BODY}${AGENTS_END}\n`);

	// A stale block between the markers, foreign content around it.
	writeFileSync(file, `# mine\n${AGENTS_BEGIN}\nstale copy\n${AGENTS_END}`);
	expect(initRepo(root, "docs").alreadyInitialized).toBe(true);
	expect(readFileSync(file, "utf8")).toBe(`# mine\n${fresh.slice(0, -1)}`);
});

test("loadConfig parses the agents list", () => {
	writeFileSync(
		configPath(root),
		JSON.stringify({ docsRoot: ".", agents: ["Claude", "Rex"] }),
	);
	expect(loadConfig(root).agents).toEqual(["Claude", "Rex"]);
});

test("loadConfig drops invalid agents entries silently", () => {
	writeFileSync(
		configPath(root),
		JSON.stringify({ docsRoot: ".", agents: ["Claude", 42, "", null] }),
	);
	expect(loadConfig(root).agents).toEqual(["Claude"]);
});

test("loadConfig: absent agents stays undefined; a non-array is ignored", () => {
	writeConfig(root, ".");
	expect(loadConfig(root).agents).toBeUndefined();

	writeFileSync(configPath(root), JSON.stringify({ docsRoot: "." }));
	expect(loadConfig(root).agents).toBeUndefined();
	expect(loadConfig(root)).toEqual({ docsRoot: "." });

	writeFileSync(
		configPath(root),
		JSON.stringify({ docsRoot: ".", agents: "nope" }),
	);
	expect(loadConfig(root).agents).toBeUndefined();
});
