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
	/** sha256 of `markdown` — sent back as `baseHash` on save. */
	hash: string;
}

export interface SaveResponse {
	sha: string;
	/** Hash of the body as written — use it as the next save's baseHash. */
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
			// non-JSON error body — keep the generic message
		}
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
			// non-JSON error body — keep the generic message
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

/** Creates `name` — the server also checks it out. */
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

export const sync = () => request<SyncResult>("/api/sync", { method: "POST" });

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

export const addComment = (
	path: string,
	thread: { id: string; quote: string; body: string },
) =>
	request<{ sha: string }>(`/api/docs/${encodeURI(path)}/comments`, {
		method: "POST",
		headers: JSON_HEADERS,
		body: JSON.stringify(thread),
	});

/** One action per call (the server's PATCH shape): reply appends, resolved:true resolves. */
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

export const deleteComment = (path: string, id: string) =>
	request<{ sha: string }>(
		`/api/docs/${encodeURI(path)}/comments/${encodeURIComponent(id)}`,
		{ method: "DELETE" },
	);
