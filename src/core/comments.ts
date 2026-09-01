import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, sep } from "node:path";
import { commitAs } from "./commit.js";
import { canonicalBody, prepareDocWrite, resolveDocPath } from "./docs.js";
import { localUser } from "./identity.js";

/** No such comment thread in the sidecar – the server maps this to 404. */
export class ThreadNotFoundError extends Error {}

export interface CommentThread {
	/** == the data-c span id in the doc body. */
	id: string;
	/** Snapshot of the marked text, captured once at creation. */
	quote: string;
	/** From localUser() (M2); v2 = GitHub identity. */
	author: string;
	/** ISO. */
	createdAt: string;
	resolved: boolean;
	/** The opening comment is replies[0]; later replies append. */
	replies: { author: string; body: string; at: string }[];
}
export type CommentFile = { comments: Record<string, CommentThread> };

/** Where a doc's comment threads live: `<repoRoot>/.docs/comments/<docPath>.json`. */
export function sidecarPath(repoRoot: string, docPath: string): string {
	// The sidecar lives under .docs/, OUTSIDE docsRoot – but containment is
	// base-relative, so the shared resolveDocPath guard applies unchanged by
	// passing the sidecar root as the "docsRoot" (kind "folder": the path ends
	// in .md.json, not .md; traversal rules are identical). One guard, no
	// duplicated traversal code, and `../` in docPath cannot escape the repo.
	return resolveDocPath(
		repoRoot,
		".docs/comments",
		`${docPath}.json`,
		"folder",
	);
}

/** Read a doc's sidecar. `{comments:{}}` when none exists yet. */
export async function readComments(
	repoRoot: string,
	docPath: string,
): Promise<CommentFile> {
	const abs = sidecarPath(repoRoot, docPath);
	if (!existsSync(abs)) return { comments: {} };
	return JSON.parse(readFileSync(abs, "utf8")) as CommentFile;
}

/** Repo-root-relative POSIX path – the shape commitAs stages and commits. */
function repoRel(repoRoot: string, abs: string): string {
	return relative(repoRoot, abs).split(sep).join("/");
}

/**
 * Serialize a sidecar to disk (no commit) – the write half of writeComments,
 * shared by the combined doc+sidecar ops so their ONE commit covers both
 * files. JSON.stringify keeps object key order stable across
 * read-modify-write, so diffs touch only what changed; tab indent + one
 * trailing newline match writeConfig's house style.
 */
function writeSidecar(repoRoot: string, docPath: string, file: CommentFile) {
	const abs = sidecarPath(repoRoot, docPath);
	mkdirSync(dirname(abs), { recursive: true });
	writeFileSync(abs, `${JSON.stringify(file, null, "\t")}\n`);
	return abs;
}

/** A fresh thread record: the opening body becomes replies[0]. */
function newThread(
	user: { name: string },
	id: string,
	quote: string,
	body: string,
): CommentThread {
	const now = new Date().toISOString();
	return {
		id,
		quote,
		author: user.name,
		createdAt: now,
		resolved: false,
		replies: [{ author: user.name, body, at: now }],
	};
}

/**
 * Write a sidecar and commit it. One commitAs per write, message
 * `Update comments for <docPath>`. Identity is read before anything touches
 * disk (createDoc pattern); `who` (the b4 agent --author) overrides the local
 * git identity for both the commit and the sidecar's author fields.
 */
export async function writeComments(
	repoRoot: string,
	docPath: string,
	file: CommentFile,
	who?: { name: string; email: string },
): Promise<{ sha: string }> {
	const user = who ?? (await localUser(repoRoot));
	const abs = writeSidecar(repoRoot, docPath, file);
	const sha = await commitAs(
		user,
		{
			files: [repoRel(repoRoot, abs)],
			message: `Update comments for ${docPath}`,
		},
		repoRoot,
	);
	return { sha };
}

/** Create a thread (the opening body becomes replies[0]) in one commit.
 *  `who` (serve --auth) overrides the local git identity for the commit and
 *  the author fields; omitted → localUser(). */
export async function addThread(
	repoRoot: string,
	docPath: string,
	id: string,
	quote: string,
	body: string,
	who?: { name: string; email: string },
): Promise<{ sha: string }> {
	const user = who ?? (await localUser(repoRoot));
	const file = await readComments(repoRoot, docPath);
	file.comments[id] = newThread(user, id, quote, body);
	return writeComments(repoRoot, docPath, file, user);
}

/** Append a reply to a thread in one commit. Missing thread → 404. */
export async function addReply(
	repoRoot: string,
	docPath: string,
	id: string,
	body: string,
	who?: { name: string; email: string },
): Promise<{ sha: string }> {
	const user = who ?? (await localUser(repoRoot));
	const file = await readComments(repoRoot, docPath);
	const thread = file.comments[id];
	if (!thread) throw new ThreadNotFoundError(id);
	thread.replies.push({
		author: user.name,
		body,
		at: new Date().toISOString(),
	});
	return writeComments(repoRoot, docPath, file, user);
}

