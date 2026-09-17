import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { createApp, startServer } from "../src/server/index.js";

// OKF rungs 3–4 server surface (#33): the doc payload's curated frontmatter
// (the metadata editor's and the References pane's data source), the PATCH
// {meta} dispatch, the standalone verify route, the PUT verified flag, and
// /api/meta's badge fields. Same harness as server-okf.test.ts – a real git
// repo behind the app; writeConfig flips OKF mode per test.

let root: string;
let server: Server;
let port: number;

beforeEach(async () => {
	root = mkdtempSync(join(tmpdir(), "fragmt-okf-meta-"));
	execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
	execFileSync("git", ["config", "user.name", "OKF Test"], { cwd: root });
	execFileSync("git", ["config", "user.email", "okf@example.com"], {
		cwd: root,
	});
	execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: root });
	writeConfig(false);
	// `secret` rides every payload/splice test: unknown keys never leave the
	// server, and never lose their bytes to a metadata edit.
	writeFileSyncLF("a.md", "---\ntype: concept\nsecret: keep\n---\n# a\n");
	execFileSync("git", ["add", "-A"], { cwd: root });
	execFileSync("git", ["commit", "-q", "-m", "seed"], { cwd: root });

	const app = createApp({ repoRoot: root, docsRoot: "." });
	port = await new Promise<number>((resolve) => {
		server = startServer(app, 0, resolve);
	});
});

afterEach(() => {
	server.close();
	rmSync(root, { recursive: true, force: true });
});

/** Write .fragmt.json (fs-read per request – no commit needed). */
function writeConfig(okf: boolean) {
	writeFileSync(
		join(root, ".fragmt.json"),
		`${JSON.stringify({ docsRoot: ".", order: {}, ...(okf ? { okf: true } : {}) }, null, "\t")}\n`,
	);
}

function writeFileSyncLF(path: string, text: string) {
	writeFileSync(join(root, path), text);
}

function commitFiles(message: string) {
	execFileSync("git", ["add", "-A"], { cwd: root });
	execFileSync("git", ["commit", "-q", "-m", message], { cwd: root });
}

function api(method: string, path: string, body?: unknown): Promise<Response> {
	return fetch(`http://localhost:${port}${path}`, {
		method,
		...(body === undefined
			? {}
			: {
					headers: { "content-type": "application/json" },
					body: JSON.stringify(body),
				}),
	});
}

