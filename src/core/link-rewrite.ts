import { posix } from "node:path";

/**
 * Move-time link rewriting (owner round). When docs move, two kinds of
 * link change meaning: links TO a moved doc, and a moved doc's own
 * RELATIVE links (they resolve from a new folder). Both are rewritten from
 * the old → new map, in the author's style: bundle-absolute `/x.md` stays
 * absolute, relative stays relative (a leading `./` kept where it still
 * fits), a `#fragment` rides along. The link grammar is extractRefs' own
 * (okf.ts): inline `[text](target)`, images excluded, fenced code skipped –
 * so what the references graph sees is exactly what gets rewritten.
 * Externals, in-page anchors, non-.md targets and `..` escapes are left
 * alone. Pure: `oldPath`/`newPath` are this doc's path before/after the
 * move (equal when it did not move).
 */
const LINK = /(^|[^!])\[([^\]]*)\]\(([^)\s]+)\)/g;

export function rewriteMovedLinks(
	body: string,
	oldPath: string,
	newPath: string,
	moves: ReadonlyMap<string, string>,
): string {
	const oldDir = dirOf(oldPath);
	const newDir = dirOf(newPath);
	let fenced = false;
	return body
		.split("\n")
		.map((line) => {
			if (/^\s*(```|~~~)/.test(line)) {
				fenced = !fenced;
				return line;
			}
			if (fenced) return line;
			return line.replace(
				LINK,
				(all, pre: string, text: string, target: string) => {
					const next = retarget(target, oldDir, newDir, moves);
					return next === null ? all : `${pre}[${text}](${next})`;
				},
			);
		})
		.join("\n");
}

/** The new link target, or null to leave the link exactly as written. */
function retarget(
	target: string,
	oldDir: string,
	newDir: string,
	moves: ReadonlyMap<string, string>,
): string | null {
	if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#"))
		return null;
	const hashAt = target.indexOf("#");
	const path = hashAt >= 0 ? target.slice(0, hashAt) : target;
	const frag = hashAt >= 0 ? target.slice(hashAt) : "";
	if (!/\.md$/i.test(path)) return null;
	const absolute = path.startsWith("/");
	const resolved = absolute
		? posix.normalize(path.slice(1))
		: posix.normalize(posix.join(oldDir, path));
	if (
		resolved === "." ||
		resolved.startsWith("..") ||
		posix.isAbsolute(resolved)
	)
		return null; // the root itself, or an escape – not ours to touch
	const dest = moves.get(resolved) ?? resolved;
	if (absolute) return dest === resolved ? null : `/${dest}${frag}`;
	if (dest === resolved && oldDir === newDir) return null;
	let rel = relativePath(newDir, dest);
	if (path.startsWith("./") && !rel.startsWith("../")) rel = `./${rel}`;
	const next = `${rel}${frag}`;
	return next === target ? null : next;
}

/** "" for a root-level doc, else its folder. */
function dirOf(p: string): string {
	const d = posix.dirname(p);
	return d === "." ? "" : d;
}

/** Relative path from folder `from` to file `to` (both docsRoot-relative).
 *  Hand-rolled: posix.relative resolves against process.cwd(). */
function relativePath(from: string, to: string): string {
	const a = from ? from.split("/") : [];
	const b = to.split("/");
	let i = 0;
	while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
	return [...a.slice(i).map(() => ".."), ...b.slice(i)].join("/");
}
