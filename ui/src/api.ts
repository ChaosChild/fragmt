export interface TreeNode {
	name: string;
	/** POSIX path relative to docsRoot; "" for the root node. */
	path: string;
	type: "dir" | "doc";
	children?: TreeNode[];
}

export interface DocResponse {
	path: string;
	frontmatter: Record<string, unknown>;
	markdown: string;
	/** sha256 of `markdown` – sent back as `baseHash` on save. */
	hash: string;
}

export interface SaveResponse {
	sha: string;
	/** Hash of the body as written – use it as the next save's baseHash. */
	hash: string;
}

export async function getTree(): Promise<TreeNode> {
	const res = await fetch("/api/tree");
	if (!res.ok) throw new Error(`failed to load tree (${res.status})`);
	return (await res.json()) as TreeNode;
}

export async function getDoc(path: string): Promise<DocResponse> {
	const res = await fetch(`/api/docs/${encodeURI(path)}`);
	if (!res.ok) throw new Error(`failed to load ${path} (${res.status})`);
	return (await res.json()) as DocResponse;
}

/** Error carrying the HTTP status, so callers can branch on 409. */
export class SaveError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
		this.name = "SaveError";
	}
}

export async function saveDoc(
	path: string,
	markdown: string,
	baseHash: string,
): Promise<SaveResponse> {
	const res = await fetch(`/api/docs/${encodeURI(path)}`, {
		method: "PUT",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ markdown, baseHash }),
	});
	if (!res.ok) {
		let message = `save failed (${res.status})`;
		try {
			const body = (await res.json()) as { error?: string };
			if (body.error) message = body.error;
		} catch {
			// non-JSON error body – keep the generic message
		}
		if (res.status === 401) authExpired();
		throw new SaveError(res.status, message);
	}
	return (await res.json()) as SaveResponse;
}

// --- M3: file lifecycle, branches, sync ----------------------------------

export interface BranchesResponse {
	current: string;
	branches: string[];
}

/** Mirror of the core SyncResult. */
export interface SyncResult {
	conflict: boolean;
	message?: string;
}

/** Fetch for the M3 routes; `{ error }` bodies become the message. */
async function request<T>(url: string, init?: RequestInit): Promise<T> {
	const res = await fetch(url, init);
	if (!res.ok) {
		let message = `request failed (${res.status})`;
		try {
			const body = (await res.json()) as { error?: string };
			if (body.error) message = body.error;
		} catch {
			// non-JSON error body – keep the generic message
		}
		if (res.status === 401) {
			authExpired();
			throw new AuthError(message);
		}
		throw new Error(message);
	}
	return (await res.json()) as T;
}

const JSON_HEADERS = { "content-type": "application/json" };

export const createDoc = (path: string, body = "") =>
	request<{ sha: string }>("/api/docs", {
		method: "POST",
		headers: JSON_HEADERS,
		body: JSON.stringify({ path, body }),
	});

export const moveDoc = (from: string, to: string) =>
	request<{ sha: string }>(`/api/docs/${encodeURI(from)}`, {
		method: "PATCH",
		headers: JSON_HEADERS,
		body: JSON.stringify({ to }),
	});

/** The PATCH's other branch (M4-3 b4): writes the frontmatter title – the
 *  display name – without ever touching the file path. */
export const setTitle = (path: string, title: string) =>
	request<{ sha: string }>(`/api/docs/${encodeURI(path)}`, {
		method: "PATCH",
		headers: JSON_HEADERS,
		body: JSON.stringify({ title }),
	});

export const deleteDoc = (path: string) =>
	request<{ sha: string }>(`/api/docs/${encodeURI(path)}`, {
		method: "DELETE",
	});

export const createFolder = (path: string) =>
	request<{ sha: string }>("/api/folders", {
		method: "POST",
		headers: JSON_HEADERS,
		body: JSON.stringify({ path }),
	});

export const renameFolder = (from: string, to: string) =>
	request<{ sha: string }>(`/api/folders/${encodeURI(from)}`, {
		method: "PATCH",
		headers: JSON_HEADERS,
		body: JSON.stringify({ to }),
	});

export const deleteFolder = (path: string) =>
	request<{ sha: string }>(`/api/folders/${encodeURI(path)}`, {
		method: "DELETE",
	});

export const getBranches = () => request<BranchesResponse>("/api/branches");

/** Creates `name` – the server also checks it out. */
export const createBranch = (name: string) =>
	request<{ current: string }>("/api/branches", {
		method: "POST",
		headers: JSON_HEADERS,
		body: JSON.stringify({ name }),
	});

export const checkoutBranch = (name: string) =>
	request<{ current: string }>("/api/checkout", {
		method: "POST",
		headers: JSON_HEADERS,
		body: JSON.stringify({ name }),
	});

/** Own fetch (mergeDraft's pattern): the 409 unmerged body carries `unmerged`,
 *  not `error` – callers branch on SaveError.status to re-confirm a force
 *  delete. encodeURIComponent keeps slashed names (drafts/x) one segment. */
