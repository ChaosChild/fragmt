/**
 * Link-click resolution: what a click on an anchor in the document should do.
 * Pure — the tree's known paths decide everything; both read mode
 * (EditorPane's onClick) and edit mode (Ctrl/Cmd+click) route through this one
 * helper. Extended M4-3 b6 from the doc-only set to the full dispatch:
 *
 * | href (after trim)                                     | kind                     |
 * |-------------------------------------------------------|--------------------------|
 * | "" or "#" (empty fragment)                            | default                  |
 * | "#frag" (non-empty)                                   | anchor {id}              |
 * | scheme: prefix or leading //                          | external                 |
 * | relative, fragment stripped; candidate (dir-joined,   | doc {path, anchor?}      |
 * |   then verbatim) matches a known doc                  |                          |
 * | same candidates match a known folder (trailing "/"    | folder {path}            |
 * |   already dropped by normalization; root "" excluded) |                          |
 * | dir-joined reading escapes docsRoot (".." past root)  | default (unchanged)      |
 * |   or normalizes to "" ("." / "./" / "/")              |                          |
 * | nothing matched and the candidate ends .md            | dead {href}              |
 * |   (case-insensitive — dead .md must not fall to raw)  |                          |
 * | any other relative href                               | raw {path} → /api/raw/   |
 *
 * Fragments decode like the body; the anchor rides along as-authored (already
 * slug-shaped by convention — GitHub writes #hello-world, we assign the same
 * slugs to headings), never re-slugified.
 */

export type LinkTarget =
	| { kind: "anchor"; id: string }
	| { kind: "doc"; path: string; anchor?: string }
	| { kind: "folder"; path: string }
	| { kind: "raw"; path: string }
	| { kind: "dead"; href: string }
	| { kind: "external" }
	| { kind: "default" };

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const IS_MD = /\.md$/i;

/** Resolve "./" and "../" segments; ".." past the root flags an escape. */
function normalize(path: string): { path: string; escaped: boolean } {
	const parts: string[] = [];
	let escaped = false;
	for (const seg of path.split("/")) {
		if (seg === "" || seg === ".") continue;
		if (seg === "..") {
			if (parts.length === 0) escaped = true;
			else parts.pop();
		} else {
			parts.push(seg);
		}
	}
	return { path: parts.join("/"), escaped };
}

function decode(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value; // malformed % sequence — resolve the raw text
	}
}

/**
 * Resolve one anchor href against the current doc. `knownDocs`/`knownFolders`
 * are the tree's paths (folders exclude the "" root — a link to the docsRoot
 * itself has no in-app destination and stays default).
 */
export function resolveLinkTarget(
	href: string,
	currentDocPath: string,
	knownDocPaths: ReadonlySet<string>,
	knownFolderPaths: ReadonlySet<string>,
): LinkTarget {
	const trimmed = href.trim();
	if (!trimmed || trimmed === "#") return { kind: "default" };
	if (trimmed.startsWith("#")) {
		return { kind: "anchor", id: decode(trimmed.slice(1)) };
	}
	if (SCHEME.test(trimmed) || trimmed.startsWith("//")) {
		return { kind: "external" };
	}
	const decoded = decode(trimmed);
	// Strip the fragment before any path matching; it only rides along on doc.
	const hashAt = decoded.indexOf("#");
	const anchor = hashAt >= 0 ? decoded.slice(hashAt + 1) : undefined;
	const body = hashAt >= 0 ? decoded.slice(0, hashAt) : decoded;
	const dir = currentDocPath.slice(
		0,
		Math.max(0, currentDocPath.lastIndexOf("/")),
	);
	// Two candidates, in order: the markdown-relative join against the
	// current doc's directory, then the href verbatim (the docsRoot-relative
	// form the @ menu inserts). Leading "/" segments drop in normalization,
	// so repo-absolute hrefs read as docsRoot-absolute; trailing slashes drop
	// the same way (folder links: "sub/" ≡ "sub").
	const candidates = [
		normalize(dir ? `${dir}/${body}` : body),
		normalize(body),
	];
	for (const candidate of candidates) {
		if (!candidate.escaped && knownDocPaths.has(candidate.path)) {
			return {
				kind: "doc",
				path: candidate.path,
				...(anchor ? { anchor } : {}),
			};
		}
	}
	for (const candidate of candidates) {
		if (!candidate.escaped && knownFolderPaths.has(candidate.path)) {
			return { kind: "folder", path: candidate.path };
		}
	}
	// Nothing matched. Classify by the markdown-relative reading (the first
	// candidate): an escape or an empty result ("."/"./") keeps the browser
	// default exactly as before this batch; a .md-shaped miss is a dead doc
	// link; anything else is a raw asset for /api/raw.
	const primary = candidates[0];
	if (primary.escaped || primary.path === "") return { kind: "default" };
	if (IS_MD.test(primary.path)) return { kind: "dead", href: trimmed };
	return { kind: "raw", path: primary.path };
}

/**
 * The heading-id slug (M4-3 b6): lowercase, keep Unicode letters/digits plus
 * hyphens and spaces, strip other punctuation, collapse whitespace/separator
 * runs to a single "-", trim edges. Empty → "section"; duplicates get -1, -2…
 * suffixes (counter unbounded — noted ponytail ceiling). GitHub-gfm-compatible
 * for the ASCII common case: "Hello, World!" → "hello-world".
 */
export function slugifyHeading(text: string, seen: Set<string>): string {
	const slug = text
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s-]/gu, "")
		.replace(/[\s-]+/gu, "-")
		.replace(/^-+|-+$/g, "");
	let final = slug || "section";
	if (seen.has(final)) {
		let n = 1;
		while (seen.has(`${final}-${n}`)) n++;
		final = `${final}-${n}`;
	}
	seen.add(final);
	return final;
}
