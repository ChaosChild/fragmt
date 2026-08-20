import { loadConfig } from "./config.js";
import { readDoc } from "./docs.js";
import { mergeState } from "./drafts.js";
import { currentBranch, git, listBranches, logCommits } from "./git.js";

export interface DocMeta {
	author: string;
	authorEmail: string;
	date: string;
	version: number;
	/** First non-heading, non-empty, non-table body line, clamped to 110 chars. */
	snippet: string;
	/** Frontmatter `title` (the display-name model, M4-3 b4); null when the
	 *  doc has none — the file name sans .md is the fallback. */
	title: string | null;
}

export interface DraftEntry {
	branch: string;
	status: "new" | "edited" | "deleted";
}

export interface DeletedDoc {
	path: string;
	/** The delete commit — `<sha>^:<path>` holds the last live content. */
	sha: string;
	date: string;
}

export interface RepoMeta {
	/** "main" → "master" → null; null = no draft model (chips hidden, main unprotected). */
	main: string | null;
	current: string;
	/** docsRoot-relative .md paths. */
	docs: Record<string, DocMeta>;
	drafts: Record<string, DraftEntry[]>;
	/** Deletions reachable from HEAD, latest first, deduped by path. */
	deleted: DeletedDoc[];
	/** email → GitHub username (avatar resolution) — the config map verbatim,
	 *  {} when the repo has no map. */
	authors: Record<string, string>;
	/** Non-null while a merge fragmt stood is being resolved — summary only;
	 *  the full per-file detail is mergeState (b3's GET /api/merge). */
	merge: { branch: string | null; remaining: number } | null;
}

/** The main branch name: "main" → "master" → null (rev-parse --verify). */
export async function mainBranch(repoRoot: string): Promise<string | null> {
	for (const name of ["main", "master"]) {
		const exists = await git(repoRoot, [
			"rev-parse",
			"--verify",
			"--quiet",
			name,
		]).then(
			() => true,
			() => false,
		);
		if (exists) return name;
	}
	return null;
}

/**
 * Unit-separator record parser shared by the `%x1e`-terminated log walks:
 * a line containing the unit separator opens a commit record; every non-empty
 * line after it is one of that commit's file paths (git emits the meta line,
 * a blank line, then the paths — blank separators dropped here).
 */
function logRecords(out: string): { fields: string[]; paths: string[] }[] {
	const records: { fields: string[]; paths: string[] }[] = [];
	for (const raw of out.split("\n")) {
		const line = raw.replaceAll("\x1e", "");
		if (line.includes("\x1f")) {
			records.push({ fields: line.split("\x1f"), paths: [] });
		} else if (line !== "" && records.length > 0) {
			records[records.length - 1].paths.push(line);
		}
	}
	return records;
}

/** Repo-relative POSIX path → docsRoot-relative doc path, null when not a docsRoot .md. */
function toDocPath(repoRel: string, prefix: string): string | null {
	if (!repoRel.toLowerCase().endsWith(".md")) return null;
	if (prefix === "") return repoRel;
	return repoRel.startsWith(`${prefix}/`)
		? repoRel.slice(prefix.length + 1)
		: null;
}

/** The per-doc fs read's card extras (one read for both): the snippet (first
 *  non-heading, non-empty, non-table body line) and the frontmatter title.
 *  Missing file → empty snippet and no title (not on this branch's worktree). */
function docExtras(
	repoRoot: string,
	docsRoot: string,
	docPath: string,
): { snippet: string; title: string | null } {
	let frontmatter: Record<string, unknown>;
	let body: string;
	try {
		const doc = readDoc(repoRoot, docsRoot, docPath);
		frontmatter = doc.frontmatter;
		body = doc.markdown;
	} catch {
		return { snippet: "", title: null }; // not on this branch's worktree
	}
	const title =
		typeof frontmatter.title === "string" ? frontmatter.title : null;
	let snippet = "";
	for (const line of body.split("\n")) {
		const t = line.trim();
		if (!t || t.startsWith("#") || t.startsWith("|")) continue;
		snippet = t.slice(0, 110);
		break;
	}
	return { snippet, title };
}

/**
 * The M4-2 meta walks — docs versions, cross-branch drafts, and the recycle
 * bin — each a small spawn count over the execFile seam.
 */
