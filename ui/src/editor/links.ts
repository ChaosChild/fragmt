/**
 * Link-click resolution (M4-2, minimal set): what a click on an anchor in
 * the document should do. Pure — the tree's known paths decide everything;
 * both read mode (EditorPane's onClick) and edit mode (Ctrl/Cmd+click)
 * route through this one helper.
 */

export type LinkTarget =
	| { kind: "doc"; path: string }
	| { kind: "external" }
	| { kind: "default" };

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

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

export function resolveLinkTarget(
	href: string,
	currentDocPath: string,
	knownDocPaths: ReadonlySet<string>,
): LinkTarget {
	const trimmed = href.trim();
	if (!trimmed || trimmed.startsWith("#")) return { kind: "default" };
	if (SCHEME.test(trimmed) || trimmed.startsWith("//")) {
		return { kind: "external" };
	}
	let decoded = trimmed;
	try {
		decoded = decodeURIComponent(trimmed);
	} catch {
		// malformed % sequence — resolve the raw href
	}
	const dir = currentDocPath.slice(
		0,
		Math.max(0, currentDocPath.lastIndexOf("/")),
	);
	// Two candidates, in order: the markdown-relative join against the
	// current doc's directory, then the href verbatim (the docsRoot-relative
	// form the @ menu inserts). Leading "/" segments drop in normalization,
	// so repo-absolute hrefs read as docsRoot-absolute.
	for (const candidate of [
		normalize(dir ? `${dir}/${decoded}` : decoded),
		normalize(decoded),
	]) {
		if (!candidate.escaped && knownDocPaths.has(candidate.path)) {
			return { kind: "doc", path: candidate.path };
		}
	}
	return { kind: "default" };
}
