import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, posix, relative, resolve, sep } from "node:path";
import matter from "gray-matter";
import { commitAs } from "./commit.js";
import { loadConfig } from "./config.js";
import { canonicalBody, readDoc, StaleDocError } from "./docs.js";
import { localUser } from "./identity.js";
import { displayTitle, treeDocPaths } from "./search.js";
import { gitAllowList, listTree, type TreeNode } from "./tree.js";

/**
 * The OKF core (open-knowledge-format v0.2): the three §11 conformance
 * clauses, the §3.1 reserved filenames, generated `index.md` (§8), and the
 * derived `references`/`referenced-by` frontmatter cache (a §4.1 extension
 * key – body links stay canonical, the fields are a derived graph). Every
 * entry point is inert in non-OKF repos: callers gate on okfEnabled().
 */

/** §3.1: filenames with defined meaning at any level; MUST NOT hold concepts. */
export const RESERVED_NAMES = ["index.md", "log.md"];
/** §4.1: `type` is the only required key and any non-empty string is
 *  conformant (consumers MUST tolerate unknown types) – a generic default
 *  costs nothing. */
export const DEFAULT_TYPE = "concept";

/** Is this path's basename one of the reserved filenames? */
export function isReservedBase(path: string): boolean {
	return RESERVED_NAMES.includes(basename(path).toLowerCase());
}

/** OKF-mode gate: a missing/unreadable/legacy config is never a throw. */
export function okfEnabled(repoRoot: string): boolean {
	try {
		return loadConfig(repoRoot).okf === true;
	} catch {
		return false;
	}
}

/** Every doc path every other surface sees, in tree order: the shared
 *  gitAllowList enumeration (#14) with the treeDocPaths flattening –
 *  validate and the references graph walk this, never a second walker. */
export async function docPaths(
	repoRoot: string,
	docsRoot: string,
): Promise<string[]> {
	const allow = await gitAllowList(repoRoot, docsRoot);
	return treeDocPaths(listTree(repoRoot, docsRoot, allow ?? undefined));
}

/** Repo-root-relative POSIX path – the shape commitAs stages and commits. */
function repoRel(repoRoot: string, abs: string): string {
	return relative(repoRoot, abs).split(sep).join("/");
}

/** Does the file open with a `---` … `---` fence? gray-matter cannot tell a
 *  missing fence from an empty one (`matter` is "" for both) and swallows the
 *  whole body on an unclosed one, so the raw text decides (clause a). */
function hasFence(text: string): boolean {
	const lines = text.split(/\r?\n/);
	if (lines[0] !== "---") return false;
	return lines.slice(1).some((l) => l.trim() === "---");
}

export interface OkfFinding {
	/** docsRoot-relative POSIX path. */
	path: string;
	clause: "frontmatter" | "type" | "reserved";
	detail: string;
}
export interface OkfValidation {
	conformant: boolean;
	findings: OkfFinding[];
}

const CLAUSE_ORDER: Record<OkfFinding["clause"], number> = {
	frontmatter: 0,
	type: 1,
	reserved: 2,
};

/**
 * The three §11 clauses over the shared enumeration, one finding per
 * violation: (a) every non-reserved .md carries a parseable frontmatter
 * block – readDoc is the parser of record, its throw IS the finding; (b)
 * non-empty string `type`; (c) present `index.md`/`log.md` follow §8/§9.
 * Findings come back grouped by clause, path order within a group.
 */
export async function validateOkf(
	repoRoot: string,
	docsRoot: string,
): Promise<OkfValidation> {
	const findings: OkfFinding[] = [];
	for (const path of await docPaths(repoRoot, docsRoot)) {
		if (isReservedBase(path)) {
			reservedFindings(repoRoot, docsRoot, path, findings);
			continue;
		}
		try {
			const doc = readDoc(repoRoot, docsRoot, path);
			const text = readFileSync(
				resolve(resolve(repoRoot, docsRoot), path),
				"utf8",
			);
			if (!hasFence(text)) {
				findings.push({
					path,
					clause: "frontmatter",
					detail:
						text.split(/\r?\n/, 1)[0] === "---"
							? "unclosed frontmatter block"
							: "missing frontmatter block",
				});
				continue;
			}
			const type = doc.frontmatter.type;
			if (typeof type !== "string" || type.trim() === "") {
				findings.push({
					path,
					clause: "type",
					detail: "missing or empty type",
				});
			}
		} catch (e) {
			// readDoc threw: unparseable YAML (or the doc vanished mid-walk).
			findings.push({
				path,
				clause: "frontmatter",
				detail: `unparseable frontmatter: ${(e as Error).message.split("\n")[0]}`,
			});
		}
	}
	findings.sort(
		(a, b) =>
			CLAUSE_ORDER[a.clause] - CLAUSE_ORDER[b.clause] ||
			a.path.localeCompare(b.path),
	);
	return { conformant: findings.length === 0, findings };
}