export async function deleteBranch(
	name: string,
	force = false,
): Promise<{ ok: boolean }> {
	const res = await fetch(
		`/api/branches/${encodeURIComponent(name)}${force ? "?force=1" : ""}`,
		{ method: "DELETE" },
	);
	if (!res.ok) {
		let message = `delete failed (${res.status})`;
		try {
			const body = (await res.json()) as { error?: string };
			if (body.error) message = body.error;
		} catch {
			// non-JSON error body – keep the generic message
		}
		if (res.status === 401) authExpired();
		throw new SaveError(res.status, message);
	}
	return (await res.json()) as { ok: boolean };
}

export const sync = () => request<SyncResult>("/api/sync", { method: "POST" });

// --- M4-2: repo meta, drafts, merge, restore -------------------------------

/** Mirror of the core meta types (src/core/meta.ts). */
export interface DocMeta {
	author: string;
	authorEmail: string;
	/** ISO. */
	date: string;
	version: number;
	snippet: string;
	/** Frontmatter title – the display name; null = file name sans .md. */
	title: string | null;
}
export interface DraftEntry {
	branch: string;
	status: "new" | "edited" | "deleted";
}
export interface DeletedDoc {
	path: string;
	/** The delete commit – the restore pulls the parent's content. */
	sha: string;
	/** ISO. */
	date: string;
}
export interface RepoMeta {
	/** null = no draft model (chips hidden, main unprotected). */
	main: string | null;
	current: string;
	docs: Record<string, DocMeta>;
	drafts: Record<string, DraftEntry[]>;
	deleted: DeletedDoc[];
	/** email → GitHub username (avatar resolution) – the config map verbatim. */
	authors: Record<string, string>;
	/** Agent display names – the config list verbatim (the rail's agent chip). */
	agents: string[];
	/** Non-null while a stood merge is being resolved (M4-4 b3) – resolution
	 *  mode's on-switch; the full per-file detail is getMergeState. */
	merge: { branch: string | null; remaining: number } | null;
}

export const getMeta = () => request<RepoMeta>("/api/meta");

/** Creates (or reuses) a drafts/<slug> branch for the doc and checks it out. */
export const startDraft = (docPath: string) =>
	request<{ current: string; reused: boolean }>("/api/draft", {
		method: "POST",
		headers: JSON_HEADERS,
		body: JSON.stringify({ docPath }),
	});

export interface DraftDiffResponse {
	doc: string;
	/** Body-relative 1-based inclusive changed-line ranges (#18). */
	lines: { start: number; end: number }[];
}

/** The draft gutter's payload for one doc – empty `lines` off-draft (#18). */
export const getDraftDiff = (docPath: string) =>
	request<DraftDiffResponse>(`/api/draft-diff/${encodeURI(docPath)}`);

/** Own fetch (saveDoc's pattern): the 409 conflict body carries `message`,
 *  not `error` – callers branch on SaveError.status to show the banner. A
 *  conflict body throws MergeError instead (M4-4 b3): `stood` decides
 *  resolution mode vs the honest terminal-reconcile fallback. */
export class MergeError extends SaveError {
	constructor(
		status: number,
		message: string,
		readonly payload: {
			merged: false;
			conflict: true;
			stood: boolean;
			branch?: string;
			files: string[];
			message?: string;
		},
	) {
		super(status, message);
		this.name = "MergeError";
	}
}

export async function mergeDraft(): Promise<{ sha: string }> {
	const res = await fetch("/api/merge", { method: "POST" });
	if (!res.ok) {
		let message = `merge failed (${res.status})`;
		let conflict: MergeError["payload"] | null = null;
		try {
			const body = (await res.json()) as {
				error?: string;
				message?: string;
				conflict?: boolean;
				stood?: boolean;
				branch?: string;
				files?: string[];
			};
			message = body.error ?? body.message ?? message;
			if (body.conflict)
				conflict = {
					merged: false,
					conflict: true,
					stood: Boolean(body.stood),
					branch: body.branch,
					files: body.files ?? [],
					message: body.message,
				};
		} catch {
			// non-JSON error body – keep the generic message
		}
		if (res.status === 401) authExpired();
		if (conflict) throw new MergeError(res.status, message, conflict);
		throw new SaveError(res.status, message);
	}
	return (await res.json()) as { sha: string };
}

// --- M4-4 b3: merge resolution ---------------------------------------------

/** Mirror of the core conflict types (src/core/conflict.ts via drafts.ts). */
export type ConflictPart = { text: string } | { ours: string; theirs: string };
export interface SidecarMergeSummary {
	keptFromOurs: number;
	keptFromTheirs: number;
	resolvedCarried: number;
	repliesMerged: number;
}
export type MergeFile =
	| { path: string; kind: "doc"; parts: ConflictPart[] }
	| { path: string; kind: "sidecar"; summary: SidecarMergeSummary }
	| { path: string; kind: "other" };
export type MergeState =
	| { inMerge: false }
	| {
			inMerge: true;
			branch: string | null;
			files: MergeFile[];
			remaining: number;
	  };

