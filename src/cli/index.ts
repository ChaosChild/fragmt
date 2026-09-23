#!/usr/bin/env node
import {
	existsSync,
	readdirSync,
	readFileSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import { networkInterfaces } from "node:os";
import { basename, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
	deriveGraph,
	graphToDot,
	graphToJson,
	graphToMermaid,
} from "../core/graph.js";
import {
	authorsNotice,
	classifyAuthorEmails,
	configPath,
	enableOkf,
	findRepoRoot,
	fixOkf,
	GitIdentityError,
	git,
	initNestedRepo,
	initRepo,
	loadConfig,
	localUser,
	logCommits,
	populateOkf,
	validateOkf,
	writeAgentsBlock,
	writeOuterAgentsBlock,
} from "../core/index.js";
import { bundleZip } from "../core/zip.js";
import { createApp, startServer } from "../server/index.js";
import { runAgent } from "./agent.js";

/** Top-level usage text. Exported so tests can assert on it. */
export const usage = `\
fragmt – git-native documentation environment

Usage:
  fragmt init [--root <path>] [--folder <name>] [--new] [--okf]
  fragmt serve [--port <n>] [--auth]
  fragmt validate [--fix]
  fragmt export [--format mermaid|dot|json] [--out <file>] [--bundle]
  fragmt agent [status]
  fragmt agent comment <doc> [--thread <id>] [--body <text>] [--resolve] [--author <who>] [--as-actor <who>] [--full]
  fragmt agent draft <doc> [--merge] [--as-actor <who>]
  fragmt agent save <doc> (--file <path> | --stdin) [--author <who>] [--message <text>]
  fragmt agent verify <doc> [--as-actor <who>] [--author <who>]
  fragmt --help

Commands:
  init     Adopt an existing docs repo (write .fragmt.json); --folder <name> --new creates a nested docs repo
           --okf enables OKF mode (v0.2): existing repos flip the flag, docs validated, indexes + references committed
  serve    Start the local web server
  validate Check OKF conformance (§11); --fix applies the mechanical repairs in one commit
  export   The OKF reference graph – json (default), mermaid, or dot; --bundle zips the docs working tree
  agent    The agent surface: status, save, comment, draft, verify (AXI-conformant)
           --as-actor self-declares the OKF trust actor (default fragmt-agent/unspecified)
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
			// OKF rungs 1–2 (#21): the mode flag on init, the repair flag on
			// validate.
			okf: { type: "boolean", default: false },
			fix: { type: "boolean", default: false },
			// Rung 5 (#21): export's flags – --format only means anything
			// without --bundle, which supersedes it.
			bundle: { type: "boolean", default: false },
			format: { type: "string" },
			out: { type: "string" },
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
				okf: values.okf === true,
			}),
		);
	}
	if (command === "validate") {
		process.exit(
			await runValidate(values.fix === true, resolveRepoRoot("validate")),
		);
	}
	if (command === "export") {
		process.exit(
			await runExport(
				{
					bundle: values.bundle === true,
					format: values.format,
					out: values.out,
				},
				resolveRepoRoot("export"),
			),
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
	/** --okf: write/flip OKF mode and adopt the bundle (D1). */
	okf?: boolean;
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
 * `fragmt init`: today's adopt flow, plus the #16 nested-create path and the
 * #21 OKF adoption tail. `--folder X --new` (or a re-run on an existing
 * nested repo) creates/adopts the folder as its own fragmt repo, writes the
 * outer AGENTS.md redirect, then offers the graduation (remote + push +
 * submodule signal); everything else keeps today's semantics, with --folder
 * as the docs root. `--okf` on a fresh init writes the OKF config; on an
 * existing repo it flips the flag (D1) instead of the plain re-init refusal.
 * Returns the exit code; `write` and `ask` are injectable for tests,
 * stdout/stdin live.
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
		return await runPlainInit(
			rootFlag ?? folder ?? ".",
			repoRoot,
			write,
			options.okf === true,
		);
	} catch (e) {
		fail((e as Error).message);
	}
}

/**
 * Today's adopt flow (`fragmt init [--root <path>]`): initRepo, then the
 * avatar-path notice (rung B) – on both the fresh and the already-initialized
 * path, the same check serve runs. `--okf` on an existing config routes to
 * the D1 flip instead; on a fresh init it follows the OKF adoption tail.
 */
async function runPlainInit(
	docsRoot: string,
	repoRoot: string,
	write: (s: string) => void,
	okf = false,
): Promise<number> {
	if (okf && existsSync(configPath(repoRoot))) {
		return await runOkfFlip(repoRoot, docsRoot, write);
	}
	const result = initRepo(repoRoot, docsRoot, okf);
	if (result.alreadyInitialized) {
		write("already initialized\n");
	} else {
		const count = result.count ?? 0;
		const noun = count === 1 ? "file" : "files";
		write(
			`Initialized fragmt\n  docs root: ${docsRoot}\n  ${count} markdown ${noun}\n`,
		);
		if (okf) await adoptOkf(repoRoot, docsRoot, write);
	}
	await printAvatarNotice(repoRoot, docsRoot, write);
	return 0;
}

/**
 * The D1 flip: an existing repo gains OKF mode without re-initializing –
 * rewrite the config flag (everything else in the file survives), refresh
 * the AGENTS block (the plain re-run's behavior), print the findings, then
 * the adoption commit. Adopt, don't rewrite: no conformance repair happens
 * here, `validate --fix` finishes the job.
 */
async function runOkfFlip(
	repoRoot: string,
	docsRoot: string,
	write: (s: string) => void,
): Promise<number> {
	enableOkf(repoRoot);
	writeAgentsBlock(repoRoot);
	write("OKF mode enabled\n");
	await adoptOkf(repoRoot, docsRoot, write);
	await printAvatarNotice(repoRoot, docsRoot, write);
	return 0;
}

/**
 * The `--okf` adoption tail, shared by every init path: the §11 findings
 * first (the operator's to-do list), then ONE commit that populates the
 * derived references fields repo-wide and generates the index.md set.
 */
async function adoptOkf(
	repoRoot: string,
	docsRoot: string,
	write: (s: string) => void,
): Promise<void> {
	const { conformant, findings } = await validateOkf(repoRoot, docsRoot);
	if (conformant) {
		write("OKF conformant\n");
	} else {
		write(`${findings.length} OKF finding(s):\n`);
		for (const f of findings) write(`${f.path}: ${f.clause}: ${f.detail}\n`);
		write("fix with: fragmt validate --fix\n");
	}
	// The adoption commit's identity: the operator's when git has one, else
	// the fragmt machine identity (the nested initial commit's author),
	// materialized as repo-local config so the COMMITTER resolves too –
	// commitAs passes --author and the committer env from the same user
	// (local mode keeps the machine identity), and fresh nested bundles /
	// CI runners ship no identity anywhere git looks.
	let who: { name: string; email: string };
	try {
		who = await localUser(repoRoot);
	} catch (e) {
		if (!(e instanceof GitIdentityError)) throw e;
		who = { name: "fragmt", email: "fragmt@localhost" };
		await git(repoRoot, ["config", "user.name", who.name]);
		await git(repoRoot, ["config", "user.email", who.email]);
	}
	const { files } = await populateOkf(repoRoot, docsRoot, who);
	write(
		files.length === 0
			? "OKF: nothing to populate\n"
			: `OKF: populated ${files.length} file(s) in one commit\n`,
	);
}

/**
 * `fragmt validate [--fix]` (#21): OKF repos only – anything else (no
 * config, or the flag unset) exits 2 with the `init --okf` hint. Prints the
 * §11 findings one per line, grouped by clause (validateOkf's order);
 * `--fix` applies the mechanical repairs in one commit first. Exit 0
 * conformant / 1 findings / 2 not an OKF repo. `write` injectable for tests.
 */
export async function runValidate(
	fix: boolean,
	repoRoot: string,
	write: (s: string) => void = (s) => {
		process.stdout.write(s);
	},
): Promise<number> {
	let docsRoot: string | undefined;
	let okf = false;
	try {
		const config = loadConfig(repoRoot);
		docsRoot = config.docsRoot;
		okf = config.okf === true;
	} catch {
		okf = false; // not initialized – the same exit-2 hint covers it
	}
	if (!okf || docsRoot === undefined) {
		write("not an OKF repo – enable with: fragmt init --okf\n");
		return 2;
	}
	if (fix) {
		const { files } = await fixOkf(repoRoot, docsRoot);
		write(
			files.length === 0
				? "nothing to fix\n"
				: `fixed ${files.length} file(s) in one commit\n`,
		);
	}
	const { conformant, findings } = await validateOkf(repoRoot, docsRoot);
	if (conformant) {
		write("conformant\n");
		return 0;
	}
	for (const f of findings) write(`${f.path}: ${f.clause}: ${f.detail}\n`);
	return 1;
}

/** `fragmt export`'s flags (rung 5). */
export interface ExportOptions {
	/** --bundle: the docs working tree as a zip; supersedes --format. */
	bundle?: boolean;
	/** json (default) | mermaid | dot. */
	format?: string;
	/** Write to this file instead of stdout. */
	out?: string;
}

/**
 * `fragmt export` (rung 5 #21): the reference graph as json (default),
 * mermaid, or dot – stdout, or UTF-8 bytes to --out – or, with --bundle, the
 * docs working tree zipped to `<docs-dir>.zip` beside the working directory
 * (--out names it). OKF repos only – anything else exits 2 with the `init
 * --okf` hint (the validate convention), on stderr. A pure read of the
 * working tree: no commit, and the walk never trusts the frontmatter cache.
 * Returns the exit code; `write`/`errWrite` injectable for tests.
 */
export async function runExport(
	options: ExportOptions,
	repoRoot: string,
	write: (s: string) => void = (s) => {
		process.stdout.write(s);
	},
	errWrite: (s: string) => void = (s) => {
		process.stderr.write(s);
	},
): Promise<number> {
	let docsRoot: string | undefined;
	let okf = false;
	try {
		const config = loadConfig(repoRoot);
		docsRoot = config.docsRoot;
		okf = config.okf === true;
	} catch {
		okf = false; // not initialized – the same exit-2 hint covers it
	}
	if (!okf || docsRoot === undefined) {
		errWrite("not an OKF repo – enable with: fragmt init --okf\n");
		return 2;
	}
	if (options.bundle === true) {
		const out = options.out ?? `${basename(resolve(repoRoot, docsRoot))}.zip`;
		writeFileSync(out, await bundleZip(repoRoot, docsRoot));
		return 0;
	}
	const graph = await deriveGraph(repoRoot, docsRoot);
	let text: string;
	if (options.format === "mermaid") {
		text = graphToMermaid(graph, new Date());
	} else if (options.format === "dot") {
		text = graphToDot(graph);
	} else if (options.format === undefined || options.format === "json") {
		text = `${JSON.stringify(graphToJson(graph, new Date()), null, 2)}\n`;
	} else {
		fail(`unknown format: ${options.format} – json, mermaid, or dot`);
	}
	if (options.out === undefined) write(text);
	else writeFileSync(options.out, text, "utf8");
	return 0;
}

/**
 * The #16 nested flow (`--folder X [--new]`): create the nested repo when
 * asked (a folder already holding `.fragmt.json` is a re-run – "already
 * initialized"), the outer AGENTS.md redirect, then the ask-and-wait
 * graduation – re-offered on a re-run when it never completed. The avatar
 * notice operates on the nested repo now (docsRoot "."). `--okf` writes the
 * OKF config on create, flips it on a re-run, and runs the adoption tail on
 * the nested bundle either way.
 */
async function runNestedInit(
	repoRoot: string,
	folder: string,
	write: (s: string) => void,
	options: InitOptions,
): Promise<number> {
	const nestedRoot = resolve(repoRoot, folder);
	if (!existsSync(configPath(nestedRoot))) {
		const { count } = await initNestedRepo(
			repoRoot,
			folder,
			options.okf === true,
		);
		const noun = count === 1 ? "file" : "files";
		write(
			`Initialized fragmt\n  docs root: ${folder} (nested repo)\n  ${count} markdown ${noun}\n`,
		);
		writeOuterAgentsBlock(repoRoot, folder);
		if (options.okf === true) await adoptOkf(nestedRoot, ".", write);
	} else if (options.okf === true) {
		enableOkf(nestedRoot);
		writeAgentsBlock(nestedRoot);
		write("OKF mode enabled\n");
		await adoptOkf(nestedRoot, ".", write);
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
