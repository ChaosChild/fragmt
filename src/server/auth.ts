import { timingSafeEqual } from "node:crypto";
import type { Context, Hono } from "hono";
import {
	deleteCookie,
	getCookie,
	getSignedCookie,
	setCookie,
	setSignedCookie,
} from "hono/cookie";
import { type GithubSlug, githubSlug } from "../core/index.js";

/**
 * #20 batch 2: serve --auth. GitHub OAuth web flow (authorization-code) plus
 * the /api/* gate. Plain serve never registers any of this – zero behavior
 * change. The permission model is the GitHub collaborator model, evaluated
 * with the SIGNED-IN USER's token (never the app's), cached in memory per
 * login for ~5 minutes – that TTL is the documented ceiling on how stale a
 * permission change may read.
 */

/** The resolved --auth contract: the GitHub OAuth app credentials. */
export interface AuthConfig {
	clientId: string;
	clientSecret: string;
}

/** The signed-in identity. The token lives server-side only – never sent to
 *  the client, never logged, never persisted. */
export interface AuthUser {
	login: string;
	id: number;
	token: string;
}

/** Hono variables the gate attaches to every authorized request. */
export interface AppEnv {
	Variables: {
		authUser: AuthUser;
		canWrite: boolean;
	};
}

const SESSION_COOKIE = "fragmt_session";
const STATE_COOKIE = "fragmt_oauth_state";

// ponytail: in-memory sessions with a 7-day absolute TTL – a server restart
// signs everyone out; a file-backed store is the upgrade when that bites.
const SESSION_TTL_SEC = 7 * 24 * 60 * 60;
// The documented ceiling: a GitHub-side permission change takes up to this
// long to land for a signed-in user.
const PERM_TTL_MS = 5 * 60 * 1000;
const STATE_TTL_SEC = 10 * 60;

/** admin/maintain/write ⇒ may write; read/triage ⇒ GET-only; none ⇒ nothing. */
type Perm = "write" | "read" | "none";

interface Session {
	user: AuthUser;
	expiresAt: number;
}

