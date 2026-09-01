import { expect, test } from "vitest";
import { resolveServeAuth } from "../src/cli/index.js";

// #20 batch 1: `serve`'s startup contract, resolved before anything binds.
// Plain serve is loopback-only and unchanged (port 0 stays ephemeral);
// --auth demands a repeatable port and both GitHub OAuth credentials, and
// binds all interfaces.

const BOTH = { GH_CLIENT_ID: "id", GH_CLIENT_SECRET: "secret" };

test("plain serve: loopback, port 0 stays ephemeral", () => {
	expect(resolveServeAuth({ auth: false, port: 0 }, {})).toEqual({
		auth: false,
		host: "127.0.0.1",
		port: 0,
	});
});

test("plain serve: explicit port, still loopback, env irrelevant", () => {
	expect(resolveServeAuth({ auth: false, port: 4400 }, {})).toEqual({
		auth: false,
		host: "127.0.0.1",
		port: 4400,
	});
});

test("--auth without --port is refused with the operator line", () => {
	expect(() => resolveServeAuth({ auth: true, port: 0 }, BOTH)).toThrow(
		"--auth requires --port <n> – the OAuth callback needs a repeatable port",
	);
});

test("--auth with a port but missing credentials names the variable(s)", () => {
	expect(() => resolveServeAuth({ auth: true, port: 4400 }, {})).toThrow(
		"--auth requires GH_CLIENT_ID and GH_CLIENT_SECRET in the environment",
	);
	expect(() =>
		resolveServeAuth({ auth: true, port: 4400 }, { GH_CLIENT_ID: "id" }),
	).toThrow("--auth requires GH_CLIENT_SECRET in the environment");
	expect(() =>
		resolveServeAuth({ auth: true, port: 4400 }, { GH_CLIENT_SECRET: "s" }),
	).toThrow("--auth requires GH_CLIENT_ID in the environment");
});

test("--auth with a port and both credentials binds all interfaces", () => {
	expect(resolveServeAuth({ auth: true, port: 4400 }, BOTH)).toEqual({
		auth: true,
		host: "0.0.0.0",
		port: 4400,
	});
});
