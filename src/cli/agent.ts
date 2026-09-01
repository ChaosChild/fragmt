import { type ParseArgsOptionsConfig, parseArgs } from "node:util";
import {
	addReply,
	type CommentThread,
	currentBranch,
	GitIdentityError,
	inMerge,
	loadConfig,
	localUser,
	mergeToMain,
	type RepoMeta,
	readComments,
	repoMeta,
	setResolved,
	startDraft,
} from "../core/index.js";

// The agent front door (M4-4 b4): a thin AXI-conformant shell over the same
// core functions the UI rides. TOON rows (`name[fields]:` headers, comma
// rows), aggregates inline, definitive empty states, `error: …` on stdout
// with exit 1, unknown flag/verb exit 2, `help[n]:` hints after every output,
// no interactive prompts, `--full` untruncates. Bare `fragmt agent` = status.

/** Reply/quote clamp for thread detail – `--full` skips it. */
const BODY_LIMIT = 120;

/** A body (reply or quote) as one TOON-safe line, with the untruncation note. */
export function truncateBody(body: string, limit = BODY_LIMIT): string {
	if (body.length <= limit) return body;
	return `${body.slice(0, limit)} (truncated, ${body.length} chars total – use --full)`;
}

/** Display-name slug for the machine address (nextDraftName's slug rules). */
function authorSlug(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]/g, "-")
		.replace(/^-+|-+$/g, "");
}

/**
 * `--author` git-style: `Name <address>` → both verbatim; a bare name gets
 * the deterministic machine address `<slug>@users.noreply.fragmt` – the
 * convention git itself uses, never a real address. Plain commit-metadata
 * plumbing: the value replaces localUser() for the mutation, so the commit
 * AND the sidecar's author field carry the agent's display name.
 */
export function parseAuthor(who: string): { name: string; email: string } {
	const withAddress = who.trim().match(/^(.*)<([^<>]*)>$/);
	if (withAddress)
		return { name: withAddress[1].trim(), email: withAddress[2].trim() };
	const name = who.trim();
	return { name, email: `${authorSlug(name)}@users.noreply.fragmt` };
}

/** The status block: summary line + draft rows (empty state: none). */
export function statusLines(meta: RepoMeta): string[] {
	const rows = Object.entries(meta.drafts).flatMap(([doc, entries]) =>
		entries.map((e) => `${e.branch},${doc},${e.status}`),
	);
	const mark =
		meta.main !== null && meta.current === meta.main ? " (protected)" : "";
	const merge = meta.merge
		? `merge: in progress – ${meta.merge.remaining} unresolved`
		: "merge: clean";
	if (rows.length === 0)
		return [
			`branch: ${meta.current}${mark} · drafts: 0 · ${merge}`,
			"drafts[0]: none",
		];
	return [
		`branch: ${meta.current}${mark} · drafts: ${rows.length} · ${merge}`,
		`drafts[${rows.length}]{branch,doc,status}:`,
		...rows,
	];
}

/** The comment listing: header with the inline aggregate + one row per thread. */
export function threadsLines(threads: CommentThread[]): string[] {
	const open = threads.filter((t) => !t.resolved).length;
	const aggregate = `– ${threads.length} of ${threads.length} total, ${open} open`;
	// ponytail: no row cap – sidecar threads stay small; add a --limit only if
	// a doc ever grows an unbounded thread count.
	if (threads.length === 0) return [`threads[0]: none ${aggregate}`];
	return [
		`threads[${threads.length}]{id,author,resolved,replies}: ${aggregate}`,
		...threads.map(
			(t) => `${t.id},${t.author},${t.resolved},${t.replies.length}`,
		),
	];
}

/** `--thread` detail: the thread row, the quote, the reply rows. */
export function detailLines(
	id: string,
	thread: CommentThread,
	full: boolean,
): string[] {
	const body = (s: string) => (full ? s : truncateBody(s));
	const lines = [
		`thread[${id}]{author,resolved}: ${thread.author},${thread.resolved}`,
		`quote: ${body(thread.quote)}`,
	];
	if (thread.replies.length === 0) return [...lines, "replies[0]: none"];
	return [
		...lines,
		`replies[${thread.replies.length}]{author,body}:`,
		...thread.replies.map((r) => `${r.author},${body(r.body)}`),
	];
}

