import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import type { PullRequest } from "../src/core/github.js";
import { createApp } from "../src/server/index.js";

// #27 b2: the five PR routes over a stubbed GitHub REST (the server-auth
// harness – the code IS the login in the stub exchange) plus the gitPush/
// gitFetch seams, so no test ever runs a real push or fetch.

const repos: string[] = [];

afterEach(() => {
	for (const r of repos.splice(0)) rmSync(r, { recursive: true, force: true });
});

/** Throwaway repo with a local identity (server-auth.test.ts pattern). */
function gitRepo(origin?: string): string {
	const root = mkdtempSync(join(tmpdir(), "fragmt-prs-"));
	repos.push(root);
	const g = (args: string[]) => execFileSync("git", args, { cwd: root });
	g(["init", "-q", "-b", "main"]);
	g(["config", "user.name", "Local User"]);
	g(["config", "user.email", "local@example.com"]);
	g(["config", "core.autocrlf", "false"]);
	mkdirSync(join(root, "docs"), { recursive: true });
	writeFileSync(join(root, "docs", "a.md"), "---\ntitle: A\n---\n# body\n");
	g(["add", "-A"]);
	g(["commit", "-q", "-m", "seed"]);
	if (origin !== undefined) g(["remote", "add", "origin", origin]);
	return root;
}

/** A branch with one commit beyond the seed; returns the branch tip sha. */
function branchWithCommit(root: string, name: string): string {
	const g = (args: string[]) => execFileSync("git", args, { cwd: root });
	g(["branch", name]);
	g(["checkout", "-q", name]);
	writeFileSync(join(root, "docs", "a.md"), "---\ntitle: A\n---\n# more\n");
	g(["add", "-A"]);
	g(["commit", "-q", "-m", "more"]);
	g(["checkout", "-q", "main"]);
	return g(["rev-parse", name]).toString().trim();
}

/** Every PR field the routes consume. */
function pr(
	n: number,
	head: string,
	over: Partial<PullRequest> = {},
): PullRequest {
	return {
		number: n,
		title: `PR ${n}`,
		state: "open",
		draft: false,
		mergeable: true,
		html_url: `https://github.com/o/r/pull/${n}`,
		head: { ref: head, sha: "f".repeat(40) },
		base: { ref: "main" },
		user: { login: "ada" },
		changed_files: 2,
		...over,
	};
}

