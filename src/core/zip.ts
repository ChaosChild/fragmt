import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";

/**
 * A dependency-free STORE-method ZIP writer (node:stdlib only): local file
 * headers, one central directory record per entry, the EOCD, and a CRC-32
 * over the usual IEEE table. Sizes and CRC are known upfront, so there are
 * no data descriptors; the DOS timestamp is a fixed constant so the bytes
 * are deterministic and testable. Nothing here ever READS a zip – this
 * module only produces bytes.
 */

// Local file header / central directory / EOCD signatures (PK\x03\x04 …).
const LFH = 0x04034b50;
const CDH = 0x02014b50;
const EOCD = 0x06054b50;
/** Version needed to extract: 2.0, the store-method minimum. */
const VERSION = 20;
/** General-purpose bit 11: entry names are UTF-8. */
const UTF8_FLAG = 0x0800;
/** Fixed DOS timestamp, 1980-01-01 00:00:00 – wall-clock time never enters
 *  the output, so two calls over the same tree are byte-identical. */
const DOS_TIME = 0;
const DOS_DATE = (1 << 5) | 1;

/** CRC-32 (IEEE, reflected 0xEDB88320), the usual 256-entry table. */
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
	let c = i;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	CRC_TABLE[i] = c;
}

function crc32(data: Uint8Array): number {
	let c = 0xffffffff;
	for (let i = 0; i < data.length; i++) {
		c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
	}
	return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
	name: string;
	data: Uint8Array;
}

/**
 * The minimal archive: one local header + name + data per entry, one central
 * record + name per entry, the EOCD. External attrs and every unused field
 * stay 0 (the buffer is zeroed). Entry names ride forward slashes whatever
 * the caller hands over.
 * ponytail: a uint16 count and uint32 offsets cap the archive at 65535
 * entries / 4 GiB – a docs bundle never gets near either.
 */
export function zipEntries(entries: ZipEntry[]): Uint8Array {
	const enc = new TextEncoder();
	const prepared = entries.map((e) => ({
		name: enc.encode(e.name.replaceAll("\\", "/")),
		data: e.data,
		crc: crc32(e.data),
	}));
	// 30-byte local header, 46-byte central record, 2× name, data, 22-byte EOCD.
	const total =
		22 +
		prepared.reduce((n, e) => n + 76 + 2 * e.name.length + e.data.length, 0);
	const out = new Uint8Array(total);
	const dv = new DataView(out.buffer);
	const central: { at: number; name: Uint8Array; crc: number; size: number }[] =
		[];
	let at = 0;
	for (const e of prepared) {
		central.push({ at, name: e.name, crc: e.crc, size: e.data.length });
		dv.setUint32(at, LFH, true);
		dv.setUint16(at + 4, VERSION, true);
		dv.setUint16(at + 6, UTF8_FLAG, true);
		dv.setUint16(at + 8, 0, true); // method 0: store
		dv.setUint16(at + 10, DOS_TIME, true);
		dv.setUint16(at + 12, DOS_DATE, true);
		dv.setUint32(at + 14, e.crc, true);
		dv.setUint32(at + 18, e.data.length, true);
		dv.setUint32(at + 22, e.data.length, true);
		dv.setUint16(at + 26, e.name.length, true);
		out.set(e.name, at + 30);
		out.set(e.data, at + 30 + e.name.length);
		at += 30 + e.name.length + e.data.length;
	}
	const cdStart = at;
	for (const e of central) {
		dv.setUint32(at, CDH, true);
		dv.setUint16(at + 4, VERSION, true); // version made by
		dv.setUint16(at + 6, VERSION, true);
		dv.setUint16(at + 8, UTF8_FLAG, true);
		dv.setUint16(at + 10, 0, true); // method 0: store
		dv.setUint16(at + 12, DOS_TIME, true);
		dv.setUint16(at + 14, DOS_DATE, true);
		dv.setUint32(at + 16, e.crc, true);
		dv.setUint32(at + 20, e.size, true);
		dv.setUint32(at + 24, e.size, true);
		dv.setUint16(at + 28, e.name.length, true);
		dv.setUint32(at + 42, e.at, true); // local header offset
		out.set(e.name, at + 46);
		at += 46 + e.name.length;
	}
	dv.setUint32(at, EOCD, true);
	dv.setUint16(at + 8, prepared.length, true);
	dv.setUint16(at + 10, prepared.length, true);
	dv.setUint32(at + 12, at - cdStart, true);
	dv.setUint32(at + 16, cdStart, true);
	return out;
}

/**
 * The bundle zip (D1's share-what's-on-disk snapshot): a recursive walk of
 * the resolved docsRoot working tree, files only as docsRoot-relative POSIX
 * entries, every `.git` directory skipped. Walk order is sorted, so the
 * entry order – and the bytes – are deterministic. Symlinks are neither
 * isDirectory nor isFile and never enter the walk, and every read path is
 * resolved and containment-checked under the resolved docsRoot BEFORE it is
 * read (the cavet resolve-then-check-prefix idiom) – a trust boundary, so a
 * violation throws rather than skips.
 */
export async function bundleZip(
	repoRoot: string,
	docsRoot: string,
): Promise<Uint8Array> {
	const rootAbs = resolve(repoRoot, docsRoot);
	const files: { name: string; abs: string }[] = [];
	const walk = (abs: string, rel: string): void => {
		for (const ent of readdirSync(abs, { withFileTypes: true })) {
			if (ent.isDirectory()) {
				if (ent.name === ".git") continue;
				walk(join(abs, ent.name), rel === "" ? ent.name : `${rel}/${ent.name}`);
			} else if (ent.isFile()) {
				files.push({
					name: rel === "" ? ent.name : `${rel}/${ent.name}`,
					abs: join(abs, ent.name),
				});
			}
		}
	};
	if (existsSync(rootAbs)) walk(rootAbs, "");
	files.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
	return zipEntries(
		files.map(({ name, abs }) => {
			const target = resolve(abs);
			if (!target.startsWith(rootAbs + sep)) {
				throw new Error(`bundle path escapes docsRoot: ${name}`);
			}
			return { name, data: readFileSync(target) };
		}),
	);
}