/** Clause (c): the hard shape rules of a present reserved file. §8's
 *  "entries SHOULD include the description" and §9's entry prose are soft by
 *  §11 – only the structural MUSTs are flagged. */
function reservedFindings(
	repoRoot: string,
	docsRoot: string,
	path: string,
	findings: OkfFinding[],
): void {
	let markdown: string;
	let frontmatter: Record<string, unknown>;
	try {
		const doc = readDoc(repoRoot, docsRoot, path);
		markdown = doc.markdown;
		frontmatter = doc.frontmatter;
	} catch {
		return; // unreadable – not this clause's story to tell
	}
	if (basename(path).toLowerCase() === "index.md") {
		const isRoot = !path.includes("/");
		const extra = Object.keys(frontmatter).filter(
			(k) => !(isRoot && k === "okf_version"),
		);
		if (extra.length > 0) {
			findings.push({
				path,
				clause: "reserved",
				detail: isRoot
					? `only okf_version is allowed in the root index.md (found: ${extra.join(", ")})`
					: "index.md carries no frontmatter outside the bundle root",
			});
		}
		for (const line of markdown.split("\n")) {
			if (/^#{2,}\s/.test(line)) {
				findings.push({
					path,
					clause: "reserved",
					detail: `index sections are level-1 headings: ${line}`,
				});
			} else if (/^\*\s+/.test(line) && !/\]\(/.test(line)) {
				findings.push({
					path,
					clause: "reserved",
					detail: `index entry without a link: ${line}`,
				});
			}
		}
		return;
	}
	// log.md (§9): `## YYYY-MM-DD` headings, newest first. The `#` title and
	// entry prose are conventions, not violations.
	const dates: string[] = [];
	for (const line of markdown.split("\n")) {
		const heading = /^##\s+(.*)$/.exec(line);
		if (heading === null) continue;
		const date = heading[1].trim();
		if (/^\d{4}-\d{2}-\d{2}$/.test(date)) dates.push(date);
		else
			findings.push({
				path,
				clause: "reserved",
				detail: `log heading must be ## YYYY-MM-DD: ${line}`,
			});
	}
	for (let i = 1; i < dates.length; i++) {
		if (dates[i] >= dates[i - 1]) {
			findings.push({
				path,
				clause: "reserved",
				detail: `log entries must be newest first: ${dates[i]} after ${dates[i - 1]}`,
			});
		}
	}
}

/** Markdown link pattern: [text](target) – the leading `!` guard skips
 *  images, and the target stops at whitespace (a ` "title"` tail drops off). */
const LINK = /(^|[^!])\[([^\]]*)\]\(([^)\s]+)\)/g;

/**
 * The §6.1 link forms in a doc body, resolved to docsRoot-relative POSIX
 * paths and sorted (the `references` value): `/abs/path.md` is
 * bundle-relative (the recommended form), anything else resolves against the
 * doc's own directory. Link targets are user input feeding file writes, so
 * every resolution is containment-checked (`..` never leaves the bundle) and
 * must name an existing doc; broken links are skipped silently (§6.1: not
 * malformed). Self-links, non-.md targets, and links inside fenced code
 * blocks are excluded, and reserved files are never targets (they must not
 * carry the derived fields).
 */
export function extractRefs(
	docBody: string,
	docPath: string,
	allDocPaths: string[],
): string[] {
	const known = new Set(allDocPaths.filter((p) => !isReservedBase(p)));
	const dir = posix.dirname(docPath);
	const out = new Set<string>();
	let fenced = false;
	for (const line of docBody.split(/\r?\n/)) {
		if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
		if (fenced) continue;
		for (const match of line.matchAll(LINK)) {
			const resolved = resolveLink(match[3], dir);
			if (resolved !== null && resolved !== docPath && known.has(resolved)) {
				out.add(resolved);
			}
		}
	}
	return [...out].sort();
}