/** A typed core error → one human line (no stack traces). */
function humanError(e: unknown): string {
	if (e instanceof GitIdentityError)
		return 'git identity not configured – pass --author "Name <email>" or set git user.name/user.email';
	const message = e instanceof Error ? e.message : String(e);
	return (
		message
			.split(/\r?\n/)
			.map((l) => l.trim())
			.filter(Boolean)
			.join("; ") || "unknown error"
	);
}

/** `help[n]:` + two-space-indented next-step commands (AXI: after every output). */
function helpBlock(out: (s: string) => void, hints: string[]): void {
	out(`help[${hints.length}]:`);
	for (const hint of hints) out(`  ${hint}`);
}

function statusHints(meta: RepoMeta): string[] {
	if (meta.merge)
		return [
			"fragmt serve – finish or abort the standing merge in the UI",
			"fragmt agent status – re-check merge state",
		];
	const doc = Object.keys(meta.docs)[0];
	const draft = Object.entries(meta.drafts).flatMap(([d, es]) =>
		es.map((e) => ({ doc: d, branch: e.branch })),
	)[0];
	if (doc === undefined)
		return ["fragmt serve – create the first doc in the UI"];
	if (draft) {
		return [
			`fragmt agent comment ${doc}`,
			`fragmt agent draft ${draft.doc} --merge`,
		];
	}
	return [`fragmt agent comment ${doc}`, `fragmt agent draft ${doc}`];
}

/** Per-verb option sets: a flag foreign to the verb is unknown (exit 2). */
type AgentValues = {
	thread?: string;
	body?: string;
	resolve?: boolean;
	author?: string;
	full?: boolean;
	merge?: boolean;
};

function parseVerb(
	verb: "status" | "comment" | "draft",
	args: string[],
): { values: AgentValues; positionals: string[] } {
	const options: ParseArgsOptionsConfig =
		verb === "comment"
			? {
					thread: { type: "string" },
					body: { type: "string" },
					resolve: { type: "boolean", default: false },
					author: { type: "string" },
					full: { type: "boolean", default: false },
				}
			: verb === "draft"
				? { merge: { type: "boolean", default: false } }
				: {};
	const { values, positionals } = parseArgs({
		args,
		options,
		allowPositionals: true,
		strict: true,
	});
	return { values: values as AgentValues, positionals };
}

/** The mutation guard, same text as the b3 server write-guard. */
const IN_MERGE = "error: a merge is in progress – finish or abort it first";

async function runStatus(
	repoRoot: string,
	docsRoot: string,
	out: (s: string) => void,
): Promise<number> {
	const meta = await repoMeta(repoRoot, docsRoot);
	for (const line of statusLines(meta)) out(line);
	helpBlock(out, statusHints(meta));
	return 0;
}

