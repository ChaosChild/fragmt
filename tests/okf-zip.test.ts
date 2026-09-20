// OKF rung 5 core: the dependency-free STORE zip writer. The byte structure
// is verified by an INDEPENDENT minimal reader here (EOCD scan from the end,
// central-directory walk, CRC recompute) – never the writer's own parsing –
// plus determinism, the fixed DOS timestamp, bundleZip's .git skip, binary
// bytes, and docsRoot containment.
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { bundleZip, zipEntries } from "../src/core/zip.js";

// An independent CRC-32 – the reader must not trust the writer's table.
const TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
	let c = i;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	TABLE[i] = c;
}
const crc32 = (data: Uint8Array): number => {
	let c = 0xffffffff;
	for (let i = 0; i < data.length; i++) {
		c = TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
	}
	return (c ^ 0xffffffff) >>> 0;
};

interface ParsedEntry {
	name: string;
	bytes: Uint8Array;
	crc: number;
	time: number;
	date: number;
}

/** Minimal ZIP reader over the raw bytes: EOCD scan from the end, central
 *  directory walk, local header locate, CRC recompute over the stored bytes. */
function readZip(zip: Uint8Array): ParsedEntry[] {
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
	const cdSize = dv.getUint32(eocd + 12, true);
	const cdStart = dv.getUint32(eocd + 16, true);
	const dec = new TextDecoder();
	const out: ParsedEntry[] = [];
	let p = cdStart;
	for (let i = 0; i < count; i++) {
		if (dv.getUint32(p, true) !== 0x02014b50) {
			throw new Error(`bad central signature at ${p}`);
		}
		const crc = dv.getUint32(p + 16, true);
		const csize = dv.getUint32(p + 20, true);
		const usize = dv.getUint32(p + 24, true);
		const nameLen = dv.getUint16(p + 28, true);
		const extraLen = dv.getUint16(p + 30, true);
		const commentLen = dv.getUint16(p + 32, true);
		const lfh = dv.getUint32(p + 42, true);
		const name = dec.decode(zip.subarray(p + 46, p + 46 + nameLen));
		if (dv.getUint32(lfh, true) !== 0x04034b50) {
			throw new Error(`bad local signature for ${name}`);
		}
		if (usize !== csize) {
			throw new Error(`${name}: store method must carry matching sizes`);
		}
		const dataAt =
			lfh + 30 + dv.getUint16(lfh + 26, true) + dv.getUint16(lfh + 28, true);
		const bytes = zip.subarray(dataAt, dataAt + usize);
		if (crc32(bytes) !== crc) throw new Error(`${name}: CRC mismatch`);
		out.push({
			name,
			bytes,
			crc,
			time: dv.getUint16(lfh + 10, true),
			date: dv.getUint16(lfh + 12, true),
		});
		p += 46 + nameLen + extraLen + commentLen;
	}
	if (p !== cdStart + cdSize) {
		throw new Error("central directory size mismatch");
	}
	return out;
}

// --- zipEntries (pure) --------------------------------------------------------

test("zipEntries is deterministic: two calls, identical bytes", () => {
	const mk = () => [
		{ name: "docs/b.md", data: new TextEncoder().encode("# B\n") },
		{ name: "docs/a.md", data: new Uint8Array([1, 2, 3, 254, 255]) },
	];
	expect(zipEntries(mk())).toEqual(zipEntries(mk()));
});

test("local headers carry the store signature, UTF-8 flag, and fixed DOS timestamp", () => {
	const zip = zipEntries([{ name: "a.md", data: new Uint8Array([65]) }]);
	const dv = new DataView(zip.buffer);
	expect(dv.getUint32(0, true)).toBe(0x04034b50); // PK\x03\x04
	expect(dv.getUint16(4, true)).toBe(20); // version needed: 2.0 (store)
	expect(dv.getUint16(6, true)).toBe(0x0800); // bit 11: UTF-8 names
	expect(dv.getUint16(8, true)).toBe(0); // method: store
	expect(dv.getUint16(10, true)).toBe(0); // 1980-01-01 00:00:00
	expect(dv.getUint16(12, true)).toBe(0x0021);
});

test("entries round-trip through the independent reader: names, sizes, CRC, stored bytes", () => {
	const entries = [
		{
			name: "docs/日本語 メモ.md",
			data: new TextEncoder().encode("# UTF-8 name\n"),
		},
		{
			name: "bin/data.bin",
			data: new Uint8Array([0, 1, 127, 128, 200, 255]),
		},
	];
	const parsed = readZip(zipEntries(entries));
	expect(parsed).toHaveLength(entries.length);
	for (let i = 0; i < entries.length; i++) {
		expect(parsed[i].name).toBe(entries[i].name);
		expect(Array.from(parsed[i].bytes)).toEqual(Array.from(entries[i].data));
	}
});

test("zero entries is a valid zip (EOCD only)", () => {
	const zip = zipEntries([]);
	expect(zip.length).toBe(22);
	expect(readZip(zip)).toEqual([]);
});

// --- bundleZip (tmp docsRoot walk) --------------------------------------------

let root: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "fragmt-zip-"));
	mkdirSync(join(root, "docs"), { recursive: true });
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

const write = (rel: string, data: string | Uint8Array) => {
	const p = join(root, rel);
	mkdirSync(dirname(p), { recursive: true });
	writeFileSync(p, data);
};

test("bundleZip walks nested dirs, skips .git, and preserves binary bytes exactly", async () => {
	const binary = new Uint8Array([0, 1, 127, 128, 200, 255]);
	write("docs/sub/deep.md", "# deep\n");
	write("docs/日本語.md", "# utf8\n");
	write("docs/raw.bin", binary);
	write("docs/.git/HEAD", "ref: refs/heads/main\n");
	write("docs/.git/objects/ab/cdef", "junk");

	const zip = await bundleZip(root, "docs");
	const parsed = readZip(zip);
	expect(parsed.map((e) => e.name).sort()).toEqual([
		"raw.bin",
		"sub/deep.md",
		"日本語.md",
	]);
	const raw = parsed.find((e) => e.name === "raw.bin");
	expect(Array.from(raw?.bytes ?? [])).toEqual(Array.from(binary));
	// The fixed DOS timestamp survives the bundle walk too.
	for (const e of parsed) {
		expect(e.time).toBe(0);
		expect(e.date).toBe(0x0021);
	}
	// Two bundles of the same tree are byte-identical.
	expect(zip).toEqual(await bundleZip(root, "docs"));
});

test("bundleZip entries stay contained: every name is a real file under docsRoot", async () => {
	write("docs/a.md", "# A\n");
	write("docs/sub/b.md", "# B\n");
	const parsed = readZip(await bundleZip(root, "docs"));
	for (const e of parsed) {
		expect(e.name.includes("..")).toBe(false);
		expect(existsSync(join(root, "docs", e.name))).toBe(true);
	}
});

test("an empty docsRoot bundles to a valid zero-entry zip", async () => {
	expect(readZip(await bundleZip(root, "docs"))).toEqual([]);
});
