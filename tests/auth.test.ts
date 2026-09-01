// #20 UI batch: the auth gate's pure decision (authView) and the 401
// discrimination its expiry seam relies on – request() and the raw-fetch
// writers ping the onAuthError listener and throw AuthError on a 401;
// non-401 errors stay plain and never ping. Server contract: 401
// {error:"sign in"} without a session, 403 {error:"..."} signed in without
// permission. React components are not mountable in this suite (the root
// tsconfig has no jsx option and no test mounts React) – so AuthGate's
// rendering is exercised through this pure split, the repo's established
// shape.
import { afterEach, describe, expect, test, vi } from "vitest";
import {
	AuthError,
	type AuthSession,
	authView,
	getBranches,
	getMeta,
	logout,
	SaveError,
	saveDoc,
	setOnAuthError,
} from "../ui/src/api.js";

afterEach(() => {
	vi.unstubAllGlobals();
	setOnAuthError(null);
});

/** The sessions the gate decides on (the server contract's shapes). */
const OFF: AuthSession = { enabled: false, user: null, canWrite: true };
const SIGNED_OUT: AuthSession = { enabled: true, user: null, canWrite: true };
const WRITER: AuthSession = {
	enabled: true,
	user: { login: "octocat" },
	canWrite: true,
};
const READER: AuthSession = {
	enabled: true,
	user: { login: "octocat" },
	canWrite: false,
};

describe("authView", () => {
	test("auth off is off – the local mode renders children verbatim", () => {
		expect(authView(OFF)).toBe("off");
	});

	test("enabled with no user is the sign-in card", () => {
		expect(authView(SIGNED_OUT)).toBe("signin");
	});

	test("enabled with a user is the app – canWrite never changes the view", () => {
		expect(authView(WRITER)).toBe("app");
		expect(authView(READER)).toBe("app");
	});
});

describe("401 discrimination", () => {
	test("a 401 throws AuthError with the server's message and pings the listener", async () => {
		let pings = 0;
		setOnAuthError(() => {
			pings += 1;
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json({ error: "sign in" }, { status: 401 })),
		);
		const err = await getMeta().then(
			() => null,
			(e) => e,
		);
		expect(err).toBeInstanceOf(AuthError);
		expect((err as Error).message).toBe("sign in");
		expect(pings).toBe(1);
	});

	test("a 403 stays a plain Error and never pings – the gate must not flip", async () => {
		let pings = 0;
		setOnAuthError(() => {
			pings += 1;
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				Response.json(
					{ error: "read-only access – you don't have write permission" },
					{ status: 403 },
				),
			),
		);
		const err = await getMeta().then(
			() => null,
			(e) => e,
		);
		expect(err).toBeInstanceOf(Error);
		expect(err).not.toBeInstanceOf(AuthError);
		expect((err as Error).message).toBe(
			"read-only access – you don't have write permission",
		);
		expect(pings).toBe(0);
	});

	test("a success returns the payload and never pings", async () => {
		let pings = 0;
		setOnAuthError(() => {
			pings += 1;
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json({ current: "main", branches: ["main"] })),
		);
		await expect(getBranches()).resolves.toEqual({
			current: "main",
			branches: ["main"],
		});
		expect(pings).toBe(0);
	});

	test("the raw-fetch writers ping the seam too – saveDoc keeps its SaveError contract", async () => {
		let pings = 0;
		setOnAuthError(() => {
			pings += 1;
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json({ error: "sign in" }, { status: 401 })),
		);
		const err = await saveDoc("a.md", "body", "hash").then(
			() => null,
			(e) => e,
		);
		expect(err).toBeInstanceOf(SaveError);
		expect(err).not.toBeInstanceOf(AuthError);
		expect((err as Error).message).toBe("sign in");
		expect(pings).toBe(1);
	});

	test("logout POSTs to /api/auth/logout and reads nothing (204)", async () => {
		const f = vi.fn(async () => new Response(null, { status: 204 }));
		vi.stubGlobal("fetch", f);
		await expect(logout()).resolves.toBeUndefined();
		expect(f).toHaveBeenCalledWith("/api/auth/logout", { method: "POST" });
	});
});