/** The stubbed REST answers plus the call/git-seam recorder. */
function prApp(
	root: string,
	script: {
		pulls?: PullRequest[];
		pull?: PullRequest;
		create?: { status: number; body?: unknown };
		merge?: { status: number; body?: unknown };
		defaultBranch?: string;
		files?: unknown[];
		fetchThrows?: boolean;
	} = {},
	users: Record<string, string> = { ada: "write" },
) {
	const calls: string[] = [];
	const posted: unknown[] = [];
	const stubFetch: typeof globalThis.fetch = async (input, init) => {
		const url =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.toString()
					: input.url;
		const method = init?.method ?? "GET";
		const headers = (init?.headers ?? {}) as Record<string, string>;
		if (url === "https://github.com/login/oauth/access_token") {
			const body = JSON.parse(String(init?.body)) as { code: string };
			return Response.json({ access_token: `tok-${body.code}` });
		}
		if (url === "https://api.github.com/user") {
			const login = (headers.authorization ?? "").slice("Bearer tok-".length);
			return Response.json({ id: 1, login });
		}
		if (url === "https://api.github.com/user/emails")
			return new Response(null, { status: 500 }); // swallowed by the auth flow
		const collab = /\/collaborators\/([^/]+)\/permission$/.exec(url);
		if (collab) {
			const perm = users[decodeURIComponent(collab[1])];
			return perm
				? Response.json({ permission: perm })
				: new Response(null, { status: 404 });
		}
		if (url === "https://api.github.com/repos/o/r") {
			calls.push("GET repo");
			return Response.json({ default_branch: script.defaultBranch ?? "main" });
		}
		if (url === "https://api.github.com/repos/o/r/pulls?state=open") {
			calls.push("GET pulls");
			return Response.json(script.pulls ?? []);
		}
		if (url === "https://api.github.com/repos/o/r/pulls" && method === "POST") {
			calls.push("POST pulls");
			posted.push(JSON.parse(String(init?.body)));
			const s = script.create ?? { status: 201, body: pr(7, "feature") };
			return Response.json(s.body ?? {}, { status: s.status });
		}
		const files =
			/^https:\/\/api\.github\.com\/repos\/o\/r\/pulls\/(\d+)\/files\?(.*)$/.exec(
				url,
			);
		if (files) {
			calls.push(`GET files ${files[2]}`);
			return Response.json(
				script.files ?? [
					{
						filename: "docs/a.md",
						status: "modified",
						additions: 1,
						deletions: 1,
						patch: "@@ -3 +3 @@\n-title: A\n+title: B",
					},
				],
			);
		}
		if (
			/^https:\/\/api\.github\.com\/repos\/o\/r\/pulls\/\d+\/merge$/.test(url)
		) {
			calls.push("PUT merge");
			const s = script.merge ?? { status: 200, body: { merged: true } };
			return Response.json(s.body ?? {}, { status: s.status });
		}
		if (/^https:\/\/api\.github\.com\/repos\/o\/r\/pulls\/\d+$/.test(url)) {
			calls.push("GET pull");
			return Response.json(script.pull ?? pr(5, "feature"));
		}
		return new Response(null, { status: 404 });
	};
	const app = createApp({
		repoRoot: root,
		docsRoot: "docs",
		auth: { clientId: "cid", clientSecret: "secret" },
		githubFetch: stubFetch,
		gitPush: async () => {
			calls.push("git push");
		},
		gitFetch: async () => {
			if (script.fetchThrows)
				throw new Error("refusing to fetch into branch currently checked out");
			calls.push("git fetch");
		},
	});
	return { app, calls, posted };
}

/** First `name=value` pair of a Set-Cookie header for the cookie. */
function cookieFrom(res: Response, name: string): string | undefined {
	return res.headers
		.getSetCookie()
		.find((c) => c.startsWith(`${name}=`))
		?.split(";")[0];
}

/** Drive the OAuth flow in-process; returns the session cookie pair. */
async function signIn(
	app: ReturnType<typeof createApp>,
	login: string,
): Promise<string> {
	const loginRes = await app.request("/api/auth/login");
	const state = new URL(
		loginRes.headers.get("location") ?? "",
	).searchParams.get("state");
	const cb = await app.request(
		`/api/auth/callback?code=${login}&state=${state}`,
		{
			headers: { cookie: cookieFrom(loginRes, "fragmt_oauth_state") ?? "" },
		},
	);
	expect(cb.status).toBe(302);
	return cookieFrom(cb, "fragmt_session") ?? "";
}

function post(
	app: ReturnType<typeof createApp>,
	path: string,
	body: unknown,
	cookie: string,
): Promise<Response> | Response {
	return app.request(path, {
		method: "POST",
		headers: { "content-type": "application/json", cookie },
		body: JSON.stringify(body),
	});
}

test("auth off: /api/prs answers the disabled shape and a create refuses", async () => {
	const app = createApp({
		repoRoot: gitRepo("https://github.com/o/r.git"),
		docsRoot: "docs",
	});
	const res = await app.request("/api/prs");
	expect(res.status).toBe(200);
	expect(await res.json()).toEqual({ enabled: false, prs: [] });
	const create = await app.request("/api/prs", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ branch: "main" }),
	});
	expect(create.status).toBe(400);
	expect(((await create.json()) as { error: string }).error).toBe(
		"prs are available only with serve --auth",
	);
});

