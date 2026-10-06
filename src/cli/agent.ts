import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { relative, sep } from "node:path";
import { type ParseArgsOptionsConfig, parseArgs } from "node:util";
import matter from "gray-matter";
import {
	AGENT_DEFAULT,
	addReply,
	addThread,
	type CommentThread,
	commitAs,
	createDoc,
	currentBranch,
	docHash,
	GitIdentityError,
	hasFence,
	inMerge,
	isFrontmatterKey,
	isReservedBase,
	loadConfig,
	localUser,
	logCommits,
	MANAGED_FRONTMATTER_KEYS,
	mainBranch,
	mergeToMain,
	okfEnabled,
	populateOkf,
	type RepoMeta,
	readComments,
	readDoc,
	repoMeta,
	resolveDocPath,
	STATUS_VALUES,
	setResolved,
	stampGenerated,
	startDraft,
	verifyDoc,
	writeDoc,
} from "../core/index.js";
import { nestedDocsRedirect } from "./index.js";

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

/**
 * The merge commit's identity seam (#43): mergeToMain commits through git's
 * own `merge --no-edit`, which takes no author – but env outranks config, and
 * env is how commitAs already carries identity. Set process-wide for the one
 * call, restored after: the CLI is one-shot and the tests run sequentially.
 * Undefined passes through untouched (the machine identity, as before).
 */
async function mergeAs<T>(
	user: { name: string; email: string } | undefined,
	run: () => Promise<T>,
): Promise<T> {
	if (user === undefined) return run();
	const env = {
		GIT_AUTHOR_NAME: user.name,
		GIT_AUTHOR_EMAIL: user.email,
		GIT_COMMITTER_NAME: user.name,
		GIT_COMMITTER_EMAIL: user.email,
	};
	Object.assign(process.env, env);
	try {
		return await run();
	} finally {
		for (const k of Object.keys(env)) delete process.env[k];
	}
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
			(t) =>
				// #61: a doc-level thread (empty quote, no span) carries the
				// marker so an agent can find it again to reply or resolve.
				`${t.id},${t.author},${t.resolved},${t.replies.length}${t.quote === "" ? " [doc-level]" : ""}`,
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
	// #47: git-log order is "whatever committed last" – pick alphabetically,
	// and never AGENTS.md: the contract file is not a drafting target (if it
	// is the only doc, doc stays undefined and the hint is skipped).
	const doc = Object.keys(meta.docs)
		.sort()
		.find((d) => d.split("/").pop() !== "AGENTS.md");
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
	/** D4: the agent's self-declared OKF actor, verbatim. */
	"as-actor"?: string;
	full?: boolean;
	merge?: boolean;
	file?: string;
	stdin?: boolean;
	message?: string;
};

