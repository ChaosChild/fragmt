import type { GithubSlug } from "./git.js";

/**
 * #27 (D3): the typed GitHub REST client. ghApi sends the exact headers
 * auth.ts already sends, JSON body in/out, injectable fetch (the
 * ServerContext.githubFetch pattern). Non-2xx is a RETURNED status, never a
 * throw – callers branch; only a network failure rejects.
 */

/** The shared GitHub REST opts – same contract auth.ts already sends. */
export interface GhApiOpts {
	fetchImpl?: typeof fetch;
	token: string;
}

export interface PullRequest {
	number: number;
	title: string;
	state: "open" | "closed";
	draft: boolean;
	mergeable: boolean | null;
	html_url: string;
	head: { ref: string; sha: string };
	base: { ref: string };
	user: { login: string };
	changed_files: number;
	commits?: number;
	additions?: number;
	deletions?: number;
}

export interface PullRequestFile {
	filename: string;
	status: string;
	additions: number;
	deletions: number;
	patch?: string;
}

/** One REST call. `body` is JSON-encoded when present; the answer's body is
 *  parsed JSON (null on empty or malformed). */
export async function ghApi(
	fetchImpl: typeof fetch,
	token: string,
	path: string,
	init?: { method?: string; body?: unknown },
): Promise<{ status: number; body: unknown }> {
	const res = await fetchImpl(`https://api.github.com${path}`, {
		method: init?.method,
		...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
		headers: {
			authorization: `Bearer ${token}`,
			accept: "application/vnd.github+json",
			"x-github-api-version": "2022-11-28",
			...(init?.body === undefined
				? {}
				: { "content-type": "application/json" }),
		},
	});
	return { status: res.status, body: await res.json().catch(() => null) };
}

const pulls = (slug: GithubSlug) => `/repos/${slug.owner}/${slug.repo}/pulls`;

/** Open PRs – the branch→PR map's source. */
export async function listPulls(
	slug: GithubSlug,
	{ fetchImpl = globalThis.fetch, token }: GhApiOpts,
): Promise<{ status: number; body: PullRequest[] }> {
	const r = await ghApi(fetchImpl, token, `${pulls(slug)}?state=open`);
	return {
		status: r.status,
		body: Array.isArray(r.body) ? (r.body as PullRequest[]) : [],
	};
}

/** One PR; 404 is a returned status. */
export async function getPull(
	slug: GithubSlug,
	n: number,
	{ fetchImpl = globalThis.fetch, token }: GhApiOpts,
): Promise<{ status: number; body: PullRequest }> {
	const r = await ghApi(fetchImpl, token, `${pulls(slug)}/${n}`);
	return { status: r.status, body: r.body as PullRequest };
}

/** One 20-file page of the PR's diff (D4's pager – never the full list). */
export async function getPullFiles(
	slug: GithubSlug,
	n: number,
	page: number,
	{ fetchImpl = globalThis.fetch, token }: GhApiOpts,
): Promise<{ status: number; body: PullRequestFile[] }> {
	const r = await ghApi(
		fetchImpl,
		token,
		`${pulls(slug)}/${n}/files?per_page=20&page=${page}`,
	);
	return {
		status: r.status,
		body: Array.isArray(r.body) ? (r.body as PullRequestFile[]) : [],
	};
}

/** Create a PR; title/head/base/body follow the route's fixed direction. */
export async function createPull(
	slug: GithubSlug,
	input: { title: string; head: string; base: string; body?: string },
	{ fetchImpl = globalThis.fetch, token }: GhApiOpts,
): Promise<{ status: number; body: PullRequest & { message?: string } }> {
	const r = await ghApi(fetchImpl, token, pulls(slug), {
		method: "POST",
		body: input,
	});
	return {
		status: r.status,
		body: r.body as PullRequest & { message?: string },
	};
}

/** Merge a PR – the repo's own rules decide the method. */
export async function mergePull(
	slug: GithubSlug,
	n: number,
	{ fetchImpl = globalThis.fetch, token }: GhApiOpts,
): Promise<{ status: number; body: { merged?: boolean; message?: string } }> {
	const r = await ghApi(fetchImpl, token, `${pulls(slug)}/${n}/merge`, {
		method: "PUT",
	});
	return {
		status: r.status,
		body: r.body as { merged?: boolean; message?: string },
	};
}

/** The repo's default branch – every PR's base. */
export async function repoDefaultBranch(
	slug: GithubSlug,
	{ fetchImpl = globalThis.fetch, token }: GhApiOpts,
): Promise<{ status: number; body: { default_branch?: string } }> {
	const r = await ghApi(fetchImpl, token, `/repos/${slug.owner}/${slug.repo}`);
	return { status: r.status, body: r.body as { default_branch?: string } };
}