test("non-github origin: enabled but slug null, and no PR rest calls", async () => {
	const { app, calls } = prApp(gitRepo(), {}); // no origin remote
	const session = await signIn(app, "ada");
	const res = await app.request("/api/prs", { headers: { cookie: session } });
	expect(res.status).toBe(200);
	expect(await res.json()).toEqual({
		enabled: true,
		slug: null,
		prs: [],
		byBranch: {},
	});
	expect(calls).toEqual([]);
});

test("list: minimal pr fields and the byBranch fold", async () => {
	const { app } = prApp(gitRepo("https://github.com/o/r.git"), {
		pulls: [pr(1, "drafts/x"), pr(2, "feature", { draft: true })],
	});
	const session = await signIn(app, "ada");
	const res = await app.request("/api/prs", { headers: { cookie: session } });
	expect(res.status).toBe(200);
	const body = (await res.json()) as {
		slug: unknown;
		prs: unknown[];
		byBranch: Record<string, unknown>;
	};
	expect(body.slug).toEqual({ owner: "o", repo: "r" });
	expect(body.prs[0]).toEqual({
		number: 1,
		title: "PR 1",
		state: "open",
		draft: false,
		mergeable: true,
		html_url: "https://github.com/o/r/pull/1",
		head: { ref: "drafts/x", sha: "f".repeat(40) },
		base: { ref: "main" },
		user: { login: "ada" },
		changed_files: 2,
	});
	expect(body.byBranch).toEqual({
		"drafts/x": { number: 1, title: "PR 1", state: "open" },
		feature: { number: 2, title: "PR 2", state: "open" },
	});
});

test("create: push runs before the pulls POST; title equals the branch", async () => {
	const root = gitRepo("https://github.com/o/r.git");
	execFileSync("git", ["branch", "feature"], { cwd: root });
	const { app, calls, posted } = prApp(root, {
		create: { status: 201, body: pr(7, "feature") },
	});
	const session = await signIn(app, "ada");
	const missing = await post(app, "/api/prs", { branch: "nope" }, session);
	expect(missing.status).toBe(404);
	expect(((await missing.json()) as { error: string }).error).toBe(
		"branch not found",
	);
	const res = await post(
		app,
		"/api/prs",
		{ branch: "feature", body: "please review" },
		session,
	);
	expect(res.status).toBe(201);
	expect(((await res.json()) as { number: number }).number).toBe(7);
	expect(calls).toEqual(["GET repo", "git push", "POST pulls"]);
	expect(posted).toEqual([
		{ title: "feature", head: "feature", base: "main", body: "please review" },
	]);
});

test("create: a 422 duplicate answers the already-open PR, 200", async () => {
	const root = gitRepo("https://github.com/o/r.git");
	execFileSync("git", ["branch", "feature"], { cwd: root });
	const { app, calls } = prApp(root, {
		create: { status: 422, body: { message: "Validation Failed" } },
		pulls: [pr(9, "feature")],
	});
	const session = await signIn(app, "ada");
	const res = await post(app, "/api/prs", { branch: "feature" }, session);
	expect(res.status).toBe(200);
	expect(((await res.json()) as { number: number }).number).toBe(9);
	expect(calls).toEqual(["GET repo", "git push", "POST pulls", "GET pulls"]);
});

test("detail: one 20-file page, per_page and page passed through", async () => {
	const { app, calls } = prApp(gitRepo("https://github.com/o/r.git"), {
		pull: pr(5, "feature", { mergeable: false }),
	});
	const session = await signIn(app, "ada");
	const res = await app.request("/api/prs/5?files_page=3", {
		headers: { cookie: session },
	});
	expect(res.status).toBe(200);
	const body = (await res.json()) as {
		pr: { mergeable: boolean };
		files: { filename: string }[];
		filesPage: number;
	};
	expect(body.pr.mergeable).toBe(false);
	expect(body.filesPage).toBe(3);
	expect(body.files).toEqual([
		{
			filename: "docs/a.md",
			status: "modified",
			additions: 1,
			deletions: 1,
			patch: "@@ -3 +3 @@\n-title: A\n+title: B",
		},
	]);
	expect(calls).toContain("GET files per_page=20&page=3");
	const first = await app.request("/api/prs/5", {
		headers: { cookie: session },
	});
	expect(((await first.json()) as { filesPage: number }).filesPage).toBe(1);
	expect(calls).toContain("GET files per_page=20&page=1");
});

