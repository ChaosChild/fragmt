// `fragmt export` e2e (rung 5 #21): stdout json by default (parses, carries
// nodes + edges), the mermaid header line, --out writing the exact bytes,
// --bundle producing a zip verified by an INDEPENDENT central-directory
// walk – never the writer's code – and the exit-2 + `init --okf` hint in a
// non-OKF repo. Real git in tmp repos (okf-init.test.ts pattern); stdout and
// stderr are injected sinks.
import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { runExport } from "../src/cli/index.js";
import { writeConfig } from "../src/core/index.js";

const dirs: string[] = [];

afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function run(root: string, args: string[]): string {
	return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

/** Fresh tmp repo with an identity; autocrlf off keeps bytes stable. */
function repo(): string {
	const root = mkdtempSync(join(tmpdir(), "fragmt-export-"));
	run(root, ["init", "-q", "-b", "main"]);
	run(root, ["config", "user.name", "Export Test"]);
	run(root, ["config", "user.email", "export@example.com"]);
	run(root, ["config", "core.autocrlf", "false"]);
	dirs.push(root);
	return root;
}

function put(root: string, rel: string, text: string): void {
	mkdirSync(dirname(join(root, rel)), { recursive: true });
	writeFileSync(join(root, rel), text);
}

const sink = () => {
	const lines: string[] = [];
	return { lines, write: (s: string) => lines.push(s) };
};

/** An OKF bundle with one body link: docs/a.md → docs/b.md, both committed. */
function okfRepo(): string {
	const root = repo();
	writeConfig(root, "docs", true);
	put(root, "docs/a.md", "---\ntype: Concept\n---\n\n# A\n\nSee [B](/b.md).\n");
	put(root, "docs/b.md", "---\ntype: Concept\n---\n\n# B\n");
	run(root, ["add", "-A"]);
	run(root, ["commit", "-q", "-m", "seed"]);
	return root;
}

/** Minimal independent ZIP reader: EOCD scan from the end, central-directory
 *  walk, entry names only – shares nothing with src/core/zip.ts. */
function zipEntryNames(zip: Uint8Array): string[] {
	const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
	let eocd = -1;
	for (let i = zip.length - 22; i >= 0; i--) {
		if (dv.getUint32(i, true) === 0x06054b50) {
			eocd = i;
			break;
		}
	}
	if (eocd < 0) throw new Error("no EOCD found");
	const count = dv.getUint16(eocd + 10, true);
	const dec = new TextDecoder();
	const names: string[] = [];
	let p = dv.getUint32(eocd + 16, true);
	for (let i = 0; i < count; i++) {
		if (dv.getUint32(p, true) !== 0x02014b50) {
			throw new Error(`bad central signature at ${p}`);
		}
		const nameLen = dv.getUint16(p + 28, true);
		names.push(dec.decode(zip.subarray(p + 46, p + 46 + nameLen)));
		p += 46 + nameLen + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
	}
	return names;
}

// --- formats to stdout --------------------------------------------------------

test("export with no --format: stdout parses as json with generated, nodes, edges", async () => {
	const root = okfRepo();
	const out = sink();

	expect(await runExport({}, root, out.write)).toBe(0);

	const body = JSON.parse(out.lines.join("")) as {
		generated: string;
		nodes: { path: string }[];
		edges: { from: string; to: string }[];
	};
	expect(typeof body.generated).toBe("string");
	expect(body.nodes.map((n) => n.path)).toEqual(["a.md", "b.md"]);
	expect(body.edges).toEqual([{ from: "a.md", to: "b.md" }]);
});

test("export --format mermaid: the fragmt reference graph header rides stdout", async () => {
	const root = okfRepo();
	const out = sink();

	expect(await runExport({ format: "mermaid" }, root, out.write)).toBe(0);

	expect(out.lines.join("").startsWith("%% fragmt reference graph")).toBe(true);
});

// --- --out writes the file -----------------------------------------------------

test("export --out: the file carries the exact bytes stdout would have", async () => {
	const root = okfRepo();
	const stdoutSink = sink();
	await runExport({ format: "dot" }, root, stdoutSink.write);
	const file = join(root, "graph.dot");

	expect(
		await runExport({ format: "dot", out: file }, root, sink().write),
	).toBe(0);
	// dot carries no timestamp, so two runs are byte-identical.
	expect(readFileSync(file, "utf8")).toBe(stdoutSink.lines.join(""));
});

// --- --bundle -------------------------------------------------------------------

test("export --bundle: a PK-signature zip whose entry names include the docs", async () => {
	const root = okfRepo();
	const zipPath = join(root, "bundle.zip");

	expect(
		await runExport({ bundle: true, out: zipPath }, root, sink().write),
	).toBe(0);

	const zip = readFileSync(zipPath);
	expect([zip[0], zip[1], zip[2], zip[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]); // PK\x03\x04
	// Entries are docsRoot-relative: the bundle names the docs directly.
	const names = zipEntryNames(
		new Uint8Array(zip.buffer, zip.byteOffset, zip.byteLength),
	);
	expect(names).toContain("a.md");
	expect(names).toContain("b.md");
});

// --- the OKF gate ----------------------------------------------------------------

test("export in a non-OKF repo: exit 2, the init --okf hint on stderr", async () => {
	const root = repo();
	writeConfig(root, "docs", false);
	put(root, "docs/a.md", "# A\n");
	run(root, ["add", "-A"]);
	run(root, ["commit", "-q", "-m", "seed"]);
	const err = sink();

	expect(
		await runExport({ format: "json" }, root, sink().write, err.write),
	).toBe(2);
	expect(err.lines.join("")).toContain("fragmt init --okf");
});