/** Full detail of the standing merge – `{inMerge:false}` when none stands. */
export const getMergeState = () => request<MergeState>("/api/merge");

/** Doc resolutions send the assembled text (content); sidecar resolutions one
 *  of the three structural choices – exactly one field, the PUT's shape. */
export const resolveMergeFile = (
	path: string,
	resolution: { content: string } | { choice: "merged" | "ours" | "theirs" },
) =>
	request<{ remaining: number }>("/api/merge/resolve", {
		method: "PUT",
		headers: JSON_HEADERS,
		body: JSON.stringify({ path, ...resolution }),
	});

/** Finishes the standing merge – the merge commit. */
export const concludeMerge = () =>
	request<{ sha: string }>("/api/merge/conclude", { method: "POST" });

/** Undoes the standing merge and returns to the draft branch. */
export const abortMerge = () =>
	request<{ ok: boolean }>("/api/merge/abort", { method: "POST" });

export const restoreDoc = (path: string, sha: string) =>
	request<{ sha: string }>("/api/restore", {
		method: "POST",
		headers: JSON_HEADERS,
		body: JSON.stringify({ path, sha }),
	});

// --- M4: comments ---------------------------------------------------------

/** Mirror of the core sidecar types (src/core/comments.ts). */
export interface CommentReply {
	author: string;
	body: string;
	/** ISO. */
	at: string;
}
export interface CommentThread {
	/** == the data-c span id in the doc body. */
	id: string;
	/** Snapshot of the marked text, captured once at creation. */
	quote: string;
	author: string;
	/** ISO. */
	createdAt: string;
	resolved: boolean;
	/** The opening comment is replies[0]; later replies append. */
	replies: CommentReply[];
}
export type CommentFile = { comments: Record<string, CommentThread> };

export const getComments = (path: string) =>
	request<CommentFile>(`/api/docs/${encodeURI(path)}/comments`);

/** docBody + docBaseHash present → the combined create: doc + sidecar in ONE commit. */
export const addComment = (
	path: string,
	thread: {
		id: string;
		quote: string;
		body: string;
		docBody?: string;
		docBaseHash?: string;
	},
) =>
	request<{ sha: string }>(`/api/docs/${encodeURI(path)}/comments`, {
		method: "POST",
		headers: JSON_HEADERS,
		body: JSON.stringify(thread),
	});

/** One action per call (the server's PATCH shape): reply appends, resolved flips either way. */
export const patchComment = (
	path: string,
	id: string,
	body: { resolved?: boolean; reply?: string },
) =>
	request<{ sha: string }>(
		`/api/docs/${encodeURI(path)}/comments/${encodeURIComponent(id)}`,
		{
			method: "PATCH",
			headers: JSON_HEADERS,
			body: JSON.stringify(body),
		},
	);

/** baseHash present → the combined delete: span stripped + entry removed in ONE commit. */
export const deleteComment = (path: string, id: string, baseHash?: string) =>
	request<{ sha: string }>(
		`/api/docs/${encodeURI(path)}/comments/${encodeURIComponent(id)}${
			baseHash ? `?baseHash=${encodeURIComponent(baseHash)}` : ""
		}`,
		{ method: "DELETE" },
	);

// --- #14: search -------------------------------------------------------------

/** Mirror of the core search hit (src/core/search.ts). */
export interface SearchHit {
	path: string;
	title: string;
	snippet: string;
}

/** The flat worktree scan – a trimmed <2-char query is the server's own []. */
export const searchDocs = (q: string) =>
	request<SearchHit[]>(`/api/search?q=${encodeURIComponent(q)}`);

// --- #20: auth -------------------------------------------------------------

/** Mirror of GET /api/auth/session – public, works whether auth is on or off. */
export interface AuthSession {
	enabled: boolean;
	user: { login: string } | null;
	canWrite: boolean;
}

export async function getAuthSession(): Promise<AuthSession> {
	const res = await fetch("/api/auth/session");
	if (!res.ok) throw new Error(`session check failed (${res.status})`);
	return (await res.json()) as AuthSession;
}

/** POST /api/auth/logout – 204, no body to read. */
export async function logout(): Promise<void> {
	await fetch("/api/auth/logout", { method: "POST" });
}

/** A 401 from an api call – the session is gone (expired server-side) and
 *  only re-sign-in helps. AuthGate listens via setOnAuthError and flips back
 *  to the sign-in card; call sites keep their existing error handling. */
export class AuthError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AuthError";
	}
}

// The expiry seam: the fetch helpers ping this on a 401; the gate registers
// itself on mount. One listener slot – there is exactly one gate.
let onAuthError: (() => void) | null = null;
export function setOnAuthError(fn: (() => void) | null) {
	onAuthError = fn;
}
function authExpired() {
	onAuthError?.();
}

/** The gate's render decision, pure for tests: auth off (local mode, zero
 *  chrome), signed out (the sign-in card), or the app. canWrite never
 *  changes the view – it only drives the read-only pill inside the app. */
export function authView(session: AuthSession): "off" | "signin" | "app" {
	if (!session.enabled) return "off";
	return session.user ? "app" : "signin";
}