export async function repoMeta(
	repoRoot: string,
	docsRoot: string,
): Promise<RepoMeta> {
	const main = await mainBranch(repoRoot);
	const prefix =
		docsRoot === "." ? "" : docsRoot.replace(/\\/g, "/").replace(/\/+$/, "");

	// Walk 1 — one pass over HEAD history: per docsRoot .md path, the commit
	// count (version) and the newest author/email/date. Log order is
	// newest-first, so the first record seen for a path carries the newest
	// author/email/date and every later one just bumps the count.
	// ponytail: capped at 2000 commits, no --follow (a rename restarts the
	// count) — raise the cap / add --follow if a real repo outgrows it.
	const docs: Record<string, DocMeta> = {};
	const history = await logCommits(repoRoot, [
		"-n",
		"2000",
		"--format=%H%x1f%an%x1f%ae%x1f%aI%x1e",
		"--name-only",
	]);
	for (const { fields, paths } of logRecords(history)) {
		for (const repoRel of paths) {
			const docPath = toDocPath(repoRel, prefix);
			if (!docPath) continue;
			const meta = docs[docPath];
			if (meta) meta.version++;
			else
				docs[docPath] = {
					author: fields[1],
					authorEmail: fields[2],
					date: fields[3],
					version: 1,
					snippet: "",
					title: null,
				};
		}
	}
	// One fs read per doc (snippet + frontmatter title) — the walk above is
	// git-only.
	for (const docPath of Object.keys(docs)) {
		Object.assign(docs[docPath], docExtras(repoRoot, docsRoot, docPath));
	}

	// Walk 2 — per non-main branch, which docsRoot docs differ from main:
	// A → new, M → edited, D → deleted; newest-first, so the first status
	// seen per (branch, path) is the latest.
	// ponytail: one git log spawn per branch (N branches = N spawns) — fine
	// at personal-tool branch counts; batch if a repo ever carries hundreds.
	const drafts: Record<string, DraftEntry[]> = {};
	if (main) {
		const statusByLetter: Record<string, DraftEntry["status"]> = {
			A: "new",
			M: "edited",
			D: "deleted",
		};
		for (const branch of await listBranches(repoRoot)) {
			if (branch === main) continue;
			const out = await logCommits(repoRoot, [
				"-n",
				"500",
				`${main}..${branch}`,
				"--name-status",
				"--format=%H",
			]);
			const seen = new Set<string>();
			for (const line of out.split("\n")) {
				const tab = line.indexOf("\t");
				if (tab < 0) continue; // commit sha lines carry no tab
				const status = statusByLetter[line[0]];
				if (!status) continue; // renames/copies/scores unmapped
				const docPath = toDocPath(line.slice(tab + 1), prefix);
				if (!docPath || seen.has(docPath)) continue;
				seen.add(docPath);
				if (!drafts[docPath]) drafts[docPath] = [];
				drafts[docPath].push({ branch, status });
			}
		}
	}

	// Walk 3 — the recycle bin: deletions reachable from HEAD, filtered to
	// docsRoot .md; newest-first, deduped by path (delete → restore → delete
	// keeps only the latest delete commit).
	// ponytail: capped at the 200 most recent deletions — plenty for a bin UI.
	const deleted: DeletedDoc[] = [];
	const gone = new Set<string>();
	const bin = await logCommits(repoRoot, [
		"-n",
		"200",
		"--diff-filter=D",
		"--format=%H%x1f%aI%x1e",
		"--name-only",
	]);
	for (const { fields, paths } of logRecords(bin)) {
		for (const repoRel of paths) {
			const docPath = toDocPath(repoRel, prefix);
			if (!docPath || gone.has(docPath)) continue;
			gone.add(docPath);
			deleted.push({ path: docPath, sha: fields[0], date: fields[1] });
		}
	}

	// The authors map (avatar resolution): the config verbatim. RepoMeta has
	// only repoRoot/docsRoot — the config is read here, the same loader the
	// CLI uses for docsRoot; any config problem just means no map ({}) —
	// never a failed meta walk over a cosmetic feature.
	let authors: Record<string, string> = {};
	try {
		authors = loadConfig(repoRoot).authors ?? {};
	} catch {
		// no config / malformed — no authors map
	}

	// The merge summary (resolution mode's on-switch, b3): mergeState is one
	// existsSync (zero spawns) when no merge stands, and only walks files
	// mid-merge. (meta ↔ drafts is a call-time-only import cycle: each side
	// uses the other inside function bodies, never at module init.)
	const state = await mergeState(repoRoot, docsRoot);

	return {
		main,
		current: await currentBranch(repoRoot),
		docs,
		drafts,
		deleted,
		authors,
		merge: state.inMerge
			? { branch: state.branch, remaining: state.remaining }
			: null,
	};
}
