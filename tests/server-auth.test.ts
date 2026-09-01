import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { createApp } from "../src/server/index.js";

// #20 batch 2: serve --auth. GitHub OAuth web flow (login/callback/session/
// logout) plus the /api/* gate backed by the collaborator permission model.
// githubFetch is stubbed – no network; the code IS the login in the stub
// exchange, so tests sign in as a specific login directly.

interface StubUser {
	id: number;
	permission: string;
}

const repos: string[] = [];

afterEach(() => {
	for (const r of repos.splice(0)) rmSync(r, { recursive: true, force: true });
});

/** Throwaway repo with a local identity (server-write.test.ts pattern). */
function gitRepo(origin?: string): string {
	const root = mkdtempSync(join(tmpdir(), "fragmt-auth-"));
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

/** Stub for the three GitHub calls the auth flow makes. */
function stubGithub(users: Record<string, StubUser>): {
	fetch: typeof fetch;
	permissionCalls: () => number;
} {
	let permissionCalls = 0;
	const stubFetch: typeof globalThis.fetch = async (input, init) => {
		const url =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.toString()
					: input.url;
		const headers = (init?.headers ?? {}) as Record<string, string>;
		if (url === "https://github.com/login/oauth/access_token") {
			const body = JSON.parse(String(init?.body)) as { code: string };
			return Response.json({ access_token: `tok-${body.code}` });
		}
		if (url === "https://api.github.com/user") {
			const login = (headers.authorization ?? "").slice("Bearer tok-".length);
			const u = users[login];
			return u
				? Response.json({ id: u.id, login })
				: new Response(null, { status: 401 });
		}
		const m = /\/collaborators\/([^/]+)\/permission$/.exec(url);
		if (m) {
			permissionCalls++;
			const u = users[decodeURIComponent(m[1])];
			return u
				? Response.json({ permission: u.permission })
				: new Response(null, { status: 404 });
		}
		return new Response(null, { status: 404 });
	};
	return { fetch: stubFetch, permissionCalls: () => permissionCalls };
}

function authApp(root: string, users: Record<string, StubUser>) {
	const stub = stubGithub(users);
	const app = createApp({
		repoRoot: root,
		docsRoot: "docs",
		auth: { clientId: "cid", clientSecret: "secret" },
		githubFetch: stub.fetch,
	});
	return { app, stub };
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
	const stateCookie = cookieFrom(loginRes, "fragmt_oauth_state");
	const cb = await app.request(
		`/api/auth/callback?code=${login}&state=${state}`,
		{
			headers: { cookie: stateCookie ?? "" },
		},
	);
	expect(cb.status).toBe(302);
	return cookieFrom(cb, "fragmt_session") ?? "";
}

function getDoc(app: ReturnType<typeof createApp>, cookie?: string) {
	return app.request("/api/docs/a.md", {
		headers: cookie ? { cookie } : {},
	});
}

function putDoc(
	app: ReturnType<typeof createApp>,
	baseHash: string,
	cookie?: string,
) {
	return app.request("/api/docs/a.md", {
		method: "PUT",
		headers: {
			"content-type": "application/json",
			...(cookie ? { cookie } : {}),
		},
		body: JSON.stringify({ markdown: "# edited\n", baseHash }),
	});
}

test("auth off: the gate is inert – an unauthenticated mutation still works", async () => {
	const app = createApp({
		repoRoot: gitRepo("https://github.com/o/r.git"),
		docsRoot: "docs",
	});
	const doc = (await (await getDoc(app)).json()) as { hash: string };
	const res = await putDoc(app, doc.hash);
	expect(res.status).toBe(200);
});

test("auth off: /api/auth/session answers the disabled boot shape", async () => {
	const app = createApp({ repoRoot: gitRepo(), docsRoot: "docs" });
	const res = await app.request("/api/auth/session");
	expect(res.status).toBe(200);
	expect(await res.json()).toEqual({
		enabled: false,
		user: null,
		canWrite: true,
	});
});

test("auth on: unauthenticated GET /api/meta is 401", async () => {
	const { app } = authApp(gitRepo("https://github.com/o/r.git"), {
		ada: { id: 1, permission: "write" },
	});
	const res = await app.request("/api/meta");
	expect(res.status).toBe(401);
	expect(await res.json()).toEqual({ error: "sign in" });
});

test("auth on: signed-out /api/auth/session is the public boot answer", async () => {
	const { app } = authApp(gitRepo("https://github.com/o/r.git"), {
		ada: { id: 1, permission: "write" },
	});
	const res = await app.request("/api/auth/session");
	expect(res.status).toBe(200);
	expect(await res.json()).toEqual({
		enabled: true,
		user: null,
		canWrite: false,
	});
});

test("login redirects to GitHub's authorize URL with a signed state cookie", async () => {
	const { app } = authApp(gitRepo("https://github.com/o/r.git"), {});
	const res = await app.request("/api/auth/login");
	expect(res.status).toBe(302);
	const location = new URL(res.headers.get("location") ?? "/");
	expect(location.origin + location.pathname).toBe(
		"https://github.com/login/oauth/authorize",
	);
	expect(location.searchParams.get("client_id")).toBe("cid");
	expect(location.searchParams.get("scope")).toBe("repo");
	expect(location.searchParams.get("redirect_uri")).toBe(
		"http://localhost/api/auth/callback",
	);
	expect(location.searchParams.get("state")).toBeTruthy();
	const stateCookie = res.headers
		.getSetCookie()
		.find((c) => c.startsWith("fragmt_oauth_state="));
	expect(stateCookie).toContain("HttpOnly");
	expect(stateCookie).toContain("SameSite=Lax");
});

test("callback with a mismatched state is 400 and clears the state cookie", async () => {
	const { app } = authApp(gitRepo("https://github.com/o/r.git"), {});
	const loginRes = await app.request("/api/auth/login");
	const stateCookie = cookieFrom(loginRes, "fragmt_oauth_state");
	const res = await app.request("/api/auth/callback?code=ada&state=bogus", {
		headers: { cookie: stateCookie ?? "" },
	});
	expect(res.status).toBe(400);
	expect(
		res.headers.getSetCookie().some((c) => c.startsWith("fragmt_oauth_state=")),
	).toBe(true);
});

test("callback with the matching state signs in and lands on /", async () => {
	const root = gitRepo("https://github.com/o/r.git");
	const { app } = authApp(root, { ada: { id: 1, permission: "write" } });
	const session = await signIn(app, "ada");
	expect(session).toMatch(/^fragmt_session=/);
	const meta = await app.request("/api/meta", { headers: { cookie: session } });
	expect(meta.status).toBe(200);
});

test("a write collaborator's mutation commits under their login", async () => {
	const root = gitRepo("https://github.com/o/r.git");
	const { app } = authApp(root, { ada: { id: 1, permission: "write" } });
	const session = await signIn(app, "ada");
	const doc = (await (await getDoc(app, session)).json()) as { hash: string };
	const res = await putDoc(app, doc.hash, session);
	expect(res.status).toBe(200);
	const fields = execFileSync(
		"git",
		["log", "-1", "--format=%an|%ae|%cn|%ce"],
		{
			cwd: root,
			encoding: "utf8",
		},
	).trim();
	// Author is the signed-in GitHub user (noreply form); committer stays local.
	expect(fields).toBe(
		"ada|1+ada@users.noreply.github.com|Local User|local@example.com",
	);
});

test("a read-only collaborator can read but not mutate", async () => {
	const { app } = authApp(gitRepo("https://github.com/o/r.git"), {
		bob: { id: 2, permission: "read" },
	});
	const session = await signIn(app, "bob");
	const get = await getDoc(app, session);
	expect(get.status).toBe(200);
	const put = await putDoc(app, "0".repeat(64), session);
	expect(put.status).toBe(403);
	expect(await put.json()).toEqual({
		error: "read-only access – you don't have write permission",
	});
});

test("a non-collaborator is 403 even on GET", async () => {
	const { app } = authApp(gitRepo("https://github.com/o/r.git"), {
		eve: { id: 3, permission: "none" },
	});
	const session = await signIn(app, "eve");
	const res = await getDoc(app, session);
	expect(res.status).toBe(403);
	expect(((await res.json()) as { error: string }).error).toBe(
		"not a collaborator on this repo",
	);
});

test("the permission check is cached: two mutations, one collaborators call", async () => {
	const { app, stub } = authApp(gitRepo("https://github.com/o/r.git"), {
		ada: { id: 1, permission: "write" },
	});
	const session = await signIn(app, "ada");
	const first = (await (await getDoc(app, session)).json()) as { hash: string };
	expect((await putDoc(app, first.hash, session)).status).toBe(200);
	const second = (await (await getDoc(app, session)).json()) as {
		hash: string;
	};
	expect((await putDoc(app, second.hash, session)).status).toBe(200);
	expect(stub.permissionCalls()).toBe(1);
});

test("no github origin: mutations fail closed, reads stay open", async () => {
	const root = gitRepo(); // no origin remote
	const { app } = authApp(root, { ada: { id: 1, permission: "write" } });
	const session = await signIn(app, "ada");
	const get = await getDoc(app, session);
	expect(get.status).toBe(200);
	const put = await putDoc(app, "0".repeat(64), session);
	expect(put.status).toBe(403);
	expect(((await put.json()) as { error: string }).error).toBe(
		"this repo's origin is not github.com – collaborator checks unavailable",
	);
});

test("logout destroys the session", async () => {
	const { app } = authApp(gitRepo("https://github.com/o/r.git"), {
		ada: { id: 1, permission: "write" },
	});
	const session = await signIn(app, "ada");
	const out = await app.request("/api/auth/logout", {
		method: "POST",
		headers: { cookie: session },
	});
	expect(out.status).toBe(204);
	const after = await app.request("/api/meta", {
		headers: { cookie: session },
	});
	expect(after.status).toBe(401);
});
