import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import matter from "gray-matter";
import { commitAs } from "./commit.js";
import { localUser } from "./identity.js";

export class DocPathError extends Error {}
export class DocNotFoundError extends Error {}
/** Base-hash mismatch — the file changed between load and save. */
export class StaleDocError extends Error {}

/** sha256 hex of a doc body. Shared by the readDoc response and writeDoc check. */
export function docHash(markdown: string): string {
	return createHash("sha256").update(markdown).digest("hex");
}

export interface Doc {
	path: string;
	frontmatter: Record<string, unknown>;
	/** Body without frontmatter. */
	markdown: string;
	/** Raw YAML text (no delimiters); "" when the doc has no frontmatter. */
	rawFrontmatter: string;
}

/**
 * Resolve a docsRoot-relative path and enforce it stays under docsRoot and ends
 * with .md. Shared by readDoc (M1) and writeDoc (M2). Trust boundary — the
 * server maps violations to 400.
 */
export function resolveDocPath(
	repoRoot: string,
	docsRoot: string,
	docPath: string,
): string {
	const docsAbs = resolve(repoRoot, docsRoot);
	const target = resolve(docsAbs, docPath);
	const rel = relative(docsAbs, target);
	const firstSegment = rel.split(sep)[0];
	if (rel === "" || firstSegment === ".." || isAbsolute(rel)) {
		throw new DocPathError(`invalid doc path: ${docPath}`);
	}
	if (!target.toLowerCase().endsWith(".md")) {
		throw new DocPathError(`invalid doc path: ${docPath}`);
	}
	return target;
}

/** Read + split a doc. Throws DocPathError (traversal) or DocNotFoundError. */
export function readDoc(
	repoRoot: string,
	docRoot: string,
	docPath: string,
): Doc {
	const abs = resolveDocPath(repoRoot, docRoot, docPath);
	if (!existsSync(abs) || !statSync(abs).isFile()) {
		throw new DocNotFoundError(docPath);
	}
	// gray-matter caches parses by content, and the cached copy drops the
	// non-enumerable `matter` field — any options object bypasses the cache.
	// Without this, a second read of the same doc loses its raw frontmatter.
	const parsed = matter(readFileSync(abs, "utf8"), {});
	return {
		path: docPath,
		frontmatter: (parsed.data as Record<string, unknown>) ?? {},
		markdown: parsed.content,
		rawFrontmatter: parsed.matter ?? "",
	};
}

/**
 * Save a doc body and commit it. Steps, per the M2 spec:
 * 1. traversal guard (shared with readDoc);
 * 2. git identity present — checked before anything is written, so a missing
 *    identity leaves the working tree untouched (spec checks it at commit time;
 *    checking first just avoids stranding a half-written save);
 * 3. stale check — sha256 of the current body must equal `baseHash`;
 * 4. reattach the CURRENT file's raw frontmatter byte-for-byte (never
 *    re-serialize the YAML — the diff must not touch what wasn't edited);
 * 5. write LF, exactly one trailing newline;
 * 6. commit through the `commitAs` seam.
 */
export async function writeDoc(
	repoRoot: string,
	docsRoot: string,
	docPath: string,
	body: string,
	baseHash: string,
): Promise<{ sha: string; hash: string }> {
	const abs = resolveDocPath(repoRoot, docsRoot, docPath);
	if (!existsSync(abs) || !statSync(abs).isFile()) {
		throw new DocNotFoundError(docPath);
	}
	const user = await localUser(repoRoot);
	const parsed = matter(readFileSync(abs, "utf8"), {});
	if (docHash(parsed.content) !== baseHash) {
		throw new StaleDocError(`doc changed since load: ${docPath}`);
	}
	const normalized = `${body.replace(/\r\n/g, "\n").replace(/\n+$/, "")}\n`;
	// gray-matter's `.matter` includes the newline after the opening `---`
	// but not the one before the close, so this rebuilds the fence exactly.
	const raw = parsed.matter
		? `---${parsed.matter}\n---\n${normalized}`
		: normalized;
	writeFileSync(abs, raw);
	const repoRel = relative(repoRoot, abs).split(sep).join("/");
	const sha = await commitAs(
		user,
		{ files: [repoRel], message: `Update ${docPath}` },
		repoRoot,
	);
	return { sha, hash: docHash(normalized) };
}
