#!/usr/bin/env node
import {
	existsSync,
	readdirSync,
	readFileSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import { networkInterfaces } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
	authorsNotice,
	classifyAuthorEmails,
	configPath,
	findRepoRoot,
	git,
	initNestedRepo,
	initRepo,
	loadConfig,
	logCommits,
	writeOuterAgentsBlock,
} from "../core/index.js";
import { createApp, startServer } from "../server/index.js";
import { runAgent } from "./agent.js";

/** Top-level usage text. Exported so tests can assert on it. */
export const usage = `\
fragmt – git-native documentation environment

Usage:
  fragmt init [--root <path>] [--folder <name>] [--new]
  fragmt serve [--port <n>] [--auth]
  fragmt agent [status]
  fragmt agent comment <doc> [--thread <id>] [--body <text>] [--resolve] [--author <who>] [--full]
  fragmt agent draft <doc> [--merge]
  fragmt --help

Commands:
  init   Adopt an existing docs repo (write .fragmt.json); --folder <name> --new creates a nested docs repo
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
			// #16: the nested docs repo flags – --new only means anything with
			// --folder, and is ignored otherwise.
			folder: { type: "string" },
			new: { type: "boolean", default: false },
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
		process.exit(
			await runInit(values.root, resolveRepoRoot("init"), undefined, {
				folder: values.folder,
				new: values.new === true,
			}),
		);
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

/** `fragmt init`'s flags beyond the docs root (#16 nested-create path). */
export interface InitOptions {
	folder?: string;
	/** --new: create the nested repo (only meaningful with --folder). */
	new?: boolean;
	/** The graduation prompt's answer reader – real readline in production. */
	ask?: () => Promise<string>;
}

/** The live prompt: one line from stdin (the prompt text is already written). */
function askLine(): Promise<string> {
	return new Promise((resolve) => {
		const rl = createInterface({
			input: process.stdin,
			output: process.stdout,
		});
		rl.question("", (answer) => {
			rl.close();
			resolve(answer);
		});
	});
}

/**
 * `fragmt init`: today's adopt flow, plus the #16 nested-create path.
 * `--folder X --new` (or a re-run on an existing nested repo) creates/adopts
 * the folder as its own fragmt repo, writes the outer AGENTS.md redirect,
 * then offers the graduation (remote + push + submodule signal); everything
 * else keeps today's semantics, with --folder as the docs root. Returns the
 * exit code; `write` and `ask` are injectable for tests, stdout/stdin live.
 */
export async function runInit(
	rootFlag: string | undefined,
	repoRoot: string,
	write: (s: string) => void = (s) => {
		process.stdout.write(s);
	},
	options: InitOptions = {},
): Promise<number> {
	try {
		const folder = options.folder;
		if (
			folder !== undefined &&
			(options.new === true ||
				existsSync(configPath(resolve(repoRoot, folder))))
		) {
			return await runNestedInit(repoRoot, folder, write, options);
		}
		return await runPlainInit(rootFlag ?? folder ?? ".", repoRoot, write);
	} catch (e) {
		fail((e as Error).message);
	}
}

/**
 * Today's adopt flow (`fragmt init [--root <path>]`): initRepo, then the
 * avatar-path notice (rung B) – on both the fresh and the already-initialized
 * path, the same check serve runs.
 */
async function runPlainInit(
	docsRoot: string,
	repoRoot: string,
	write: (s: string) => void,
): Promise<number> {
	const result = initRepo(repoRoot, docsRoot);
	if (result.alreadyInitialized) {
		write("already initialized\n");
	} else {
		const count = result.count ?? 0;
		const noun = count === 1 ? "file" : "files";
		write(
			`Initialized fragmt\n  docs root: ${docsRoot}\n  ${count} markdown ${noun}\n`,
		);
	}
	await printAvatarNotice(repoRoot, docsRoot, write);
	return 0;
}

/**
 * The #16 nested flow (`--folder X [--new]`): create the nested repo when
 * asked (a folder already holding `.fragmt.json` is a re-run – "already
 * initialized"), the outer AGENTS.md redirect, then the ask-and-wait
 * graduation – re-offered on a re-run when it never completed. The avatar
 * notice operates on the nested repo now (docsRoot ".").
 */
async function runNestedInit(
	repoRoot: string,
	folder: string,
	write: (s: string) => void,
	options: InitOptions,
): Promise<number> {
	const nestedRoot = resolve(repoRoot, folder);
	if (!existsSync(configPath(nestedRoot))) {
		const { count } = await initNestedRepo(repoRoot, folder);
		const noun = count === 1 ? "file" : "files";
		write(
			`Initialized fragmt\n  docs root: ${folder} (nested repo)\n  ${count} markdown ${noun}\n`,
		);
		writeOuterAgentsBlock(repoRoot, folder);
	} else {
		write("already initialized\n");
	}
	if (await needsGraduation(repoRoot, nestedRoot, folder)) {
		await graduate(repoRoot, folder, write, options.ask ?? askLine);
	}
	await printAvatarNotice(nestedRoot, ".", write);
	return 0;
}

/** The graduation never completed: no origin on the nested repo, or the outer
 *  repo has no `.gitmodules` entry for the folder (skip or a failed dance). */
async function needsGraduation(
	outerRoot: string,
	nestedRoot: string,
	folder: string,
): Promise<boolean> {
	let remotes = "";
	try {
		remotes = await git(nestedRoot, ["remote"]);
	} catch {
		return true;
	}
	if (remotes === "") return true;
	const modules = join(outerRoot, ".gitmodules");
	if (!existsSync(modules)) return true;
	return !readFileSync(modules, "utf8").includes(`path = ${folder}`);
}

const GRADUATION_PROMPT =
	"Add a remote for the docs repo now? Paste the origin URL (Enter to skip):";

/**
 * The ask-and-wait graduation (#16): a URL runs the dance – origin, push,
 * untrack, ignore-cleanup, submodule – every step via git() and printed as
 * it completes; an empty answer .gitignores the folder and prints the steps
 * for later. A failed push or submodule falls through to the printed steps:
 * the signal can't complete, and a half-state is never left silently.
 */
async function graduate(
	outerRoot: string,
	folder: string,
	write: (s: string) => void,
	ask: () => Promise<string>,
): Promise<void> {
	write(`${GRADUATION_PROMPT} `);
	const url = (await ask()).trim();
	if (url === "") {
		await skipGraduation(outerRoot, folder, write);
		return;
	}
	const nestedRoot = resolve(outerRoot, folder);
	try {
		await git(nestedRoot, ["remote", "add", "origin", url]);
	} catch {
		// A re-run: origin already exists – point it at the URL instead.
		await git(nestedRoot, ["remote", "set-url", "origin", url]);
	}
	write(`origin set in ${folder}\n`);
	try {
		await git(nestedRoot, ["push", "-u", "origin", "main"]);
		write("pushed main to origin\n");
	} catch (e) {
		write(`push failed: ${(e as Error).message}\n`);
		await printGraduationSteps(outerRoot, folder, url, write);
		return;
	}
	if (await isTracked(outerRoot, folder)) {
		await git(outerRoot, ["rm", "-r", "-q", "--cached", folder]);
		write(`untracked ${folder} from the outer repo\n`);
	}
	removeIgnoredLine(outerRoot, folder, write);
	try {
		await git(outerRoot, ["submodule", "add", url, folder]);
		write(`staged ${folder} as a submodule\n`);
	} catch (e) {
		write(`submodule add failed: ${(e as Error).message}\n`);
		await printGraduationSteps(outerRoot, folder, url, write);
		return;
	}
	const status = await git(outerRoot, ["status", "--short"]);
	write(
		`staged in the outer repo — review and commit:\n${status ? `${status}\n` : ""}`,
	);
}

/** The empty answer: .gitignore the folder (idempotent) + the steps for later. */
async function skipGraduation(
	outerRoot: string,
	folder: string,
	write: (s: string) => void,
): Promise<void> {
	const line = `${folder}/`;
	const text = readGitignore(outerRoot);
	if (!text.split(/\r?\n/).includes(line)) {
		const base = text === "" || text.endsWith("\n") ? text : `${text}\n`;
		writeFileSync(join(outerRoot, ".gitignore"), `${base}${line}\n`);
		write(`added ${line} to .gitignore\n`);
	}
	await printGraduationSteps(outerRoot, folder, "<url>", write);
}

/**
 * The steps for later, copy-pasteable: one step per line, `cd` on its own
 * line, no step ever riding a comment line. The `rm --cached` step appears
 * only when the outer repo's history tracks the folder.
 */
async function printGraduationSteps(
	outerRoot: string,
	folder: string,
	url: string,
	write: (s: string) => void,
): Promise<void> {
	write("finish the graduation later, from the outer repo root:\n");
	const steps = [
		`cd ${folder}`,
		`git remote add origin ${url}`,
		"git push -u origin main",
		"cd ..",
	];
	if (await isTracked(outerRoot, folder)) {
		steps.push(`git rm -r --cached ${folder}`);
	}
	steps.push(`git submodule add ${url} ${folder}`);
	for (const step of steps) write(`${step}\n`);
}

/** Does the outer repo's history track anything under the folder? */
async function isTracked(outerRoot: string, folder: string): Promise<boolean> {
	try {
		return (await logCommits(outerRoot, ["--oneline", "--", folder])) !== "";
	} catch {
		return false; // no commits yet / not a repo – nothing tracked
	}
}

function readGitignore(root: string): string {
	try {
		return readFileSync(join(root, ".gitignore"), "utf8");
	} catch {
		return ""; // absent – same as empty for both callers
	}
}

/** A prior skip left `folder/` ignored – it would hide the submodule. */
function removeIgnoredLine(
	outerRoot: string,
	folder: string,
	write: (s: string) => void,
): void {
	const text = readGitignore(outerRoot);
	const lines = text.split(/\r?\n/);
	const kept = lines.filter((l) => l !== folder && l !== `${folder}/`);
	if (kept.length === lines.length) return;
	writeFileSync(join(outerRoot, ".gitignore"), kept.join("\n"));
	write(`removed ${folder}/ from .gitignore\n`);
}

/**
 * The avatar-path notice (rung B), shared by init and local serve: the unique
 * commit-author emails under docsRoot vs the config authors map. Purely
 * cosmetic – any git or config failure prints nothing, never fails the command.
 */
async function printAvatarNotice(
	repoRoot: string,
	docsRoot: string,
	write: (s: string) => void,
): Promise<void> {
	try {
		const emails = [
			...new Set(
				(await logCommits(repoRoot, ["--format=%ae", "--", docsRoot]))
					.split("\n")
					.filter(Boolean),
			),
		];
		const notice = authorsNotice(
			classifyAuthorEmails(emails, loadConfig(repoRoot).authors ?? {})
				.unresolvable,
		);
		if (notice) write(notice);
	} catch {
		// Cosmetic feature – silence on any failure.
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

/**
 * #16 wrong-root redirect, shared by `serve` and the agent namespace: the
 * command ran from the OUTER repo of a nested docs setup – no `.fragmt.json`
 * at the root, but exactly one first-level directory has one. Zero or
 * several candidates keep today's error. Returns the message to fail with,
 * or null when the classic error should stand.
 */
export function nestedDocsRedirect(
	repoRoot: string,
	command: string,
): string | null {
	if (existsSync(configPath(repoRoot))) return null;
	let candidates: string[];
	try {
		candidates = readdirSync(repoRoot, { withFileTypes: true })
			.filter(
				(d) =>
					d.isDirectory() && existsSync(join(repoRoot, d.name, ".fragmt.json")),
			)
			.map((d) => d.name);
	} catch {
		return null;
	}
	if (candidates.length !== 1) return null;
	const dir = candidates[0];
	return `docs live in the nested fragmt repo at ${dir}/\n  run from there:  cd ${dir} && fragmt ${command}`;
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
		// #16: run from the outer repo of a nested setup – point at the folder.
		fail(nestedDocsRedirect(repoRoot, "serve") ?? (e as Error).message);
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
			// Rung B, local mode only: the same avatar notice init prints, once.
			if (!serve.auth) {
				void printAvatarNotice(repoRoot, docsRoot, (s) => {
					process.stdout.write(s);
				});
			}
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