/** One link target → a docsRoot-relative POSIX path, or null when it cannot
 *  name a doc in this bundle (URL/anchor, non-md, or a `..` escape). */
function resolveLink(target: string, fromDir: string): string | null {
	if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#")) {
		return null; // external URL or in-page anchor
	}
	const rel = target.startsWith("/")
		? posix.normalize(target.slice(1)) // §6.1 absolute = bundle-relative
		: posix.normalize(posix.join(fromDir, target));
	if (
		rel === "" ||
		rel === "." ||
		rel.startsWith("..") ||
		posix.isAbsolute(rel)
	) {
		return null; // the bundle root itself, or an escape attempt
	}
	return rel;
}

/** A frontmatter value as a clean string list (both derived fields are
 *  string arrays); anything hand-mangled reads as [] and recomputes. */
export function refsList(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((v): v is string => typeof v === "string" && v !== "")
		: [];
}

/** A YAML string-array line: `references: ["a.md", "b.md"]` – each item
 *  JSON-stringified (a valid YAML double-quoted scalar, the setTitle trick)
 *  so paths with colons or quotes round-trip. */
function listLine(
	key: "references" | "referenced-by",
	targets: string[],
): string {
	return `${key}: [${targets.map((t) => JSON.stringify(t)).join(", ")}]`;
}

/** setTitle's editTitleLine, generalized: replace the top-level `<key>:`
 *  line in place, append at the fence's end when absent, remove on null. */
function replaceLine(raw: string, key: string, line: string | null): string {
	const lines = raw.split("\n");
	const at = lines.findIndex((l) => l.startsWith(`${key}:`));
	if (at === -1) {
		if (line !== null) lines.push(line);
	} else if (line === null) {
		lines.splice(at, 1);
	} else {
		lines[at] = line;
	}
	return lines.join("\n");
}

/**
 * Set (or clear) one of the derived list keys in raw frontmatter text
 * (between the fences, gray-matter's `matter` shape). An empty list REMOVES
 * the key – the fields are omitted entirely when they would be empty. Every
 * other line keeps its bytes; the YAML is never re-serialized.
 */
export function updateRefsField(
	raw: string,
	key: "references" | "referenced-by",
	targets: string[],
): string {
	if (raw === "") {
		return targets.length === 0 ? "" : listLine(key, targets);
	}
	return replaceLine(
		raw,
		key,
		targets.length === 0 ? null : listLine(key, targets),
	);
}

/** A frontmatter field rewrite request: `line` is the rendered `key: value`
 *  line, null removes the key. */
interface FieldUpdate {
	key: string;
	line: string | null;
}

/**
 * Apply field updates to one doc FILE, the prepareDocWrite/setTitle
 * discipline: line-spliced into the raw frontmatter (never re-serialized),
 * fence-to-body gap and body byte-for-byte. A doc without a fence gets one
 * only when a field must be written – carrying `type: concept` (a fence
 * without a type would itself be non-conformant); its original bytes follow
 * the fence verbatim. Returns the new file text, or null when nothing
 * changed.
 */
export function spliceDocFields(
	text: string,
	fields: FieldUpdate[],
): string | null {
	if (!hasFence(text)) {
		const adds = fields.filter((f) => f.line !== null);
		if (adds.length === 0) return null;
		const withType = adds.some((f) => f.key === "type")
			? adds
			: [
					{ key: "type", line: `type: ${JSON.stringify(DEFAULT_TYPE)}` },
					...adds,
				];
		return `---\n${withType.map((f) => f.line).join("\n")}\n---\n${text}`;
	}
	const parsed = matter(text, {});
	const gap = parsed.matter ? (parsed.content.match(/^\n+/)?.[0] ?? "") : "";
	let raw = parsed.matter;
	for (const f of fields) raw = replaceLine(raw, f.key, f.line);
	const next = `---${raw}\n---\n${gap}${canonicalBody(parsed.content)}`;
	return next === text ? null : next;
}