test("push: the pr head equals the local tip → pushed:false, no push", async () => {
	const root = gitRepo("https://github.com/o/r.git");
	const sha = branchWithCommit(root, "feature");
	const { app, calls } = prApp(root, {
		pull: pr(5, "feature", { head: { ref: "feature", sha } }),
	});
	const session = await signIn(app, "ada");
	const res = await post(
		app,
		"/api/prs/5/push",
		{ branch: "feature" },
		session,
	);
	expect(res.status).toBe(200);
	expect(await res.json()).toEqual({ pushed: false });
	expect(calls).not.toContain("git push");
});

test("push: local ahead of the pr head → pushAs runs, pushed:true", async () => {
	const root = gitRepo("https://github.com/o/r.git");
	branchWithCommit(root, "feature");
	const seed = execFileSync("git", ["rev-parse", "main"], {
		cwd: root,
	})
		.toString()
		.trim();
	const { app, calls } = prApp(root, {
		pull: pr(5, "feature", { head: { ref: "feature", sha: seed } }),
	});
	const session = await signIn(app, "ada");
	const res = await post(
		app,
		"/api/prs/5/push",
		{ branch: "feature" },
		session,
	);
	expect(res.status).toBe(200);
	expect(await res.json()).toEqual({ pushed: true });
	expect(calls).toEqual(["GET pull", "git push"]);
});

test("merge: merged:true records the local-main fast-forward", async () => {
	const root = gitRepo("https://github.com/o/r.git");
	const { app, calls } = prApp(root, {});
	const session = await signIn(app, "ada");
	const res = await post(app, "/api/prs/5/merge", {}, session);
	expect(res.status).toBe(200);
	expect(await res.json()).toEqual({ merged: true });
	expect(calls).toEqual(["GET pull", "PUT merge", "git fetch"]);
});

test("merge: a fetch refusal is swallowed – the merge answer stands", async () => {
	const root = gitRepo("https://github.com/o/r.git");
	const { app, calls } = prApp(root, { fetchThrows: true });
	const session = await signIn(app, "ada");
	const res = await post(app, "/api/prs/5/merge", {}, session);
	expect(res.status).toBe(200);
	expect(await res.json()).toEqual({ merged: true });
	expect(calls).toEqual(["GET pull", "PUT merge"]);
});

test("merge: a 405 answers the conflicted shape with the PR's url", async () => {
	const root = gitRepo("https://github.com/o/r.git");
	const { app, calls } = prApp(root, {
		merge: { status: 405, body: { message: "Pull Request is not mergeable" } },
	});
	const session = await signIn(app, "ada");
	const res = await post(app, "/api/prs/5/merge", {}, session);
	expect(res.status).toBe(200);
	expect(await res.json()).toEqual({
		conflicted: true,
		html_url: "https://github.com/o/r/pull/5",
	});
	expect(calls).toEqual(["GET pull", "PUT merge"]);
});

test("a read-only session cannot create a PR – the gate 403s", async () => {
	const root = gitRepo("https://github.com/o/r.git");
	const { app } = prApp(root, {}, { bob: "read" });
	const session = await signIn(app, "bob");
	const res = await post(app, "/api/prs", { branch: "main" }, session);
	expect(res.status).toBe(403);
	expect(((await res.json()) as { error: string }).error).toBe(
		"read-only access – you don't have write permission",
	);
});