/** Set a thread's resolved flag in one commit (the span stays – resolve ≠ delete). */
export async function setResolved(
	repoRoot: string,
	docPath: string,
	id: string,
	resolved: boolean,
	who?: { name: string; email: string },
): Promise<{ sha: string }> {
	const file = await readComments(repoRoot, docPath);
	const thread = file.comments[id];
	if (!thread) throw new ThreadNotFoundError(id);
	thread.resolved = resolved;
	return writeComments(repoRoot, docPath, file, who);
}

/** Remove a sidecar entry in one commit. Missing thread → 404.
 *  `who` (serve --auth) overrides the commit author; omitted → localUser(). */
export async function deleteThread(
	repoRoot: string,
	docPath: string,
	id: string,
	who?: { name: string; email: string },
): Promise<{ sha: string }> {
	const file = await readComments(repoRoot, docPath);
	if (!file.comments[id]) throw new ThreadNotFoundError(id);
	delete file.comments[id];
	return writeComments(repoRoot, docPath, file, who);
}

/**
 * Remove a thread's `<span data-c="id">` and its matching `</span>` from a
 * doc body, keeping the inner text (pure). Linear indexOf walk to the next
 * close tag – comment marks never nest, so the first `</span>` after the
 * open tag is the match. An unknown id (or an unbalanced span) returns the
 * body unchanged.
 */
export function stripCommentSpan(body: string, id: string): string {
	const open = `<span data-c="${id}">`;
	const start = body.indexOf(open);
	if (start === -1) return body;
	const close = body.indexOf("</span>", start + open.length);
	if (close === -1) return body;
	return (
		body.slice(0, start) +
		body.slice(start + open.length, close) +
		body.slice(close + "</span>".length)
	);
}

/**
 * Create a thread AND write the doc body carrying its span in ONE commit
 * (message `Comment on <docPath>`) – the M4-2 anchoring contract. The full
 * writeDoc discipline via the shared prepareDocWrite: identity resolved and
 * the stale-hash check on `baseHash` done BEFORE any disk write, frontmatter
 * reattached byte-for-byte, body LF-canonical. Author comes from the same
 * localUser identity the commit uses (as in addThread).
 */
export async function addThreadWithDoc(
	repoRoot: string,
	docsRoot: string,
	docPath: string,
	thread: {
		id: string;
		quote: string;
		body: string;
		/** The full doc body WITH the new span, as the editor serialized it. */
		docBody: string;
		/** Hash of the doc body as loaded (the writeDoc contract). */
		baseHash: string;
	},
	user?: { name: string; email: string },
): Promise<{ sha: string }> {
	const prep = await prepareDocWrite(
		repoRoot,
		docsRoot,
		docPath,
		thread.baseHash,
		user,
	);
	const file = await readComments(repoRoot, docPath);
	file.comments[thread.id] = newThread(
		prep.user,
		thread.id,
		thread.quote,
		thread.body,
	);
	writeFileSync(prep.abs, prep.raw(canonicalBody(thread.docBody)));
	const sidecarAbs = writeSidecar(repoRoot, docPath, file);
	const sha = await commitAs(
		prep.user,
		{
			files: [repoRel(repoRoot, prep.abs), repoRel(repoRoot, sidecarAbs)],
			message: `Comment on ${docPath}`,
		},
		repoRoot,
	);
	return { sha };
}

/**
 * Remove a thread and strip its span from the doc in ONE commit (message
 * `Remove comment on <docPath>`): stale-check on `baseHash` first, then the
 * current body with the span removed (everything else byte-for-byte) plus
 * the sidecar with the entry gone. Missing thread → 404, before any write.
 */
export async function deleteThreadWithDoc(
	repoRoot: string,
	docsRoot: string,
	docPath: string,
	id: string,
	baseHash: string,
	user?: { name: string; email: string },
): Promise<{ sha: string }> {
	const prep = await prepareDocWrite(
		repoRoot,
		docsRoot,
		docPath,
		baseHash,
		user,
	);
	const file = await readComments(repoRoot, docPath);
	if (!file.comments[id]) throw new ThreadNotFoundError(id);
	delete file.comments[id];
	writeFileSync(prep.abs, prep.raw(stripCommentSpan(prep.current, id)));
	const sidecarAbs = writeSidecar(repoRoot, docPath, file);
	const sha = await commitAs(
		prep.user,
		{
			files: [repoRel(repoRoot, prep.abs), repoRel(repoRoot, sidecarAbs)],
			message: `Remove comment on ${docPath}`,
		},
		repoRoot,
	);
	return { sha };
}

/**
 * The orphan rule (pure): a sidecar thread is live iff its id appears as a
 * `data-c="<id>"` span in the doc markdown; absent → orphaned (the quote
 * snapshot keeps it readable). Ids are UUIDs, so a plain substring scan is
 * safe – no user text ever reaches the needle.
 */
export function reconcileThreads(
	docMarkdown: string,
	file: CommentFile,
): { live: CommentThread[]; orphaned: CommentThread[] } {
	const live: CommentThread[] = [];
	const orphaned: CommentThread[] = [];
	for (const thread of Object.values(file.comments)) {
		(docMarkdown.includes(`data-c="${thread.id}"`) ? live : orphaned).push(
			thread,
		);
	}
	return { live, orphaned };
}