/**
 * writeDoc's OKF half: the saved doc's own `references` line set to the
 * freshly derived targets (removed when empty) on top of its current raw
 * frontmatter and the incoming body. A fence-less doc stays untouched when
 * there is nothing to carry (null) – conformance repairs are fixOkf's job.
 */
export function saveWithRefs(
	text: string,
	targets: string[],
	body: string,
): string | null {
	if (!hasFence(text)) {
		if (targets.length === 0) return null;
		return `---\ntype: ${DEFAULT_TYPE}\n${listLine("references", targets)}\n---\n${body}`;
	}
	const parsed = matter(text, {});
	const gap = parsed.matter ? (parsed.content.match(/^\n+/)?.[0] ?? "") : "";
	return `---${updateRefsField(parsed.matter, "references", targets)}\n---\n${gap}${body}`;
}

/**
 * Rewrite the `referenced-by` lists of exactly the docs the symmetric
 * difference of the saved doc's previous and new `references` touches
 * (§A1): removed targets lose docPath, added targets gain it, untouched
 * targets are not rewritten (a typical save still touches one file). All
 * targets are loaded first and re-read before any byte is written – a
 * concurrently-edited target aborts the whole batch (StaleDocError, the
 * server's 409) instead of clobbering. `read` is injectable for that race's
 * test. Returns the repo-relative paths written, for the caller's commit.
 */
export async function propagateRefs(
	repoRoot: string,
	docsRoot: string,
	docPath: string,
	prevTargets: string[],
	newTargets: string[],
	read: (abs: string) => string = (abs) => readFileSync(abs, "utf8"),
): Promise<string[]> {
	const docsAbs = resolve(repoRoot, docsRoot);
	const removed = prevTargets.filter(
		(t) => !newTargets.includes(t) && !isReservedBase(t),
	);
	const added = newTargets.filter(
		(t) => !prevTargets.includes(t) && !isReservedBase(t),
	);
	const targets = [...new Set([...removed, ...added])]
		.sort()
		.filter((t) => existsSync(resolve(docsAbs, t)));
	const loaded = new Map<string, string>();
	const batch: { abs: string; next: string }[] = [];
	for (const t of targets) {
		const abs = resolve(docsAbs, t);
		let text: string;
		try {
			text = read(abs);
			loaded.set(t, text);
		} catch {
			continue; // vanished between enumeration and here – not ours to fix
		}
		let current: string[];
		try {
			current = refsList(
				(matter(text, {}).data as Record<string, unknown>)["referenced-by"],
			);
		} catch {
			continue; // unparseable target frontmatter – never write what we can't read
		}
		const next = new Set(current);
		if (removed.includes(t)) next.delete(docPath);
		else next.add(docPath);
		const updated = spliceDocFields(text, [
			{
				key: "referenced-by",
				line:
					next.size === 0 ? null : listLine("referenced-by", [...next].sort()),
			},
		]);
		if (updated !== null) batch.push({ abs, next: updated });
	}
	// Stale gate: every loaded target must still hold its loaded bytes.
	for (const [t, text] of loaded) {
		if (read(resolve(docsAbs, t)) !== text) {
			throw new StaleDocError(`doc changed since load: ${t}`);
		}
	}
	for (const b of batch) writeFileSync(b.abs, b.next);
	return batch.map((b) => repoRel(repoRoot, b.abs));
}

/** A dir node's direct concept docs (reserved basenames excluded). */
function dirDocs(node: TreeNode): TreeNode[] {
	return (node.children ?? []).filter(
		(c) => c.type === "doc" && !isReservedBase(c.name),
	);
}

/** Does anything beneath the node hold concept docs? */
function hasDocsDeep(node: TreeNode): boolean {
	return (
		dirDocs(node).length > 0 ||
		(node.children ?? []).some((c) => c.type === "dir" && hasDocsDeep(c))
	);
}

/**
 * Regenerate every `index.md` whose directory holds concept docs (§8, D2):
 * `# <Type>` sections of `* [Title](/bundle/abs.md) - description` entries
 * (the description omitted when absent), concept-holding subdirectories
 * under a final `# Subdirectories` section, and – on the bundle root alone –
 * `okf_version: "0.2"` frontmatter (§12). Only changed files are written; a
 * hand-edited index is deliberately overwritten (consumers may synthesize
 * indexes anyway). Returns the repo-relative paths written.
 * ponytail: full regeneration per membership change, and an index.md
 * orphaned by its last doc moving away is left in place (broken links are
 * spec-tolerated) – prune on demand if it ever bites.
 */
