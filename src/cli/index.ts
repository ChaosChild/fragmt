#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { findRepoRoot, initRepo, loadConfig } from "../core/index.js";
import { createApp, startServer } from "../server/index.js";
import { runAgent } from "./agent.js";

/** Top-level usage text. Exported so tests can assert on it. */
export const usage = `\
fragmt – git-native documentation environment

Usage:
  fragmt init [--root <path>]
  fragmt serve [--port <n>] [--auth]
  fragmt agent [status]
  fragmt agent comment <doc> [--thread <id>] [--body <text>] [--resolve] [--author <who>] [--full]
  fragmt agent draft <doc> [--merge]
  fragmt --help

Commands:
  init   Adopt an existing docs repo (write .fragmt.json)
  serve  Start the local web server
  agent  The agent surface: status, comment, draft (AXI-conformant)
`;

/** Parse argv and dispatch. Exits the process. */
export async function main(argv: string[]): Promise<void> {
	// The agent namespace carries its own strict flag set (thread/body/…), so
	// it parses itself – main's parseArgs only knows the operator flags.
	if (argv[0] === "agent") {
		const repoRoot = resolveRepoRoot("agent");
		process.exit(await runAgent(argv.slice(1), repoRoot));
	}

	const { values, positionals } = parseArgs({
		args: argv,
		options: {
			help: { type: "boolean", default: false },
			root: { type: "string" },
			port: { type: "string" },
			auth: { type: "boolean", default: false },
		},
		allowPositionals: true,
		strict: true,
	});

	if (values.help === true || positionals.length === 0) {
		process.stdout.write(usage);
		process.exit(0);
	}

	const command = positionals[0];
	if (command === "init") {
		await runInit(values.root);
		return;
	}
	if (command === "serve") {
		await runServe(values.port, values.auth === true);
		return;
	}

	process.stderr.write(usage);
	process.exit(1);
}

function fail(message: string): never {
	process.stderr.write(`${message}\n`);
	process.exit(1);
}

function resolveRepoRoot(command: string): string {
	try {
		return findRepoRoot(process.cwd());
	} catch {
		fail(`fragmt ${command} must run inside a git clone`);
	}
}

async function runInit(rootFlag: string | undefined): Promise<void> {
	const repoRoot = resolveRepoRoot("init");
	const docsRoot = rootFlag ?? ".";
	try {
		const result = initRepo(repoRoot, docsRoot);
		if (result.alreadyInitialized) {
			process.stdout.write("already initialized\n");
			process.exit(0);
		}
		const count = result.count ?? 0;
		const noun = count === 1 ? "file" : "files";
		process.stdout.write(
			`Initialized fragmt\n  docs root: ${docsRoot}\n  ${count} markdown ${noun}\n`,
		);
		process.exit(0);
	} catch (e) {
		fail((e as Error).message);
	}
}

function parsePort(raw: string | undefined): number {
	const port = Number.parseInt(raw ?? "0", 10);
	if (!Number.isInteger(port) || port < 0 || port > 65535) {
		fail(`invalid port: ${raw ?? ""}`);
	}
	return port;
}

/** The resolved `serve` contract: interface to bind, port, auth mode on/off. */
export interface ServeConfig {
	auth: boolean;
	host: string;
	port: number;
}

/**
 * `serve`'s startup contract, resolved BEFORE anything binds. Plain serve is
 * a local tool: loopback only, port 0 stays ephemeral. --auth is the GitHub
 * OAuth mode (next batch's routes consume this): all interfaces, an explicit
 * repeatable port for the callback, and both app credentials in the
 * environment. Throws a one-line operator error on any violated term; runServe
 * surfaces it via fail() (stderr, exit 1). Exported pure so tests assert the
 * contract without spawning listeners.
 */
export function resolveServeAuth(
	options: { auth: boolean; port: number },
	env: Record<string, string | undefined>,
): ServeConfig {
	if (!options.auth) {
		return { auth: false, host: "127.0.0.1", port: options.port };
	}
	if (options.port === 0) {
		throw new Error(
			"--auth requires --port <n> – the OAuth callback needs a repeatable port",
		);
	}
	const missing = ["GH_CLIENT_ID", "GH_CLIENT_SECRET"].filter((k) => !env[k]);
	if (missing.length > 0) {
		throw new Error(
			`--auth requires ${missing.join(" and ")} in the environment`,
		);
	}
	return { auth: true, host: "0.0.0.0", port: options.port };
}

/**
 * The serve startup banner, one array entry per printed line: localhost
 * first, always. --auth binds all interfaces, so after the localhost line it
 * lists every non-internal IPv4 address (a LAN IP is a real way in) plus the
 * one callback hint – browsing via a LAN IP starts OAuth whose redirect_uri
 * uses that origin, so each address needs a matching OAuth app callback URL.
 * Plain serve is loopback-bound and stays localhost-only. Exported pure so
 * tests assert the exact lines; runServe's callback just prints them.
 */
export function listenLines(
	port: number,
	auth: boolean,
	nets: { address: string; family: string; internal: boolean }[],
): string[] {
	const lines = [`http://localhost:${port}`];
	if (!auth) return lines;
	for (const net of nets) {
		if (net.family !== "IPv4" || net.internal) continue;
		lines.push(`http://${net.address}:${port}`);
	}
	lines.push("each address needs a matching OAuth app callback URL");
	return lines;
}

async function runServe(
	portFlag: string | undefined,
	authFlag: boolean,
): Promise<void> {
	// The contract is arg/env-shaped, not repo-shaped – validate before the
	// repo lookup so a bad invocation reports itself, wherever it ran.
	const serve = resolveServeAuth(
		{ auth: authFlag, port: parsePort(portFlag) },
		process.env,
	);

	const repoRoot = resolveRepoRoot("serve");

	let docsRoot: string;
	try {
		docsRoot = loadConfig(repoRoot).docsRoot;
	} catch (e) {
		fail((e as Error).message);
	}

	const clientId = process.env.GH_CLIENT_ID;
	const clientSecret = process.env.GH_CLIENT_SECRET;

	const app = createApp({
		repoRoot,
		docsRoot,
		// --auth: the gate + OAuth routes consume the resolved credentials
		// (resolveServeAuth has already verified both are present).
		auth:
			serve.auth && clientId !== undefined && clientSecret !== undefined
				? { clientId, clientSecret }
				: undefined,
	});
	startServer(
		app,
		serve.port,
		(p) => {
			// The banner is listenLines's (auth mode lists the LAN addresses the
			// all-interfaces bind actually serves).
			process.stdout.write(
				`${listenLines(
					p,
					serve.auth,
				Object.values(networkInterfaces()).flatMap((n) => n ?? []),
				).join("\n")}\n`,
			);
		},
		serve.host,
	);
}

// Compare realpaths: ESM resolves import.meta.url through symlinks, while
// argv[1] arrives as the invoked path – nvm4w-style junctions make the raw
// URL comparison fail, silently skipping main().
const invokedDirectly = (() => {
	try {
		return (
			realpathSync(fileURLToPath(import.meta.url)) ===
			realpathSync(process.argv[1] ?? "")
		);
	} catch {
		return false;
	}
})();
if (invokedDirectly) {
	main(process.argv.slice(2)).catch((e: unknown) => {
		fail(e instanceof Error ? e.message : String(e));
	});
}
