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

/**
 * The canonical body shape readDoc returns and writeDoc compares against:
 * LF endings, no leading newlines, exactly one trailing newline (empty stays
 * empty). The editor drops leading blank lines on parse, so keeping them in
 * the served body would make every first save rewrite the fence boundary —
 * normalizing on both sides keeps the hash contract stable and the diff
 * minimal.
 */
export function canonicalBody(content: string): string {
	const trimmed = content
		.replace(/\r\n/g, "\n")
		.replace(/^\n+/, "")
		.replace(/\n+$/, "");
	return trimmed === "" ? "" : `${trimmed}\n`;
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
 * Resolve a docsRoot-relative path and enforce it stays under docsRoot and
 * (for docs) ends with .md. Shared by readDoc (M1), writeDoc (M2), and the
 * files.ts ops (M3). Trust boundary — the server maps violations to 400.
 * Folder ops pass kind "folder" and the raw-file route passes kind "raw"
 * (M4-3 b6) to allow a path without the .md extension; the traversal rules
 * are identical for all kinds.
 */
export function resolveDocPath(
	repoRoot: string,
	docsRoot: string,
	docPath: string,
	kind: "doc" | "folder" | "raw" = "doc",
): string {
	const docsAbs = resolve(repoRoot, docsRoot);
	const target = resolve(docsAbs, docPath);
	const rel = relative(docsAbs, target);
	const firstSegment = rel.split(sep)[0];
	if (rel === "" || firstSegment === ".." || isAbsolute(rel)) {
		throw new DocPathError(`invalid doc path: ${docPath}`);
	}
	if (kind === "doc" && !target.toLowerCase().endsWith(".md")) {
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
		markdown: canonicalBody(parsed.content),
		rawFrontmatter: parsed.matter ?? "",
	};
}

/** Everything a doc-body write needs before a byte hits disk (M4-2). */
export interface DocWritePrep {
	abs: string;
	user: { name: string; email: string };
	/** The current file's body, canonicalized (the string `baseHash` hashed). */
	current: string;
	/** Final file bytes for a normalized body — raw frontmatter reattached byte-for-byte. */
	raw: (normalized: string) => string;
}

/**
 * The shared doc-write prep, extracted from writeDoc (M4-2) so the combined
 * comment ops (comments.ts) reuse the identical discipline instead of
 * duplicating it: traversal guard, existence, git identity BEFORE any write
 * (a missing identity leaves the working tree untouched), stale check, and a
 * `raw` that reattaches the CURRENT file's frontmatter + fence gap
 * byte-for-byte (never re-serialize the YAML). Throws DocPathError,
 * DocNotFoundError, GitIdentityError, or StaleDocError — all before disk.
 */
export async function prepareDocWrite(
	repoRoot: string,
	docsRoot: string,
	docPath: string,
	baseHash: string,
): Promise<DocWritePrep> {
	const abs = resolveDocPath(repoRoot, docsRoot, docPath);
	if (!existsSync(abs) || !statSync(abs).isFile()) {
		throw new DocNotFoundError(docPath);
	}
	const user = await localUser(repoRoot);
	const parsed = matter(readFileSync(abs, "utf8"), {});
	const current = canonicalBody(parsed.content);
	if (docHash(current) !== baseHash) {
		throw new StaleDocError(`doc changed since load: ${docPath}`);
	}
	// Keep the whitespace between the fence and the body byte-for-byte from
	// the current file — dropping it puts the fence itself into the diff.
	const gap = parsed.matter ? (parsed.content.match(/^\n+/)?.[0] ?? "") : "";
	return {
		abs,
		user,
		current,
		raw: (normalized) =>
			parsed.matter
				? `---${parsed.matter}\n---\n${gap}${normalized}`
				: normalized,
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
 * 5. write LF, exactly one trailing newline, fence-to-body gap preserved;
 * 6. commit through the `commitAs` seam.
 */
export async function writeDoc(
	repoRoot: string,
	docsRoot: string,
	docPath: string,
	body: string,
	baseHash: string,
): Promise<{ sha: string; hash: string }> {
	const { abs, user, raw } = await prepareDocWrite(
		repoRoot,
		docsRoot,
		docPath,
		baseHash,
	);
	const normalized = canonicalBody(body);
	writeFileSync(abs, raw(normalized));
	const repoRel = relative(repoRoot, abs).split(sep).join("/");
	const sha = await commitAs(
		user,
		{ files: [repoRel], message: `Update ${docPath}` },
		repoRoot,
	);
	return { sha, hash: docHash(normalized) };
}

/**
 * Set/overwrite the frontmatter `title` — the display-name model (M4-3 b4).
 * The FILE PATH NEVER CHANGES, so every existing link keeps resolving; the
 * name decouples from the filename. The raw YAML is edited line-wise, never
 * re-serialized: a top-level `title:` line is replaced in place (position
 * kept), an absent one appends at the fence's end, and every other key keeps
 * its bytes. The body reattaches through the writeDoc discipline (LF, one
 * trailing newline, fence gap preserved) and the write follows the same
 * order: traversal, existence, git identity — all before any disk write.
 * One commit: `Rename <docPath> to <title>`.
 */
export async function setTitle(
	repoRoot: string,
	docsRoot: string,
	docPath: string,
	title: string,
): Promise<{ sha: string }> {
	const value = title.trim();
	if (!value) throw new DocPathError("title must be a non-empty string");
	const abs = resolveDocPath(repoRoot, docsRoot, docPath);
	if (!existsSync(abs) || !statSync(abs).isFile()) {
		throw new DocNotFoundError(docPath);
	}
	const user = await localUser(repoRoot);
	const parsed = matter(readFileSync(abs, "utf8"), {});
	const body = canonicalBody(parsed.content);
	// JSON string form: a valid YAML double-quoted scalar, so colons, quotes,
	// and hashes in the title round-trip through gray-matter verbatim.
	const line = `title: ${JSON.stringify(value)}`;
	// gray-matter's `matter` runs from just after the opening fence to just
	// before the "\n---" closer — writeDoc's `---${matter}\n---` reattach is
	// byte-exact, and the line edit keeps that shape.
	const gap = parsed.content.match(/^\n+/)?.[0] ?? "";
	const front = parsed.matter
		? `---${editTitleLine(parsed.matter, line)}\n---\n${gap}`
		: `---\n${line}\n---\n`;
	writeFileSync(abs, `${front}${body}`);
	const repoRel = relative(repoRoot, abs).split(sep).join("/");
	const sha = await commitAs(
		user,
		{ files: [repoRel], message: `Rename ${docPath} to ${value}` },
		repoRoot,
	);
	return { sha };
}

/** Replace the top-level `title:` line in place, or append it at the end. */
function editTitleLine(rawFrontmatter: string, line: string): string {
	const lines = rawFrontmatter.split("\n");
	const at = lines.findIndex((l) => /^title:/.test(l));
	if (at === -1) lines.push(line);
	else lines[at] = line;
	return lines.join("\n");
}