export async function generateIndexes(
	repoRoot: string,
	docsRoot: string,
): Promise<string[]> {
	const allow = await gitAllowList(repoRoot, docsRoot);
	const tree = listTree(repoRoot, docsRoot, allow ?? undefined);
	const docsAbs = resolve(repoRoot, docsRoot);
	const changed: string[] = [];
	const walk = (node: TreeNode) => {
		const isRoot = node.path === "";
		const docs = dirDocs(node);
		if (docs.length === 0 && !(isRoot && hasDocsDeep(tree))) {
			// Still recurse: deeper dirs may hold docs even when this one is empty.
			for (const c of node.children ?? []) if (c.type === "dir") walk(c);
			return;
		}
		changed.push(...writeIndex(repoRoot, docsRoot, node, docs, docsAbs));
		for (const c of node.children ?? []) if (c.type === "dir") walk(c);
	};
	walk(tree);
	return changed;
}

/** One directory's index.md, written only when its bytes differ. */
function writeIndex(
	repoRoot: string,
	docsRoot: string,
	node: TreeNode,
	docs: TreeNode[],
	docsAbs: string,
): string[] {
	const sections: string[][] = [];
	const byType = new Map<
		string,
		{ title: string; path: string; desc: string }[]
	>();
	for (const doc of docs) {
		try {
			const front = readDoc(repoRoot, docsRoot, doc.path).frontmatter;
			const type = front.type;
			const entry = {
				title: displayTitle(front.title, doc.name),
				path: doc.path,
				desc:
					typeof front.description === "string" &&
					front.description.trim() !== ""
						? front.description
						: "",
			};
			const group =
				typeof type === "string" && type.trim() !== "" ? type : DEFAULT_TYPE;
			if (!byType.has(group)) byType.set(group, []);
			byType.get(group)?.push(entry);
		} catch {
			// unreadable doc – the index is a derived view, skip it
		}
	}
	for (const type of [...byType.keys()].sort((a, b) => a.localeCompare(b))) {
		const entries = (byType.get(type) ?? []).sort(
			(a, b) =>
				a.title.toLowerCase().localeCompare(b.title.toLowerCase()) ||
				a.path.localeCompare(b.path),
		);
		sections.push([
			`# ${type}`,
			"",
			...entries.map(
				(e) =>
					`* [${e.title}](/${e.path})${e.desc === "" ? "" : ` - ${e.desc}`}`,
			),
		]);
	}
	const subs = (node.children ?? [])
		.filter((c) => c.type === "dir" && hasDocsDeep(c))
		.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
	if (subs.length > 0) {
		sections.push([
			"# Subdirectories",
			"",
			...subs.map((s) => `* [${s.name}](/${s.path}/)`),
		]);
	}
	if (sections.length === 0) return []; // nothing to list, no index
	const front = node.path === "" ? '---\nokf_version: "0.2"\n---\n\n' : "";
	const next = `${front}${sections.map((s) => s.join("\n")).join("\n\n")}\n`;
	const abs = join(docsAbs, node.path, "index.md");
	if (existsSync(abs) && readFileSync(abs, "utf8") === next) return [];
	writeFileSync(abs, next);
	return [repoRel(repoRoot, abs)];
}

/**
 * Recompute the references graph repo-wide and splice both derived fields
 * into every doc whose lists changed (reserved files never carry them).
 * Returns the repo-relative paths changed.
 * ponytail: full-graph recompute per derivation, not an incremental edge
 * index – fine at fragmt scales; upgrade path is caching edges per doc.
 */
