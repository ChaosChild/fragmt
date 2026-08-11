import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import matter from "gray-matter";

export class DocPathError extends Error {}
export class DocNotFoundError extends Error {}

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
	const parsed = matter(readFileSync(abs, "utf8"));
	return {
		path: docPath,
		frontmatter: (parsed.data as Record<string, unknown>) ?? {},
		markdown: parsed.content,
		rawFrontmatter: parsed.matter ?? "",
	};
}
