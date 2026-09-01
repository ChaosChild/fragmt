import { expect, test } from "vitest";
import { listenLines, resolveServeAuth } from "../src/cli/index.js";

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

// The startup banner (owner round: --auth binds every interface but only
// printed localhost – misleading). A stand-in for os.networkInterfaces()
// output, shaped like the real entries.
const NETS = [
	{ address: "127.0.0.1", family: "IPv4", internal: true },
	{ address: "::1", family: "IPv6", internal: true },
	{ address: "192.168.1.23", family: "IPv4", internal: false },
	{ address: "fe80::1d9", family: "IPv6", internal: false },
	{ address: "10.0.0.7", family: "IPv4", internal: false },
];

test("listenLines: auth off is the single localhost line (output unchanged)", () => {
	expect(listenLines(4400, false, NETS)).toEqual(["http://localhost:4400"]);
});

test("listenLines: auth on lists localhost first, then the LAN IPv4s, then one hint", () => {
	expect(listenLines(4400, true, NETS)).toEqual([
		"http://localhost:4400",
		"http://192.168.1.23:4400",
		"http://10.0.0.7:4400",
		"each address needs a matching OAuth app callback URL",
	]);
});

test("listenLines: internal and IPv6 addresses never list", () => {
	const loopbackOnly = NETS.filter((n) => n.internal || n.family === "IPv6");
	expect(listenLines(4400, true, loopbackOnly)).toEqual([
		"http://localhost:4400",
		"each address needs a matching OAuth app callback URL",
	]);
});
