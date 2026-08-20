import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { findRepoRoot, initRepo, loadConfig } from "../core/index.js";
import { createApp, startServer } from "../server/index.js";
import { runAgent } from "./agent.js";

/** Top-level usage text. Exported so tests can assert on it. */
export const usage = `\
fragmt — git-native documentation environment

Usage:
  fragmt init [--root <path>]
  fragmt serve [--port <n>]
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
	// it parses itself — main's parseArgs only knows the operator flags.
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
		await runServe(values.port);
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

async function runServe(portFlag: string | undefined): Promise<void> {
	const repoRoot = resolveRepoRoot("serve");

	let docsRoot: string;
	try {
		docsRoot = loadConfig(repoRoot).docsRoot;
	} catch (e) {
		fail((e as Error).message);
	}

	const app = createApp({ repoRoot, docsRoot });
	startServer(app, parsePort(portFlag), (p) => {
		process.stdout.write(`http://localhost:${p}\n`);
	});
}

const invokedDirectly =
	import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (invokedDirectly) {
	main(process.argv.slice(2)).catch((e: unknown) => {
		fail(e instanceof Error ? e.message : String(e));
	});
}