/** Raw git against the server's repo, independent of the code under test. */
function gitOut(args: string[]): string {
	return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function commits(): number {
	return Number(gitOut(["rev-list", "--count", "HEAD"]));
}

// --- GET /api/docs/*: the curated frontmatter payload ------------------------

test("GET payload (OKF): curated keys + §4.1 pass-through – objects and raw bytes withheld, verified list-normalized", async () => {
	writeConfig(true);
	writeFileSyncLF(
		"b.md",
		[
			"---",
			"type: concept",
			"title: B",
			"tags: [x, y]",
			"status: draft",
			"generated: { by: human:b, at: 2026-09-16T00:00:00Z }",
			"verified: { by: human:b, at: 2026-09-16T00:00:00Z }",
			"references: [a.md]",
			"secret: keep",
			"okf_version: 0.2",
			"hidden: { deep: true }",
			"---",
			"# b",
			"",
		].join("\n"),
	);
	commitFiles("add b");

	const res = await api("GET", "/api/docs/b.md");
	expect(res.status).toBe(200);
	const body = (await res.json()) as Record<string, unknown>;
	// The References pane's data source + the editor's fields; the bare
	// verified mapping reads as a one-element list (§5.2); the raw bytes
	// never leave the server; empty lists are omitted entirely. Operator
	// round C: the scalar `secret` passes through PARSED (the §4.1 extension
	// rows' data), while the managed okf_version and the object `hidden`
	// stay home.
	expect(body.frontmatter).toEqual({
		title: "B",
		type: "concept",
		tags: ["x", "y"],
		status: "draft",
		generated: { by: "human:b", at: "2026-09-16T00:00:00.000Z" },
		verified: [{ by: "human:b", at: "2026-09-16T00:00:00.000Z" }],
		references: ["a.md"],
		secret: "keep",
	});
	expect(body).not.toHaveProperty("rawFrontmatter");
});

test("GET payload (§4.1 pass-through): scalars and string arrays pass parsed, objects never leave", async () => {
	writeConfig(true);
	writeFileSyncLF(
		"e.md",
		[
			"---",
			"type: concept",
			"owner: ops",
			"priority: 2",
			"published: true",
			"reviewed-by: [alice, bob]",
			"nested: { keep: me }",
			"mixed: [one, { two: 2 }]",
			"---",
			"# e",
			"",
		].join("\n"),
	);
	commitFiles("add e");

	const body = (await (await api("GET", "/api/docs/e.md")).json()) as {
		frontmatter: Record<string, unknown>;
	};
	expect(body.frontmatter.owner).toBe("ops");
	expect(body.frontmatter.priority).toBe(2);
	expect(body.frontmatter.published).toBe(true);
	expect(body.frontmatter["reviewed-by"]).toEqual(["alice", "bob"]);
	expect(body.frontmatter).not.toHaveProperty("nested"); // objects stay home
	expect(body.frontmatter).not.toHaveProperty("mixed"); // non-string array items too
	expect(body).not.toHaveProperty("rawFrontmatter");
});

test("GET payload (non-OKF): same curation – title preserved, empties omitted, §4.1 pass-through rides along", async () => {
	const a = (await (await api("GET", "/api/docs/a.md")).json()) as {
		frontmatter: Record<string, unknown>;
	};
	// a.md carries type + secret only: the curated view is {type} plus the
	// passed-through scalar `secret` (operator round C) – title docs unchanged.
	expect(a.frontmatter).toEqual({ type: "concept", secret: "keep" });
});

// --- PATCH {meta}: the metadata editor's one-commit write --------------------

test("PATCH {meta}: fields land spliced, unknown keys byte-preserved, one commit", async () => {
	writeConfig(true);
	const res = await api("PATCH", "/api/docs/a.md", {
		meta: {
			type: "decision",
			description: "why",
			tags: ["x", "y"],
			status: "draft",
			stale_after: "2027-06-01T00:00:00.000Z",
		},
	});
	expect(res.status).toBe(200);
	const { sha } = (await res.json()) as { sha: string };
	expect(sha).toBe(gitOut(["rev-parse", "HEAD"])); // one commit for all fields
	expect(gitOut(["log", "--format=%s", "-1"])).toBe("Update metadata for a.md");
	expect(commits()).toBe(2); // seed + the edit
	const text = readFileSync(join(root, "a.md"), "utf8");
	expect(text).toContain('type: "decision"');
	expect(text).toContain('description: "why"');
	expect(text).toContain('tags: ["x", "y"]');
	expect(text).toContain('status: "draft"');
	expect(text).toContain('stale_after: "2027-06-01T00:00:00.000Z"');
	expect(text).toContain("secret: keep"); // byte-preserved, never re-serialized
	expect(text.endsWith("---\n# a\n")).toBe(true); // body untouched
});

test("PATCH {meta}: status outside the enum → 400, nothing written", async () => {
	writeConfig(true);
	const before = readFileSync(join(root, "a.md"), "utf8");
	const res = await api("PATCH", "/api/docs/a.md", {
		meta: { status: "bogus" },
	});
	expect(res.status).toBe(400);
	expect(((await res.json()) as { error: string }).error).toContain(
		"status must be one of",
	);
	expect(readFileSync(join(root, "a.md"), "utf8")).toBe(before);
	expect(commits()).toBe(1);
});

test("PATCH {meta}: non-editor keys and multi-action bodies → 400", async () => {
	writeConfig(true);
	const evil = await api("PATCH", "/api/docs/a.md", {
		meta: { verified: [{ by: "human:x" }] },
	});
	expect(evil.status).toBe(400); // the trust family is append-only, not editable
	const two = await api("PATCH", "/api/docs/a.md", {
		title: "t",
		meta: { type: "t" },
	});
	expect(two.status).toBe(400);
	const none = await api("PATCH", "/api/docs/a.md", {});
	expect(none.status).toBe(400);
	expect(commits()).toBe(1);
});

test("PATCH {meta}: null clears the key (the empty-means-absent rule)", async () => {
	writeConfig(true);
	await api("PATCH", "/api/docs/a.md", { meta: { description: "d" } });
	expect(readFileSync(join(root, "a.md"), "utf8")).toContain(
		'description: "d"',
	);
	const clear = await api("PATCH", "/api/docs/a.md", {
		meta: { description: null },
	});
	expect(clear.status).toBe(200);
	const text = readFileSync(join(root, "a.md"), "utf8");
	expect(text).not.toContain("description");
	expect(text).toContain("secret: keep");
});

test("PATCH {meta} (§4.1): arbitrary extension keys land spliced; managed keys and unsafe names are 400", async () => {
	writeConfig(true);
	const res = await api("PATCH", "/api/docs/a.md", {
		meta: { owner: "ops", "review queue": "daily" },
	});
	expect(res.status).toBe(200);
	const { sha } = (await res.json()) as { sha: string };
	expect(sha).toBe(gitOut(["rev-parse", "HEAD"])); // one commit for both keys
	const text = readFileSync(join(root, "a.md"), "utf8");
	expect(text).toContain('owner: "ops"');
	expect(text).toContain('review queue: "daily"');
	expect(text).toContain("secret: keep"); // still byte-preserved
	// null removes an extension key, the curated rule.
	const clear = await api("PATCH", "/api/docs/a.md", { meta: { owner: null } });
	expect(clear.status).toBe(200);
	expect(readFileSync(join(root, "a.md"), "utf8")).not.toContain("owner:");
	// Managed keys (derived/owned by other flows) are 400 `managed key`,
	// never a write.
	for (const key of [
		"generated",
		"verified",
		"references",
		"referenced-by",
		"title",
		"okf_version",
	]) {
		const managed = await api("PATCH", "/api/docs/a.md", {
			meta: { [key]: "x" },
		});
		expect(managed.status, key).toBe(400);
		expect(((await managed.json()) as { error: string }).error).toContain(
			"managed key",
		);
	}
	// Unsafe names (injection-shaped or off-grammar) are 400 before the core
	// seam; non-string values on extension keys are 400 too. Nothing written.
	const before = readFileSync(join(root, "a.md"), "utf8");
	const evil = await api("PATCH", "/api/docs/a.md", {
		meta: { "x: injected": "yes" },
	});
	expect(evil.status).toBe(400);
	const shaped = await api("PATCH", "/api/docs/a.md", {
		meta: { "\ninjected: yes": "x" },
	});
	expect(shaped.status).toBe(400);
	const typed = await api("PATCH", "/api/docs/a.md", {
		meta: { owner: 2 },
	});
	expect(typed.status).toBe(400);
	expect(((await typed.json()) as { error: string }).error).toContain(
		"must be a string or null",
	);
	expect(readFileSync(join(root, "a.md"), "utf8")).toBe(before);
});

// --- POST /api/docs/:doc/verify ----------------------------------------------

test("POST verify: the human event lands in its own commit", async () => {
	writeConfig(true);
	const res = await api("POST", "/api/docs/a.md/verify");
	expect(res.status).toBe(200);
	const { sha } = (await res.json()) as { sha: string };
	expect(sha).toBe(gitOut(["rev-parse", "HEAD"]));
	expect(gitOut(["log", "--format=%s", "-1"])).toBe("Verify a.md");
	expect(commits()).toBe(2);
	// The committing identity (okf@example.com) as the §7 actor.
	expect(readFileSync(join(root, "a.md"), "utf8")).toContain(
		'verified: [{ by: "human:okf"',
	);
});

test("POST verify: a missing doc is 404", async () => {
	writeConfig(true);
	const res = await api("POST", "/api/docs/nope.md/verify");
	expect(res.status).toBe(404);
});

// --- PUT verified: Save as Verified ------------------------------------------

test("PUT verified:true: the event rides the save's commit (stamp + event, one commit)", async () => {
	writeConfig(true);
	const doc = (await (await api("GET", "/api/docs/a.md")).json()) as {
		markdown: string;
		hash: string;
	};
	const res = await api("PUT", "/api/docs/a.md", {
		markdown: doc.markdown,
		baseHash: doc.hash,
		verified: true,
	});
	expect(res.status).toBe(200);
	const { sha } = (await res.json()) as { sha: string };
	expect(sha).toBe(gitOut(["rev-parse", "HEAD"]));
	expect(commits()).toBe(2); // the save commit alone carries everything
	expect(gitOut(["log", "--format=%s", "-1"])).toBe("Update a.md");
	const head = gitOut(["show", "HEAD:a.md"]);
	expect(head).toContain('generated: { by: "human:okf"'); // §5.2 stamp
	expect(head).toContain('verified: [{ by: "human:okf"'); // the save's event
	expect(head).toContain("secret: keep");
	// A non-boolean flag is a 400, never a write.
	const bad = await api("PUT", "/api/docs/a.md", {
		markdown: doc.markdown,
		baseHash: doc.hash,
		verified: "yes",
	});
	expect(bad.status).toBe(400);
	expect(commits()).toBe(2);
});

// --- PUT {meta}: the unified editor's riding write (operator round D) ---------

test("PUT {meta}: content and metadata land in one commit, stamp included", async () => {
	writeConfig(true);
	const doc = (await (await api("GET", "/api/docs/a.md")).json()) as {
		hash: string;
	};
	const res = await api("PUT", "/api/docs/a.md", {
		markdown: "# a v2\n",
		baseHash: doc.hash,
		meta: { description: "why", owner: "ops" },
	});
	expect(res.status).toBe(200);
	const { sha } = (await res.json()) as { sha: string };
	expect(sha).toBe(gitOut(["rev-parse", "HEAD"]));
	expect(commits()).toBe(2); // the save commit alone carries body + metadata
	const head = gitOut(["show", "HEAD:a.md"]);
	expect(head).toContain("# a v2");
	expect(head).toContain('description: "why"');
	expect(head).toContain('owner: "ops"');
	expect(head).toContain("secret: keep"); // byte-preserved
	expect(head).toContain('generated: { by: "human:okf"'); // the stamp rode too
});

test("PUT {meta}: enum violations and managed keys are 400, nothing written", async () => {
	writeConfig(true);
	const doc = (await (await api("GET", "/api/docs/a.md")).json()) as {
		hash: string;
	};
	const before = readFileSync(join(root, "a.md"), "utf8");
	const enumRes = await api("PUT", "/api/docs/a.md", {
		markdown: "# x\n",
		baseHash: doc.hash,
		meta: { status: "bogus" },
	});
	expect(enumRes.status).toBe(400);
	expect(((await enumRes.json()) as { error: string }).error).toContain(
		"status must be one of",
	);
	const managedRes = await api("PUT", "/api/docs/a.md", {
		markdown: "# x\n",
		baseHash: doc.hash,
		meta: { verified: "x" },
	});
	expect(managedRes.status).toBe(400);
	expect(((await managedRes.json()) as { error: string }).error).toContain(
		"managed key",
	);
	const badShape = await api("PUT", "/api/docs/a.md", {
		markdown: "# x\n",
		baseHash: doc.hash,
		meta: "nope",
	});
	expect(badShape.status).toBe(400);
	expect(readFileSync(join(root, "a.md"), "utf8")).toBe(before);
	expect(commits()).toBe(1);
});

test("PUT {meta} (non-OKF): the field is ignored entirely", async () => {
	const doc = (await (await api("GET", "/api/docs/a.md")).json()) as {
		hash: string;
	};
	const res = await api("PUT", "/api/docs/a.md", {
		markdown: "# a v2\n",
		baseHash: doc.hash,
		meta: { description: "why" },
	});
	expect(res.status).toBe(200);
	const head = gitOut(["show", "HEAD:a.md"]);
	expect(head).toContain("# a v2");
	expect(head).not.toContain("description");
});

// --- GET verifiedByYou (operator round D) --------------------------------------

test("GET verifiedByYou: true after your verify, false once content moves on", async () => {
	writeConfig(true);
	const seedDoc = (await (await api("GET", "/api/docs/a.md")).json()) as {
		hash: string;
		verifiedByYou: boolean;
	};
	expect(seedDoc.verifiedByYou).toBe(false); // no events yet
	// A save stamps generated (T1); the verify appends an event (T2 ≥ T1).
	await api("PUT", "/api/docs/a.md", {
		markdown: "# a v2\n",
		baseHash: seedDoc.hash,
	});
	await api("POST", "/api/docs/a.md/verify");
	const mine = (await (await api("GET", "/api/docs/a.md")).json()) as {
		hash: string;
		verifiedByYou: boolean;
	};
	expect(mine.verifiedByYou).toBe(true);
	// Another save re-stamps generated (T3 > T2): your verification no longer
	// covers the content.
	await api("PUT", "/api/docs/a.md", {
		markdown: "# a v3\n",
		baseHash: mine.hash,
	});
	const moved = (await (await api("GET", "/api/docs/a.md")).json()) as {
		verifiedByYou: boolean;
	};
	expect(moved.verifiedByYou).toBe(false);
});

test("GET verifiedByYou: someone else's dated event is never yours", async () => {
	writeConfig(true);
	writeFileSyncLF(
		"other.md",
		[
			"---",
			"type: concept",
			"generated: { by: human:x, at: 2026-09-16T00:00:00Z }",
			"verified: [{ by: human:someone, at: 2026-09-16T01:00:00Z }]",
			"---",
			"# other",
			"",
		].join("\n"),
	);
	commitFiles("add other");
	const body = (await (await api("GET", "/api/docs/other.md")).json()) as {
		verifiedByYou: boolean;
	};
	// The repo identity is okf@example.com (human:okf) – the event's actor
	// is someone else, so the button never claims it.
	expect(body.verifiedByYou).toBe(false);
});

// --- /api/meta: the badge fields ---------------------------------------------

test("GET /api/meta (OKF): per-doc type/status/tier/staleAfter derived", async () => {
	writeConfig(true);
	writeFileSyncLF(
		"b.md",
		"---\ntype: concept\nverified: { by: human:b }\n---\n# b\n",
	);
	writeFileSyncLF(
		"c.md",
		"---\ntype: concept\nverified: { by: fragmt-agent/x }\n---\n# c\n",
	);
	writeFileSyncLF(
		"d.md",
		"---\ntype: howto\nstatus: draft\nstale_after: 2020-01-01T00:00:00Z\n---\n# d\n",
	);
	commitFiles("add b c d");

	const body = (await (await api("GET", "/api/meta")).json()) as {
		docs: Record<
			string,
			{
				okf?: {
					type: string | null;
					status: string | null;
					tier: string;
					staleAfter: string | null;
				};
			}
		>;
	};
	expect(body.docs["a.md"].okf).toEqual({
		type: "concept",
		status: null, // absent → null, never implied-stable (A3)
		tier: "unverified",
		staleAfter: null,
	});
	expect(body.docs["b.md"].okf?.tier).toBe("human-reviewed");
	expect(body.docs["c.md"].okf?.tier).toBe("machine-confirmed");
	expect(body.docs["d.md"].okf).toEqual({
		type: "howto",
		status: "draft",
		tier: "unverified",
		staleAfter: "2020-01-01T00:00:00.000Z", // yaml Date → ISO
	});
});

test("GET /api/meta (non-OKF): doc extras unchanged – no badge fields", async () => {
	const body = (await (await api("GET", "/api/meta")).json()) as {
		docs: Record<string, Record<string, unknown>>;
	};
	expect(body.docs["a.md"].okf).toBeUndefined();
	expect(body.docs["a.md"].snippet).toBe(""); // the heading-only body's snippet
	expect(body.docs["a.md"].title).toBe(null);
});