async function recomputeGraph(
	repoRoot: string,
	docsRoot: string,
): Promise<string[]> {
	const docsAbs = resolve(repoRoot, docsRoot);
	const paths = (await docPaths(repoRoot, docsRoot)).filter(
		(p) => !isReservedBase(p),
	);
	const graph = new Map<string, string[]>();
	const back = new Map<string, Set<string>>();
	for (const p of paths) {
		let refs: string[];
		try {
			refs = extractRefs(readDoc(repoRoot, docsRoot, p).markdown, p, paths);
		} catch {
			continue; // unreadable doc – validate reports it, never write blind
		}
		graph.set(p, refs);
		for (const t of refs) {
			if (!back.has(t)) back.set(t, new Set());
			back.get(t)?.add(p);
		}
	}
	const changed: string[] = [];
	for (const p of graph.keys()) {
		const abs = resolve(docsAbs, p);
		const refs = graph.get(p) ?? [];
		const refBy = back.get(p);
		const updated = spliceDocFields(readFileSync(abs, "utf8"), [
			{
				key: "references",
				line: refs.length === 0 ? null : listLine("references", refs),
			},
			{
				key: "referenced-by",
				line:
					refBy === undefined || refBy.size === 0
						? null
						: listLine("referenced-by", [...refBy].sort()),
			},
		]);
		if (updated !== null) {
			writeFileSync(abs, updated);
			changed.push(repoRel(repoRoot, abs));
		}
	}
	return changed;
}

/**
 * `fragmt validate --fix` (D4) in one commit, "OKF: apply conformance
 * fixes": prepend `---\ntype: concept\n---\n` to fence-less docs, force the
 * missing type through the setTitle splice, recompute references/
 * referenced-by repo-wide, regenerate the indexes. Existing YAML is never
 * re-serialized; an unparseable block is left for the operator (validate
 * reports it – no repair exists that does not rewrite their YAML).
 */
export async function fixOkf(
	repoRoot: string,
	docsRoot: string,
	user?: { name: string; email: string },
): Promise<{ sha: string; files: string[] }> {
	const who = user ?? (await localUser(repoRoot));
	const docsAbs = resolve(repoRoot, docsRoot);
	const files = new Set<string>();
	for (const p of await docPaths(repoRoot, docsRoot)) {
		if (isReservedBase(p)) continue;
		const abs = resolve(docsAbs, p);
		const text = readFileSync(abs, "utf8");
		try {
			matter(text, {});
		} catch {
			continue; // unparseable – reported by validate, never rewritten
		}
		if (!hasFence(text)) {
			// The literal conformant block; the derived fields land in the same
			// commit through recomputeGraph's splice.
			writeFileSync(abs, `---\ntype: ${DEFAULT_TYPE}\n---\n${text}`);
			files.add(repoRel(repoRoot, abs));
			continue;
		}
		const type = (matter(text, {}).data as Record<string, unknown>).type;
		if (typeof type !== "string" || type.trim() === "") {
			const updated = spliceDocFields(text, [
				{ key: "type", line: `type: ${JSON.stringify(DEFAULT_TYPE)}` },
			]);
			if (updated !== null) {
				writeFileSync(abs, updated);
				files.add(repoRel(repoRoot, abs));
			}
		}
	}
	for (const f of await recomputeGraph(repoRoot, docsRoot)) files.add(f);
	for (const f of await generateIndexes(repoRoot, docsRoot)) files.add(f);
	const sha =
		files.size === 0
			? ""
			: await commitAs(
					who,
					{ files: [...files], message: "OKF: apply conformance fixes" },
					repoRoot,
				);
	return { sha, files: [...files] };
}

/**
 * The `init --okf` adoption commit (D1): populate references/referenced-by
 * repo-wide and generate the index.md set – NO conformance repairs (adopt,
 * don't rewrite; findings are printed for the operator instead, and
 * `validate --fix` finishes the job). Returns the commit sha and the
 * changed files; an empty bundle commits nothing (sha "").
 */
export async function populateOkf(
	repoRoot: string,
	docsRoot: string,
	user?: { name: string; email: string },
): Promise<{ sha: string; files: string[] }> {
	const who = user ?? (await localUser(repoRoot));
	const files = new Set<string>(await recomputeGraph(repoRoot, docsRoot));
	for (const f of await generateIndexes(repoRoot, docsRoot)) files.add(f);
	const sha =
		files.size === 0
			? ""
			: await commitAs(
					who,
					{
						files: [...files],
						message: "OKF: populate references and indexes",
					},
					repoRoot,
				);
	return { sha, files: [...files] };
}
