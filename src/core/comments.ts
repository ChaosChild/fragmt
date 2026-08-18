import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, sep } from "node:path";
import { commitAs } from "./commit.js";
import { resolveDocPath } from "./docs.js";
import { localUser } from "./identity.js";

/** No such comment thread in the sidecar — the server maps this to 404. */
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
	// The sidecar lives under .docs/, OUTSIDE docsRoot — but containment is
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

/**
 * Write a sidecar and commit it. One commitAs per write, message
 * `Update comments for <docPath>`. JSON.stringify keeps object key order
 * stable across read-modify-write, so diffs touch only what changed;
 * tab indent + one trailing newline match writeConfig's house style.
 * Identity is read before anything touches disk (createDoc pattern).
 */
export async function writeComments(
	repoRoot: string,
	docPath: string,
	file: CommentFile,
): Promise<{ sha: string }> {
	const user = await localUser(repoRoot);
	const abs = sidecarPath(repoRoot, docPath);
	mkdirSync(dirname(abs), { recursive: true });
	writeFileSync(abs, `${JSON.stringify(file, null, "\t")}\n`);
	const repoRel = relative(repoRoot, abs).split(sep).join("/");
	const sha = await commitAs(
		user,
		{ files: [repoRel], message: `Update comments for ${docPath}` },
		repoRoot,
	);
	return { sha };
}

/** Create a thread (the opening body becomes replies[0]) in one commit. */
export async function addThread(
	repoRoot: string,
	docPath: string,
	id: string,
	quote: string,
	body: string,
): Promise<{ sha: string }> {
	const user = await localUser(repoRoot);
	const file = await readComments(repoRoot, docPath);
	const now = new Date().toISOString();
	file.comments[id] = {
		id,
		quote,
		author: user.name,
		createdAt: now,
		resolved: false,
		replies: [{ author: user.name, body, at: now }],
	};
	return writeComments(repoRoot, docPath, file);
}

/** Append a reply to a thread in one commit. Missing thread → 404. */
export async function addReply(
	repoRoot: string,
	docPath: string,
	id: string,
	body: string,
): Promise<{ sha: string }> {
	const user = await localUser(repoRoot);
	const file = await readComments(repoRoot, docPath);
	const thread = file.comments[id];
	if (!thread) throw new ThreadNotFoundError(id);
	thread.replies.push({
		author: user.name,
		body,
		at: new Date().toISOString(),
	});
	return writeComments(repoRoot, docPath, file);
}

/** Mark a thread resolved in one commit (the span stays — resolve ≠ delete). */
export async function resolveThread(
	repoRoot: string,
	docPath: string,
	id: string,
): Promise<{ sha: string }> {
	const file = await readComments(repoRoot, docPath);
	const thread = file.comments[id];
	if (!thread) throw new ThreadNotFoundError(id);
	thread.resolved = true;
	return writeComments(repoRoot, docPath, file);
}

/** Remove a sidecar entry in one commit. Missing thread → 404. */
export async function deleteThread(
	repoRoot: string,
	docPath: string,
	id: string,
): Promise<{ sha: string }> {
	const file = await readComments(repoRoot, docPath);
	if (!file.comments[id]) throw new ThreadNotFoundError(id);
	delete file.comments[id];
	return writeComments(repoRoot, docPath, file);
}

/**
 * The orphan rule (pure): a sidecar thread is live iff its id appears as a
 * `data-c="<id>"` span in the doc markdown; absent → orphaned (the quote
 * snapshot keeps it readable). Ids are UUIDs, so a plain substring scan is
 * safe — no user text ever reaches the needle.
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