function parseVerb(
	verb: "status" | "comment" | "draft" | "verify" | "save",
	args: string[],
): { values: AgentValues; positionals: string[] } {
	const asActor = { "as-actor": { type: "string" } } as const;
	const options: ParseArgsOptionsConfig =
		verb === "comment"
			? {
					thread: { type: "string" },
					body: { type: "string" },
					resolve: { type: "boolean", default: false },
					author: { type: "string" },
					full: { type: "boolean", default: false },
					...asActor,
				}
			: verb === "draft"
				? {
						merge: { type: "boolean", default: false },
						author: { type: "string" },
						...asActor,
					}
				: verb === "verify"
					? { author: { type: "string" }, ...asActor }
					: verb === "save"
						? {
								file: { type: "string" },
								stdin: { type: "boolean", default: false },
								author: { type: "string" },
								message: { type: "string" },
								...asActor,
							}
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

/**
 * The every-verb actor seam (#60): an agent's OKF actor is the verbatim
 * `--as-actor` self-declaration, or AGENT_DEFAULT where a default is allowed
 * – `save` hard-requires the flag (there is no honest default for a trust
 * stamp). Anything that would resolve to a `human:`-prefixed actor refuses
 * here: a machine must not claim human review (§5.3), and the guard makes
 * that structural – a future derivation regression cannot ride any verb.
 */
function agentActor(
	values: AgentValues,
	verb: "save" | "comment" | "draft" | "verify",
): string {
	const declared = values["as-actor"];
	if (declared === undefined) {
		if (verb !== "save") return AGENT_DEFAULT;
		throw new Error(
			'agent save needs --as-actor "producer/version" so the doc\'s trust stamp names a real actor',
		);
	}
	if (declared.startsWith("human:"))
		throw new Error(
			'--as-actor must not start with "human:" – a machine never claims human review; declare your own producer/version',
		);
	return declared;
}

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
	docsRoot: string,
	parsed: { values: AgentValues; positionals: string[] },
	out: (s: string) => void,
): Promise<number> {
	const { values, positionals } = parsed;
	const doc = positionals[0];
	if (doc === undefined) {
		out("error: comment needs a doc path (docsRoot-relative .md)");
		return 1;
	}
	// #46: a missing doc used to list as "no threads" with exit 0 – the same
	// resolve-and-refuse as draft/verify, once here for the listing and the
	// thread paths alike (a nonexistent doc has neither).
	const abs = resolveDocPath(repoRoot, docsRoot, doc);
	if (!existsSync(abs) || !statSync(abs).isFile()) {
		out(`error: no doc ${doc}`);
		return 1;
	}
	// #61: `--resolve` stays thread-scoped – a resolution names its thread.
	// `--body` alone no longer errors: it starts a doc-level thread.
	if (values.resolve === true && values.thread === undefined) {
		out("error: --resolve needs --thread <id>");
		return 1;
	}
	// The guard reads the repo, not the sidecar – mid-merge the on-disk
	// sidecar carries conflict markers and must not be parsed first. Hoisted
	// above both thread paths (#61): creation mutates exactly like a reply.
	const mutating = values.body !== undefined || values.resolve === true;
	if (mutating && inMerge(repoRoot)) {
		out(IN_MERGE);
		return 1;
	}

	if (values.thread === undefined) {
		if (values.body !== undefined) {
			// #61: the CLI's own thread start – doc-level (quote ""), the id
			// minted here like the UI's bubble comment does, satisfying the
			// server's id shape rule (non-empty, no slashes) by construction.
			const user =
				values.author !== undefined
					? parseAuthor(values.author)
					: await localUser(repoRoot);
			if (!user.name || !user.email) {
				out("error: --author needs a display name and an address");
				return 1;
			}
			const id = crypto.randomUUID();
			await addThread(repoRoot, doc, id, "", values.body, user);
			out(
				`ok: thread ${id} created on ${doc} · author: ${user.name} · 1 commit`,
			);
			helpBlock(out, [
				`fragmt agent comment ${doc} --thread ${id} --full`,
				`fragmt agent comment ${doc} --thread ${id} --body "…"`,
			]);
			return 0;
		}
		const threads = Object.values((await readComments(repoRoot, doc)).comments);
		for (const line of threadsLines(threads)) out(line);
		if (threads.length === 0) {
			helpBlock(out, [
				`fragmt agent comment ${doc} --body "…" – start a doc-level thread from the CLI`,
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
				// D4: the event's actor is the agent's self-declaration, default
				// AGENT_DEFAULT – never a false human: off the git identity.
				await setResolved(
					repoRoot,
					doc,
					id,
					true,
					user,
					agentActor(values, "comment"),
				);
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

/**
 * #59: the docs a `draft --merge` will land on main – A/M paths under
 * docsRoot in the `<main>..<branch>` walk (repoMeta walk 2's shape:
 * renames/deletes unmapped, one capped spawn), returned docsRoot-relative
 * and sorted, reserved filenames excluded (writeDoc's §3.1 guard). The
 * branch is the current checkout at the call site.
 */
async function mergeDocs(
	repoRoot: string,
	docsRoot: string,
	main: string,
	branch: string,
): Promise<string[]> {
	const prefix =
		docsRoot === "." ? "" : docsRoot.replace(/\\/g, "/").replace(/\/+$/, "");
	const out = await logCommits(repoRoot, [
		"-n",
		"500",
		`${main}..${branch}`,
		"--name-status",
		"--format=%H",
	]);
	const docs: string[] = [];
	for (const line of out.split("\n")) {
		const tab = line.indexOf("\t");
		if (tab < 0) continue; // commit sha lines carry no tab
		if (line[0] !== "A" && line[0] !== "M") continue; // renames/deletes unmapped
		const repoRel = line.slice(tab + 1);
		if (!repoRel.toLowerCase().endsWith(".md")) continue;
		const doc =
			prefix === ""
				? repoRel
				: repoRel.startsWith(`${prefix}/`)
					? repoRel.slice(prefix.length + 1)
					: null;
		if (doc === null || isReservedBase(doc) || docs.includes(doc)) continue;
		docs.push(doc);
	}
	return docs.sort();
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
	// #42: a draft of an absent doc used to answer ok and then silently skip
	// the pre-merge stamp – refuse and point at the creation verb instead
	// (runVerify's guard, plus the pointer).
	const abs = resolveDocPath(repoRoot, docsRoot, doc);
	if (!existsSync(abs) || !statSync(abs).isFile()) {
		out(
			`error: no doc ${doc} – create it with: fragmt agent save ${doc} --file <body> --as-actor "<producer>/<version>"`,
		);
		return 1;
	}
	if (inMerge(repoRoot)) {
		out(IN_MERGE);
		return 1;
	}
	// #43: --author is optional like save/comment/verify's – resolved only
	// when passed, since a plain draft commits nothing and a machine with no
	// git identity may still draft. When passed it rides every commit this
	// verb makes: the OKF stamp below and the merge itself.
	const user =
		values.author !== undefined ? parseAuthor(values.author) : undefined;
	if (user !== undefined && (!user.name || !user.email)) {
		out("error: --author needs a display name and an address");
		return 1;
	}
	if (values.merge !== true) {
		const { current, reused } = await startDraft(repoRoot, doc, docsRoot);
		out(`ok: on draft ${current} (${reused ? "reused existing" : "created"})`);
		helpBlock(out, [`fragmt agent draft ${doc} --merge – merge back to main`]);
		return 0;
	}
	const branch = await currentBranch(repoRoot);
	// D4: OKF mode stamps the docs the merge will land on the DRAFT branch
	// pre-merge (#59) – every doc the branch carries, not just the positional
	// one: siblings riding the same branch used to reach main unstamped. A
	// doc already carrying a parseable generated.by keeps its producer's
	// stamp. A conflicted merge (stood:true) takes a different path and skips
	// this pre-merge stamping entirely.
	if (okfEnabled(repoRoot)) {
		const main = await mainBranch(repoRoot);
		if (main !== null) {
			const actor = agentActor(values, "draft");
			const stamped: { doc: string; rel: string }[] = [];
			for (const docPath of await mergeDocs(repoRoot, docsRoot, main, branch)) {
				const gen = readDoc(repoRoot, docsRoot, docPath).frontmatter.generated;
				const by =
					typeof gen === "object" && gen !== null
						? (gen as { by?: unknown }).by
						: undefined;
				if (typeof by === "string" && by !== "") continue;
				const abs = resolveDocPath(repoRoot, docsRoot, docPath);
				const next = stampGenerated(readFileSync(abs, "utf8"), actor);
				if (next === null) continue;
				writeFileSync(abs, next);
				stamped.push({
					doc: docPath,
					rel: relative(repoRoot, abs).split(sep).join("/"),
				});
			}
			if (stamped.length > 0) {
				await commitAs(
					user ?? (await localUser(repoRoot)),
					{
						files: stamped.map((s) => s.rel),
						// The common case (one doc) keeps the singular message.
						message:
							stamped.length === 1
								? `OKF: stamp ${stamped[0].doc} as ${actor}`
								: `OKF: stamp ${stamped.length} doc(s) as ${actor}`,
					},
					repoRoot,
				);
				out(
					`ok: stamped ${stamped.map((s) => s.doc).join(", ")} as ${actor} · 1 commit`,
				);
			}
		}
	}
	const result = await mergeAs(user, () => mergeToMain(repoRoot, docsRoot));
	if (result.merged) {
		// The server's conclude seam's twin: a clean merge regenerates the
		// references graph and indexes on main.
		if (okfEnabled(repoRoot)) await populateOkf(repoRoot, docsRoot);
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
 * `fragmt agent save <doc> (--file <path> | --stdin) --as-actor <who>
 * [--author <who>] [--message <text>]` – the content verb (#41): the same
 * writeDoc/createDoc paths the server's PUT/POST ride, so a CLI save gets
 * every save-time semantic in its ONE commit – the OKF `generated` stamp,
 * `references` settlement, `referenced-by` propagation – instead of leaving
 * them for merge-time healing, and a new doc is born conformant. The OKF
 * actor is the hard-required `--as-actor` self-declaration, verbatim (#60)
 * – update saves stamp it via writeDoc's `opts.actor`. Branch discipline
 * is the server's model: on main the startDraft dance (POST /api/draft)
 * runs first; any other branch writes directly. The stale check hashes the
 * body the agent just superseded – PUT's discipline, honestly.
 */
async function runSave(
	repoRoot: string,
	docsRoot: string,
	parsed: { values: AgentValues; positionals: string[] },
	out: (s: string) => void,
): Promise<number> {
	const { values, positionals } = parsed;
	const doc = positionals[0];
	if (doc === undefined) {
		out("error: save needs a doc path (docsRoot-relative .md)");
		return 1;
	}
	// Exactly one body source; a usage error like an unknown flag (exit 2).
	const fromFile = values.file !== undefined;
	const fromStdin = values.stdin === true;
	if (fromFile === fromStdin) {
		out("error: save needs exactly one body source – --file <path> or --stdin");
		return 2;
	}
	if (fromFile && !existsSync(values.file as string)) {
		out(`error: --file not found: ${values.file}`);
		return 1;
	}
	const body = readFileSync(fromFile ? (values.file as string) : 0, "utf8");
	if (inMerge(repoRoot)) {
		out(IN_MERGE);
		return 1;
	}
	// #60: save's actor is hard-required – the OKF trust stamp must name a
	// real actor, never a human:-prefixed derivation off the git identity.
	const actor = agentActor(values, "save");
	const user =
		values.author !== undefined
			? parseAuthor(values.author)
			: await localUser(repoRoot);
	if (!user.name || !user.email) {
		out("error: --author needs a display name and an address");
		return 1;
	}
	// The server's write model: on main, draft first (the POST /api/draft
	// dance); a branch switch is the auto-draft note's trigger.
	// #57: a frontmatter-bearing body merges into a NEW doc's frontmatter
	// (body keys win over the conformant defaults) but is refused on update
	// – writeDoc preserves the existing frontmatter byte-for-byte, so the
	// body's own block would silently become body text.
	const abs = resolveDocPath(repoRoot, docsRoot, doc);
	const exists = existsSync(abs) && statSync(abs).isFile();
	const fenced = hasFence(body);
	if (exists && fenced) {
		throw new Error(
			`--file body carries a frontmatter block; ${doc} already has frontmatter and it is preserved – pass body-only content (frontmatter is only merged when creating a new doc)`,
		);
	}
	const okf = okfEnabled(repoRoot);
	let seed: Record<string, unknown> | undefined;
	let content = body;
	if (okf && fenced) {
		const parsed = matter(body, {});
		seed = {};
		for (const [k, v] of Object.entries(
			parsed.data as Record<string, unknown>,
		)) {
			// Managed keys are a body-impossible claim (no save may set them);
			// a key outside the §4.1 grammar would corrupt the fence – both
			// dropped, the body's prose is the only mandatory half.
			if (MANAGED_FRONTMATTER_KEYS.has(k) || !isFrontmatterKey(k)) continue;
			seed[k] = v;
		}
		if (
			seed.status !== undefined &&
			!(STATUS_VALUES as readonly string[]).includes(seed.status as string)
		) {
			throw new Error(
				`status must be one of ${STATUS_VALUES.join(", ")}: ${JSON.stringify(seed.status)}`,
			);
		}
		// The stored body is the content without its fence.
		content = parsed.content;
	}
	const before = await currentBranch(repoRoot);
	const { current } = await startDraft(repoRoot, doc, docsRoot);
	const message = values.message ?? `agent save ${doc}`;
	const { sha } = exists
		? await writeDoc(
				repoRoot,
				docsRoot,
				doc,
				content,
				docHash(readDoc(repoRoot, docsRoot, doc).markdown),
				user,
				{ message, actor },
			)
		: await createDoc(repoRoot, docsRoot, doc, content, user, {
				message,
				frontmatter: seed,
			});
	const note = current !== before ? " · auto-drafted from main" : "";
	out(`ok: saved ${doc} on ${current} (${sha.slice(0, 7)})${note}`);
	helpBlock(out, [`fragmt agent draft ${doc} --merge – merge back to main`]);
	return 0;
}

/**
 * `fragmt agent verify <doc> [--as-actor <string>] [--author <who>]` – the
 * agent-first A1 affordance (operator round 4C): the standalone verified
 * event through the same core verifyDoc the UI's Verify button rides, no
 * HTTP surface needed. The actor rule is comment --resolve's: the agent's
 * self-declaration verbatim, default AGENT_DEFAULT – never a false human:
 * off the git identity. One commit; the ok line names the actor it landed
 * as, so a mis-declared producer is visible at the point of use.
 */
async function runVerify(
	repoRoot: string,
	docsRoot: string,
	parsed: { values: AgentValues; positionals: string[] },
	out: (s: string) => void,
): Promise<number> {
	const { values, positionals } = parsed;
	const doc = positionals[0];
	if (doc === undefined) {
		out("error: verify needs a doc path (docsRoot-relative .md)");
		return 1;
	}
	if (inMerge(repoRoot)) {
		out(IN_MERGE);
		return 1;
	}
	// The definitive one-liner for a missing doc (verifyDoc's
	// DocNotFoundError carries only the bare path); a traversal shape keeps
	// DocPathError's own text via the outer catch.
	const abs = resolveDocPath(repoRoot, docsRoot, doc);
	if (!existsSync(abs) || !statSync(abs).isFile()) {
		out(`error: no doc ${doc}`);
		return 1;
	}
	const user =
		values.author !== undefined
			? parseAuthor(values.author)
			: await localUser(repoRoot);
	if (!user.name || !user.email) {
		out("error: --author needs a display name and an address");
		return 1;
	}
	const actor = agentActor(values, "verify");
	await verifyDoc(repoRoot, docsRoot, doc, user, actor);
	out(`ok: verified ${doc} as ${actor} · 1 commit`);
	helpBlock(out, ["fragmt agent status"]);
	return 0;
}

/**
 * The namespace help (#44): `fragmt agent --help` – index.ts usage's
 * register in miniature, every verb with its flags and a one-line purpose.
 * Exported so tests assert on it.
 */
export const agentUsage = `\
fragmt agent – the agent surface: status, save, comment, draft, verify

Usage:
  fragmt agent [status]
  fragmt agent save <doc> (--file <path> | --stdin) --as-actor <who> [--author <who>] [--message <text>]
  fragmt agent comment <doc> [--thread <id>] [--body <text>] [--resolve] [--author <who>] [--as-actor <who>] [--full]
  fragmt agent draft <doc> [--merge] [--author <who>] [--as-actor <who>]
  fragmt agent verify <doc> [--as-actor <who>] [--author <who>]

Commands:
  status  Branch, draft rows, merge state (bare fragmt agent is status)
  save    Create or overwrite a doc in one conformant commit – new docs on main auto-draft
  comment List threads, start a doc-level thread (--body), or reply/resolve one – anchored threads still need a text selection in the UI
  draft   Start or join the doc's draft branch; --merge merges it back to main
  verify  Record the doc's verified event as the self-declared --as-actor
`;

/**
 * `fragmt agent [status] | comment <doc> […] | draft <doc> [--merge]
 * [--author <who>] | save <doc> (--file <path> | --stdin) […] | verify <doc>
 * [--as-actor <string>] [--author <who>]`.
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
	// #44: the namespace help answers before any verb parsing – stdout, exit
	// 0, the same contract as `fragmt --help`.
	if (verb === "--help") {
		write(agentUsage);
		return 0;
	}
	if (
		verb !== "status" &&
		verb !== "comment" &&
		verb !== "draft" &&
		verb !== "verify" &&
		verb !== "save"
	) {
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
		if (verb === "comment")
			return await runComment(repoRoot, docsRoot, parsed, out);
		if (verb === "verify")
			return await runVerify(repoRoot, docsRoot, parsed, out);
		if (verb === "save") return await runSave(repoRoot, docsRoot, parsed, out);
		return await runDraft(repoRoot, docsRoot, parsed, out);
	} catch (e) {
		// #16: run from the outer repo of a nested setup – the shared redirect
		// (serve's fail() twin) instead of the bare "not initialized". Only the
		// missing-config case can land here; the helper nulls out otherwise.
		const redirect = nestedDocsRedirect(repoRoot, "agent");
		if (redirect) {
			out(`error: ${redirect}`);
			return 1;
		}
		out(`error: ${humanError(e)}`);
		return 1;
	}
}