/** registerAuth adds the gate, the OAuth routes, and GET /api/auth/session. */
export function registerAuth(
	app: Hono<AppEnv>,
	opts: {
		repoRoot: string;
		auth: AuthConfig;
		/** Injectable GitHub fetch – tests stub the OAuth + collaborator calls. */
		githubFetch?: typeof fetch;
	},
): void {
	const ghFetch = opts.githubFetch ?? globalThis.fetch;
	const sessions = new Map<string, Session>();
	const perms = new Map<
		string,
		{ perm: Perm; failClosed: boolean; expiresAt: number }
	>();
	// ponytail: the slug is resolved once per process – an origin change needs
	// a restart. undefined (re)assigned exactly once.
	let slug: GithubSlug | undefined;
	let slugResolved = false;

	async function resolveSlug(): Promise<GithubSlug | undefined> {
		if (!slugResolved) {
			slug = await githubSlug(opts.repoRoot);
			slugResolved = true;
		}
		return slug;
	}

	function sessionOf(c: Context<AppEnv>): Session | undefined {
		const id = getCookie(c, SESSION_COOKIE);
		if (id === undefined) return undefined;
		const session = sessions.get(id);
		if (session === undefined) return undefined;
		if (session.expiresAt <= Date.now()) {
			sessions.delete(id);
			return undefined;
		}
		return session;
	}

	/**
	 * The collaborator check with the user's own token: admin/maintain/write →
	 * write; read/triage → read-only; none or any GitHub error → nothing.
	 * `failClosed` marks the no-slug case (origin not github.com): reads stay
	 * open, mutations refuse with the operator-facing message.
	 */
	async function permissionOf(
		user: AuthUser,
	): Promise<{ perm: Perm; failClosed: boolean }> {
		const hit = perms.get(user.login);
		if (hit && hit.expiresAt > Date.now()) return hit;
		let perm: Perm = "none";
		let failClosed = false;
		const s = await resolveSlug();
		if (s === undefined) {
			failClosed = true;
		} else {
			try {
				const res = await ghFetch(
					`https://api.github.com/repos/${s.owner}/${s.repo}/collaborators/${encodeURIComponent(user.login)}/permission`,
					{
						headers: {
							authorization: `Bearer ${user.token}`,
							accept: "application/vnd.github+json",
							"x-github-api-version": "2022-11-28",
						},
					},
				);
				if (res.ok) {
					const body = (await res.json()) as { permission?: unknown };
					if (
						body.permission === "admin" ||
						body.permission === "maintain" ||
						body.permission === "write"
					)
						perm = "write";
					else if (body.permission === "read" || body.permission === "triage")
						perm = "read";
				}
			} catch {
				perm = "none"; // GitHub unreachable denies rather than opens
			}
		}
		const out = { perm, failClosed, expiresAt: Date.now() + PERM_TTL_MS };
		perms.set(user.login, out);
		return out;
	}

	// The gate: all of /api/* needs a session, except /api/auth/* itself.
	// Registered before every other middleware and route in createApp.
	app.use("/api/*", async (c, next) => {
		if (c.req.path.startsWith("/api/auth/")) return next();
		const session = sessionOf(c);
		if (session === undefined) return c.json({ error: "sign in" }, 401);
		const { perm, failClosed } = await permissionOf(session.user);
		c.set("authUser", session.user);
		c.set("canWrite", perm === "write");
		if (perm === "write") return next();
		const reading = c.req.method === "GET" || c.req.method === "HEAD";
		if (reading && (failClosed || perm === "read")) return next();
		if (failClosed)
			return c.json(
				{
					error:
						"this repo's origin is not github.com – collaborator checks unavailable",
				},
				403,
			);
		return c.json(
			{
				error:
					perm === "read"
						? "read-only access – you don't have write permission"
						: "not a collaborator on this repo",
			},
			403,
		);
	});

	// GitHub OAuth web flow. The state rides a short-lived signed cookie as the
	// server-side store; the browser only ever sees opaque values.
	app.get("/api/auth/login", async (c) => {
		const state = crypto.randomUUID();
		await setSignedCookie(c, STATE_COOKIE, state, opts.auth.clientSecret, {
			httpOnly: true,
			sameSite: "Lax",
			path: "/",
			maxAge: STATE_TTL_SEC,
		});
		const authorize = new URL("https://github.com/login/oauth/authorize");
		authorize.searchParams.set("client_id", opts.auth.clientId);
		authorize.searchParams.set(
			"redirect_uri",
			`${new URL(c.req.url).origin}/api/auth/callback`,
		);
		authorize.searchParams.set("state", state);
		// scope=repo: classic OAuth apps have no read-only scope, and the
		// collaborator check must read PRIVATE repo metadata (docs repos usually
		// are) – a scopeless token would fail-closed every private repo. The PR
		// wiring round (#27) needs write anyway. The token rides the in-memory
		// session only (never persisted, never client-visible).
		authorize.searchParams.set("scope", "repo");
		return c.redirect(authorize.toString(), 302);
	});

	app.get("/api/auth/callback", async (c) => {
		const expected = await getSignedCookie(
			c,
			opts.auth.clientSecret,
			STATE_COOKIE,
		);
		const state = c.req.query("state") ?? "";
		deleteCookie(c, STATE_COOKIE, { path: "/" });
		if (typeof expected !== "string" || !state || !statesMatch(state, expected))
			return c.json({ error: "invalid oauth state" }, 400);
		const code = c.req.query("code");
		if (!code) return c.json({ error: "missing code" }, 400);

		const tokenRes = await ghFetch(
			"https://github.com/login/oauth/access_token",
			{
				method: "POST",
				headers: {
					"content-type": "application/json",
					accept: "application/json",
				},
				body: JSON.stringify({
					client_id: opts.auth.clientId,
					client_secret: opts.auth.clientSecret,
					code,
					redirect_uri: `${new URL(c.req.url).origin}/api/auth/callback`,
				}),
			},
		);
		const tokenBody = tokenRes.ok
			? ((await tokenRes.json()) as { access_token?: unknown })
			: {};
		if (typeof tokenBody.access_token !== "string" || !tokenBody.access_token)
			return c.json({ error: "github rejected the sign-in" }, 502);
		const token = tokenBody.access_token;

		const userRes = await ghFetch("https://api.github.com/user", {
			headers: {
				authorization: `Bearer ${token}`,
				accept: "application/vnd.github+json",
			},
		});
		const gh = userRes.ok
			? ((await userRes.json()) as { id?: unknown; login?: unknown })
			: {};
		if (typeof gh.id !== "number" || typeof gh.login !== "string" || !gh.login)
			return c.json({ error: "github rejected the sign-in" }, 502);

		const id = crypto.randomUUID();
		sessions.set(id, {
			user: { login: gh.login, id: gh.id, token },
			expiresAt: Date.now() + SESSION_TTL_SEC * 1000,
		});
		// Secure is deliberately NOT set: serve --auth runs on plain http on the
		// LAN and behind reverse proxies that terminate TLS (HOSTING doc); set it
		// when serving https directly instead.
		setCookie(c, SESSION_COOKIE, id, {
			httpOnly: true,
			sameSite: "Lax",
			path: "/",
			maxAge: SESSION_TTL_SEC,
		});
		return c.redirect("/", 302);
	});

	// Public (the gate skips /api/auth/*) so the UI can boot signed out.
	app.get("/api/auth/session", async (c) => {
		const session = sessionOf(c);
		if (session === undefined)
			return c.json({ enabled: true, user: null, canWrite: false });
		const { perm } = await permissionOf(session.user);
		return c.json({
			enabled: true,
			user: { login: session.user.login },
			canWrite: perm === "write",
		});
	});

	app.post("/api/auth/logout", (c) => {
		const id = getCookie(c, SESSION_COOKIE);
		if (id !== undefined) sessions.delete(id);
		deleteCookie(c, SESSION_COOKIE, { path: "/" });
		return c.body(null, 204);
	});
}

/** Auth off: the boot answer the UI gets instead of the gate's session route. */
export function sessionDisabled(c: Context<AppEnv>): Response {
	return c.json({ enabled: false, user: null, canWrite: true });
}

/**
 * The signed-in user as the commit AUTHOR ({login}, GitHub's noreply email);
 * undefined when auth is off, so the core falls back to the repo's git
 * identity (committer stays the machine identity either way).
 */
export function commitAuthor(
	c: Context<AppEnv>,
): { name: string; email: string } | undefined {
	const u = c.get("authUser");
	return u === undefined
		? undefined
		: { name: u.login, email: `${u.id}+${u.login}@users.noreply.github.com` };
}

/** Fixed-input comparison through a hash – no length leak, no timing leak. */
function statesMatch(given: string, expected: string): boolean {
	const a = new TextEncoder().encode(given);
	const b = new TextEncoder().encode(expected);
	return a.length === b.length && timingSafeEqual(a, b);
}
