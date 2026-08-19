import { readDoc } from "./docs.js";
import { currentBranch, git, listBranches, logCommits } from "./git.js";

export interface DocMeta {
	author: string;
	authorEmail: string;
	date: string;
	version: number;
	/** First non-heading, non-empty, non-table body line, clamped to 110 chars. */
	snippet: string;
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

/** Card snippet: first non-heading, non-empty, non-table body line (fs read; missing file → ""). */
function snippet(repoRoot: string, docsRoot: string, docPath: string): string {
	let body: string;
	try {
		body = readDoc(repoRoot, docsRoot, docPath).markdown;
	} catch {
		return ""; // not on this branch's worktree — no snippet
	}
	for (const line of body.split("\n")) {
		const t = line.trim();
		if (!t || t.startsWith("#") || t.startsWith("|")) continue;
		return t.slice(0, 110);
	}
	return "";
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
				};
		}
	}
	// One fs read per doc (the card snippet) — the walk above is git-only.
	for (const docPath of Object.keys(docs)) {
		docs[docPath].snippet = snippet(repoRoot, docsRoot, docPath);
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

	return {
		main,
		current: await currentBranch(repoRoot),
		docs,
		drafts,
		deleted,
	};
}