async function runComment(
	repoRoot: string,
	parsed: { values: AgentValues; positionals: string[] },
	out: (s: string) => void,
): Promise<number> {
	const { values, positionals } = parsed;
	const doc = positionals[0];
	if (doc === undefined) {
		out("error: comment needs a doc path (docsRoot-relative .md)");
		return 1;
	}
	if (
		values.thread === undefined &&
		(values.body !== undefined || values.resolve === true)
	) {
		out("error: --body and --resolve need --thread <id>");
		return 1;
	}

	if (values.thread === undefined) {
		const threads = Object.values((await readComments(repoRoot, doc)).comments);
		for (const line of threadsLines(threads)) out(line);
		if (threads.length === 0) {
			helpBlock(out, [
				"fragmt serve – new threads start from a text selection in the UI",
				`fragmt agent comment ${doc} --thread <id> --body "…" – reply once one exists`,
			]);
		} else {
			const target = (threads.find((t) => !t.resolved) ?? threads[0]).id;
			helpBlock(out, [
				`fragmt agent comment ${doc} --thread ${target} --full`,
				`fragmt agent comment ${doc} --thread ${target} --body "…"`,
			]);
		}
		return 0;
	}

	const id = values.thread;
	// The guard reads the repo, not the sidecar – mid-merge the on-disk
	// sidecar carries conflict markers and must not be parsed first.
	const mutating = values.body !== undefined || values.resolve === true;
	if (mutating && inMerge(repoRoot)) {
		out(IN_MERGE);
		return 1;
	}
	const thread = (await readComments(repoRoot, doc)).comments[id];
	if (!thread) {
		out(`error: no thread ${id} on ${doc}`);
		return 1;
	}

	if (mutating) {
		const user =
			values.author !== undefined
				? parseAuthor(values.author)
				: await localUser(repoRoot);
		if (!user.name || !user.email) {
			out("error: --author needs a display name and an address");
			return 1;
		}
		if (values.body !== undefined) {
			await addReply(repoRoot, doc, id, values.body, user);
			out(`ok: reply added to thread ${id} · author: ${user.name} · 1 commit`);
		}
		if (values.resolve === true) {
			if (thread.resolved) out(`ok: thread ${id} already resolved`);
			else {
				await setResolved(repoRoot, doc, id, true, user);
				out(`ok: thread ${id} resolved · author: ${user.name} · 1 commit`);
			}
		}
		helpBlock(out, [`fragmt agent comment ${doc} --thread ${id} --full`]);
		return 0;
	}

	for (const line of detailLines(id, thread, values.full === true)) out(line);
	helpBlock(out, [
		`fragmt agent comment ${doc} --thread ${id} --body "…"`,
		`fragmt agent comment ${doc} --thread ${id} --resolve`,
	]);
	return 0;
}

async function runDraft(
	repoRoot: string,
	docsRoot: string,
	parsed: { values: AgentValues; positionals: string[] },
	out: (s: string) => void,
): Promise<number> {
	const { values, positionals } = parsed;
	const doc = positionals[0];
	if (doc === undefined) {
		out("error: draft needs a doc path (docsRoot-relative .md)");
		return 1;
	}
	if (inMerge(repoRoot)) {
		out(IN_MERGE);
		return 1;
	}
	if (values.merge !== true) {
		const { current, reused } = await startDraft(repoRoot, doc, docsRoot);
		out(`ok: on draft ${current} (${reused ? "reused existing" : "created"})`);
		helpBlock(out, [`fragmt agent draft ${doc} --merge – merge back to main`]);
		return 0;
	}
	const branch = await currentBranch(repoRoot);
	const result = await mergeToMain(repoRoot, docsRoot);
	if (result.merged) {
		out(`ok: merged to main · branch ${branch} deleted`);
		helpBlock(out, ["fragmt agent status"]);
		return 0;
	}
	if (result.stood) {
		out(
			`error: merge conflict – ${result.files.length} files; resolve in the fragmt UI`,
		);
		return 1;
	}
	out(
		`error: merge conflict – aborted, unresolvable files: ${result.files.join(", ")}`,
	);
	return 1;
}

/**
 * `fragmt agent [status] | comment <doc> […] | draft <doc> [--merge]`.
 * Returns the exit code: 0 ok, 1 runtime error (`error: …` on stdout, one
 * line), 2 unknown flag/verb. `write` is injectable for tests; stdout live.
 */
export async function runAgent(
	argv: string[],
	repoRoot: string,
	write: (s: string) => void = (s) => {
		process.stdout.write(s);
	},
): Promise<number> {
	const out = (s: string) => write(`${s}\n`);
	const verb = argv[0] ?? "status";
	if (verb !== "status" && verb !== "comment" && verb !== "draft") {
		out("error: unknown flag or verb");
		return 2;
	}
	let parsed: { values: AgentValues; positionals: string[] };
	try {
		parsed = parseVerb(verb, argv.slice(1));
	} catch {
		out("error: unknown flag or verb");
		return 2;
	}
	try {
		const docsRoot = loadConfig(repoRoot).docsRoot;
		if (verb === "status") return await runStatus(repoRoot, docsRoot, out);
		if (verb === "comment") return await runComment(repoRoot, parsed, out);
		return await runDraft(repoRoot, docsRoot, parsed, out);
	} catch (e) {
		out(`error: ${humanError(e)}`);
		return 1;
	}
}
