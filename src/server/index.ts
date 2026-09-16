import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import { getRequestListener } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { type Context, Hono } from "hono";
import {
	abortMerge,
	addReply,
	addThread,
	addThreadWithDoc,
	checkoutBranch,
	concludeMerge,
	createBranch,
	createDoc,
	createFolder,
	currentBranch,
	DocNotFoundError,
	DocPathError,
	deleteBranch,
	deleteDoc,
	deleteFolder,
	deleteThread,
	deleteThreadWithDoc,
	docHash,
	draftDiffLines,
	type FrontmatterEdit,
	GitError,
	GitIdentityError,
	gitAllowList,
	inMerge,
	isFrontmatterKey,
	listBranches,
	listTree,
	MergeUnresolvedError,
	mergeState,
	mergeToMain,
	moveDoc,
	OkfFieldError,
	OnMainBranchError,
	okfEnabled,
	PathExistsError,
	populateOkf,
	readComments,
	readDoc,
	refsList,
	renameFolder,
	repoMeta,
	resolveDocPath,
	resolveMergeDoc,
	resolveMergeSidecar,
	restoreDoc,
	StaleDocError,
	searchDocs,
	setDocMeta,
	setResolved,
	setTitle,
	startDraft,
	sync,
	ThreadNotFoundError,
	unmergedPaths,
	validateOkf,
	verifiedEvents,
	verifyDoc,
	writeComments,
	writeDoc,
} from "../core/index.js";
import {
	type AppEnv,
	type AuthConfig,
	commitAuthor,
	registerAuth,
	sessionDisabled,
	verifiedEmailLogins,
} from "./auth.js";

export interface ServerContext {
	repoRoot: string;
	docsRoot: string;
	/** serve --auth: the resolved GitHub OAuth app credentials (gate + OAuth routes in auth.ts). Absent → plain serve, no gate. */
	auth?: AuthConfig;
	/** Injectable GitHub fetch (tests stub the OAuth + collaborator calls). */
	githubFetch?: typeof fetch;
}

const DOCS_PREFIX = "/api/docs/";
const FOLDERS_PREFIX = "/api/folders/";
const RAW_PREFIX = "/api/raw/";
const DRAFT_DIFF_PREFIX = "/api/draft-diff/";

/** Package-root `ui/dist`. Same depth from `src/server/` (tsx) and `dist/server/` (built). */
const UI_DIST = fileURLToPath(new URL("../../ui/dist", import.meta.url));

/** Build the Hono app. Thin: parse request → call core → serialize. No fs/git here. */
export function createApp(ctx: ServerContext): Hono<AppEnv> {
	const app = new Hono<AppEnv>();

	// #20 batch 2: auth on → the gate + OAuth routes register FIRST, before the
	// merge write-guard below, so a request is authorized before it can touch
	// anything. Auth off → nothing registers except the static boot answer, and
	// every other middleware/route behaves byte-for-byte as before.
	if (ctx.auth) {
		registerAuth(app, {
			repoRoot: ctx.repoRoot,
			auth: ctx.auth,
			githubFetch: ctx.githubFetch,
		});
	} else {
		app.get("/api/auth/session", (c) => sessionDisabled(c));
	}

	// M4-4 b3: the write guard – a standing merge owns every write. Registered
	// before all write routes (incl. the comment fall-through below), so a
	// stray save/draft/checkout/comment mid-merge 409s instead of racing the
	// resolution. This is load-bearing: commitAs unconditionally `git add`s,
	// so an ordinary write would stage a half-resolution into an unrelated
	// commit. /api/merge* is exempt – those routes manage the merge itself.
	app.use("*", async (c, next) => {
		if (
			c.req.method !== "GET" &&
			c.req.method !== "HEAD" &&
			!c.req.path.startsWith("/api/merge") &&
			inMerge(ctx.repoRoot)
		)
			return c.json(
				{ error: "a merge is in progress – finish or abort it first" },
				409,
			);
		return next();
	});

	// M4-3 b7: the .gitignore filter – one ls-files spawn per refresh builds
	// the allow-list of everything git considers part of the repo. Every
	// tree-derived surface (sidebar, @ menu, move picker, link sets) reads
	// this route, so all inherit the filter here. git unavailable → null →
	// today's unfiltered walk (keep-prior-state).
	app.get("/api/tree", async (c) => {
		const allow = await gitAllowList(ctx.repoRoot, ctx.docsRoot);
		return c.json(listTree(ctx.repoRoot, ctx.docsRoot, allow ?? undefined));
	});

	// --- M4: comment sidecar -------------------------------------------------
	// Hono's `*` spans slashes only at the END of a pattern, so a nested
	// docPath (`notes/n.md/comments`) is invisible to `/api/docs/*/comments`.
	// Instead this middleware – registered BEFORE the /api/docs/* routes, so
	// comments tails win and everything else falls through via next() – splits
	// the trailing-wildcard tail itself: `<docPath>/comments[/<id>]`, the
	// suffix stripped from the END (a docPath may itself contain "/comments").
	// The id is opaque: never path-resolved, just a non-empty slash-free string.

	app.use(`${DOCS_PREFIX}*`, async (c, next) => {
		const tail = tailPath(c, DOCS_PREFIX);
		if (tail === undefined) return next(); // let the doc routes reject it
		try {
			if (tail.endsWith("/comments")) {
				const docPath = tail.slice(0, -"/comments".length);
				if (docPath === "") return c.json({ error: "invalid doc path" }, 400);
				if (c.req.method === "GET")
					return c.json(await readComments(ctx.repoRoot, docPath));
				if (c.req.method === "POST") {
					const body = await jsonBody(c);
					if (body === null)
						return c.json({ error: "invalid request body" }, 400);
					// The id later appears as a path segment – empty or slash-bearing
					// ids could never be addressed by PATCH/DELETE.
					if (
						typeof body.id !== "string" ||
						body.id === "" ||
						body.id.includes("/")
					)
						return c.json(
							{ error: "id must be a non-empty string without slashes" },
							400,
						);
					if (typeof body.quote !== "string" || typeof body.body !== "string")
						return c.json({ error: "quote and body are required" }, 400);
					// docBody present → the combined op: doc + sidecar in ONE commit
					// (docBaseHash is its writeDoc contract – required with it).
					if (body.docBody !== undefined) {
						if (
							typeof body.docBody !== "string" ||
							typeof body.docBaseHash !== "string"
						)
							return c.json(
								{ error: "docBody and docBaseHash are required together" },
								400,
							);
						const { sha } = await addThreadWithDoc(
							ctx.repoRoot,
							ctx.docsRoot,
							docPath,
							{
								id: body.id,
								quote: body.quote,
								body: body.body,
								docBody: body.docBody,
								baseHash: body.docBaseHash,
							},
							commitAuthor(c),
						);
						return c.json({ sha });
					}
					const { sha } = await addThread(
						ctx.repoRoot,
						docPath,
						body.id,
						body.quote,
						body.body,
						commitAuthor(c),
					);
					return c.json({ sha });
				}
			} else if (c.req.method === "POST" && tail.endsWith("/verify")) {
				// #33 (A1): the standalone Verify affordance – the committing
				// identity's verified event in its own commit. Rides the comments
				// middleware for the same reason the comment tails do: Hono's `*`
				// spans slashes only at pattern end, so nested docPaths need the
				// hand-split tail. A path segment can never end in "/verify" for
				// a .md doc, so no collision with the doc routes.
				const docPath = tail.slice(0, -"/verify".length);
				if (docPath === "") return c.json({ error: "invalid doc path" }, 400);
				const { sha } = await verifyDoc(
					ctx.repoRoot,
					ctx.docsRoot,
					docPath,
					commitAuthor(c),
				);
				return c.json({ sha });
			} else {
				const cut = tail.lastIndexOf("/comments/");
				if (cut !== -1) {
					const docPath = tail.slice(0, cut);
					const id = tail.slice(cut + "/comments/".length);
					if (docPath === "") return c.json({ error: "invalid doc path" }, 400);
					if (id === "" || id.includes("/"))
						return c.json(
							{ error: "thread id must be non-empty without slashes" },
							400,
						);
					if (c.req.method === "DELETE") {
						// ?baseHash= → the combined op: span stripped + entry removed
						// in ONE commit; absent → sidecar-only (a dirty client buffer
						// cannot send the doc).
						const baseHash = c.req.query("baseHash");
						if (baseHash !== undefined) {
							const { sha } = await deleteThreadWithDoc(
								ctx.repoRoot,
								ctx.docsRoot,
								docPath,
								id,
								baseHash,
								commitAuthor(c),
							);
							return c.json({ sha });
						}
						const { sha } = await deleteThread(
							ctx.repoRoot,
							docPath,
							id,
							commitAuthor(c),
						);
						return c.json({ sha });
					}
					if (c.req.method === "PATCH") {
						const body = await jsonBody(c);
						if (body === null)
							return c.json({ error: "invalid request body" }, 400);
						// Exactly one action per call (spec's shape).
						const picked = (["resolved", "body", "reply"] as const).filter(
							(k) => body[k] !== undefined,
						);
						if (picked.length !== 1)
							return c.json(
								{
									error: "exactly one of resolved, body, or reply is required",
								},
								400,
							);
						if (picked[0] === "resolved") {
							// M4-2: both directions – resolve and reopen.
							if (typeof body.resolved !== "boolean")
								return c.json({ error: "resolved must be a boolean" }, 400);
							const { sha } = await setResolved(
								ctx.repoRoot,
								docPath,
								id,
								body.resolved,
								commitAuthor(c),
							);
							return c.json({ sha });
						}
						const text = body[picked[0]];
						if (typeof text !== "string")
							return c.json({ error: `${picked[0]} must be a string` }, 400);
						if (picked[0] === "reply") {
							const { sha } = await addReply(
								ctx.repoRoot,
								docPath,
								id,
								text,
								commitAuthor(c),
							);
							return c.json({ sha });
						}
						// `body` edits the opening comment (replies[0]) through the
						// exported read-modify-write seam – the core has no edit helper.
						const file = await readComments(ctx.repoRoot, docPath);
						const thread = file.comments[id];
						if (!thread) throw new ThreadNotFoundError(id);
						thread.replies[0].body = text;
						const { sha } = await writeComments(
							ctx.repoRoot,
							docPath,
							file,
							commitAuthor(c),
						);
						return c.json({ sha });
					}
				}
			}
		} catch (e) {
			return respondFileError(c, e);
		}
		return next();
	});

	app.get("/api/docs/*", (c) => {
		let docPath: string;
		try {
			docPath = decodeURIComponent(c.req.path.slice(DOCS_PREFIX.length));
		} catch {
			return c.json({ error: "invalid doc path" }, 400);
		}
		try {
			const doc = readDoc(ctx.repoRoot, ctx.docsRoot, docPath);
			// Raw YAML bytes stay withheld (v1) and everything arrives PARSED,
			// never verbatim (#33 + operator round C): the curated keys – the
			// metadata editor's fields, the trust family, and the derived graph
			// lists the References pane reads – plus scalar/string-array §4.1
			// extension keys (curateFrontmatter's pass-through).
			return c.json({
				path: doc.path,
				frontmatter: curateFrontmatter(doc.frontmatter),
				markdown: doc.markdown,
				hash: docHash(doc.markdown),
			});
		} catch (e) {
			if (e instanceof DocPathError) return c.json({ error: e.message }, 400);
			if (e instanceof DocNotFoundError)
				return c.json({ error: "doc not found" }, 404);
			throw e;
		}
	});

	app.put("/api/docs/*", async (c) => {
		let docPath: string;
		try {
			docPath = decodeURIComponent(c.req.path.slice(DOCS_PREFIX.length));
		} catch {
			return c.json({ error: "invalid doc path" }, 400);
		}
		let payload: { markdown?: unknown; baseHash?: unknown; verified?: unknown };
		try {
			payload = (await c.req.json()) as typeof payload;
		} catch {
			return c.json({ error: "invalid request body" }, 400);
		}
		if (
			typeof payload.markdown !== "string" ||
			typeof payload.baseHash !== "string"
		) {
			return c.json({ error: "markdown and baseHash are required" }, 400);
		}
		// #33 (A1): Save as Verified – the verified event rides the save's
		// own commit (writeDoc's OKF half appends it beside the generated
		// stamp). Non-OKF repos ignore the flag entirely.
		if (payload.verified !== undefined && typeof payload.verified !== "boolean")
			return c.json({ error: "verified must be a boolean" }, 400);
		try {
			const { sha, hash } = await writeDoc(
				ctx.repoRoot,
				ctx.docsRoot,
				docPath,
				payload.markdown,
				payload.baseHash,
				commitAuthor(c),
				payload.verified ? { verified: true } : {},
			);
			return c.json({ sha, hash });
		} catch (e) {
			if (e instanceof DocPathError) return c.json({ error: e.message }, 400);
			if (e instanceof DocNotFoundError)
				return c.json({ error: "doc not found" }, 404);
			if (e instanceof StaleDocError)
				return c.json({ error: "doc changed since load – reload" }, 409);
			if (e instanceof GitIdentityError)
				return c.json({ error: "git identity not configured" }, 409);
			throw e;
		}
	});

	// --- M3: file lifecycle, branches, sync ---------------------------------

	app.post("/api/docs", async (c) => {
		const body = await jsonBody(c);
		if (body === null) return c.json({ error: "invalid request body" }, 400);
		if (typeof body.path !== "string")
			return c.json({ error: "path is required" }, 400);
		if (body.body !== undefined && typeof body.body !== "string")
			return c.json({ error: "body must be a string" }, 400);
		try {
			const { sha } = await createDoc(
				ctx.repoRoot,
				ctx.docsRoot,
				body.path,
				typeof body.body === "string" ? body.body : "",
				commitAuthor(c),
			);
			return c.json({ sha });
		} catch (e) {
			return respondFileError(c, e);
		}
	});

	// M4-3 b4 + #33: the doc PATCH is a three-way dispatch – {to} moves the
	// file (M3), {title} writes the frontmatter title (rename, path
	// unchanged), {meta} writes the metadata editor's fields. Exactly one
	// action per call.
	app.patch("/api/docs/*", async (c) => {
		const from = tailPath(c, DOCS_PREFIX);
		if (from === undefined) return c.json({ error: "invalid doc path" }, 400);
		const body = await jsonBody(c);
		if (body === null) return c.json({ error: "invalid request body" }, 400);
		const picked = (["to", "title", "meta"] as const).filter(
			(k) => body[k] !== undefined,
		);
		if (picked.length !== 1)
			return c.json(
				{ error: "exactly one of to, title, or meta is required" },
				400,
			);
		if (picked[0] === "meta") {
			// #33 (D2): the metadata editor's one-commit field write. The
			// allowlist is the five curated editor keys PLUS any additional
			// §4.1 extension key matching the core seam's grammar (operator
			// round C – producers may carry any frontmatter keys); values are
			// string | null | string[] (tags), and null/empty REMOVES the key
			// (setFrontmatterKeys' rule). Managed keys (derived/owned by other
			// flows) are a 400, never a write; `status` is enum-only (A2) and
			// unsafe key names die here or at the core seam – OkfFieldError
			// maps to 400 below, before any byte is touched.
			const meta = body.meta;
			if (typeof meta !== "object" || meta === null || Array.isArray(meta))
				return c.json({ error: "meta must be an object" }, 400);
			const edits: FrontmatterEdit[] = [];
			for (const [key, value] of Object.entries(meta)) {
				if (MANAGED_META_KEYS.has(key))
					return c.json({ error: `${key} is a managed key` }, 400);
				const curated = META_EDITOR_KEYS.includes(key);
				if (!curated && !isFrontmatterKey(key))
					return c.json({ error: `unknown meta key: ${key}` }, 400);
				if (value === null) {
					edits.push({ key, value: null });
					continue;
				}
				if (key === "tags") {
					if (!Array.isArray(value) || value.some((v) => typeof v !== "string"))
						return c.json({ error: "tags must be an array of strings" }, 400);
					edits.push({ key, list: value });
					continue;
				}
				if (typeof value !== "string")
					return c.json({ error: `${key} must be a string or null` }, 400);
				edits.push({ key, value });
			}
			try {
				const { sha } = await setDocMeta(
					ctx.repoRoot,
					ctx.docsRoot,
					from,
					edits,
					commitAuthor(c),
				);
				return c.json({ sha });
			} catch (e) {
				return respondFileError(c, e);
			}
		}
		if (picked[0] === "title") {
			if (typeof body.title !== "string" || !body.title.trim())
				return c.json({ error: "title must be a non-empty string" }, 400);
			try {
				const { sha } = await setTitle(
					ctx.repoRoot,
					ctx.docsRoot,
					from,
					body.title,
					commitAuthor(c),
				);
				return c.json({ sha });
			} catch (e) {
				return respondFileError(c, e);
			}
		}
		if (typeof body.to !== "string")
			return c.json({ error: "to is required" }, 400);
		try {
			const { sha } = await moveDoc(
				ctx.repoRoot,
				ctx.docsRoot,
				from,
				body.to,
				commitAuthor(c),
			);
			return c.json({ sha });
		} catch (e) {
			return respondFileError(c, e);
		}
	});

	app.delete("/api/docs/*", async (c) => {
		const docPath = tailPath(c, DOCS_PREFIX);
		if (docPath === undefined)
			return c.json({ error: "invalid doc path" }, 400);
		try {
			const { sha } = await deleteDoc(
				ctx.repoRoot,
				ctx.docsRoot,
				docPath,
				commitAuthor(c),
			);
			return c.json({ sha });
		} catch (e) {
			return respondFileError(c, e);
		}
	});

	app.post("/api/folders", async (c) => {
		const body = await jsonBody(c);
		if (body === null) return c.json({ error: "invalid request body" }, 400);
		if (typeof body.path !== "string")
			return c.json({ error: "path is required" }, 400);
		try {
			const { sha } = await createFolder(
				ctx.repoRoot,
				ctx.docsRoot,
				body.path,
				commitAuthor(c),
			);
			return c.json({ sha });
		} catch (e) {
			return respondFileError(c, e);
		}
	});

	app.patch("/api/folders/*", async (c) => {
		const from = tailPath(c, FOLDERS_PREFIX);
		if (from === undefined) return c.json({ error: "invalid doc path" }, 400);
		const body = await jsonBody(c);
		if (body === null) return c.json({ error: "invalid request body" }, 400);
		if (typeof body.to !== "string")
			return c.json({ error: "to is required" }, 400);
		try {
			const { sha } = await renameFolder(
				ctx.repoRoot,
				ctx.docsRoot,
				from,
				body.to,
				commitAuthor(c),
			);
			return c.json({ sha });
		} catch (e) {
			return respondFileError(c, e);
		}
	});

	app.delete("/api/folders/*", async (c) => {
		const folderPath = tailPath(c, FOLDERS_PREFIX);
		if (folderPath === undefined)
			return c.json({ error: "invalid doc path" }, 400);
		try {
			const { sha } = await deleteFolder(
				ctx.repoRoot,
				ctx.docsRoot,
				folderPath,
				commitAuthor(c),
			);
			return c.json({ sha });
		} catch (e) {
			return respondFileError(c, e);
		}
	});

	// --- M4-3 b6: raw files (non-md link targets) ----------------------------

	/** Extension → content type for /api/raw. html/svg serve as text/plain –
	 *  repo content never executes in the app origin; anything unmapped is
	 *  application/octet-stream with Content-Disposition (a download). */
	const RAW_MIME: Record<string, string> = {
		md: "text/markdown; charset=utf-8",
		txt: "text/plain; charset=utf-8",
		png: "image/png",
		jpg: "image/jpeg",
		jpeg: "image/jpeg",
		gif: "image/gif",
		webp: "image/webp",
		svg: "text/plain; charset=utf-8",
		pdf: "application/pdf",
		json: "application/json",
		csv: "text/csv",
		html: "text/plain; charset=utf-8",
		htm: "text/plain; charset=utf-8",
	};

	// The resolveDocPath containment guard (kind "raw" – no .md constraint),
	// files-only: a directory or a missing path is a 404 like the doc routes.
	// startServer's raw-URL `..` guard covers this prefix too (below).
	app.get("/api/raw/*", (c) => {
		let rawPath: string;
		try {
			rawPath = decodeURIComponent(c.req.path.slice(RAW_PREFIX.length));
		} catch {
			return c.json({ error: "invalid path" }, 400);
		}
		let abs: string;
		try {
			abs = resolveDocPath(ctx.repoRoot, ctx.docsRoot, rawPath, "raw");
		} catch (e) {
			if (e instanceof DocPathError) return c.json({ error: e.message }, 400);
			throw e;
		}
		if (!existsSync(abs) || !statSync(abs).isFile()) {
			return c.json({ error: "not found" }, 404);
		}
		const bytes = new Uint8Array(readFileSync(abs));
		const ext = abs.split(".").pop()?.toLowerCase() ?? "";
		const mime = RAW_MIME[ext];
		if (mime) return c.body(bytes, 200, { "content-type": mime });
		return c.body(bytes, 200, {
			"content-type": "application/octet-stream",
			"content-disposition": "attachment",
		});
	});

	app.get("/api/branches", async (c) =>
		c.json({
			current: await currentBranch(ctx.repoRoot),
			branches: await listBranches(ctx.repoRoot),
		}),
	);

	app.post("/api/branches", async (c) => {
		const body = await jsonBody(c);
		if (body === null) return c.json({ error: "invalid request body" }, 400);
		if (typeof body.name !== "string" || badBranchName(body.name))
			return c.json({ error: "invalid branch name" }, 400);
		if (
			body.base !== undefined &&
			(typeof body.base !== "string" || badBranchName(body.base))
		)
			return c.json({ error: "invalid branch name" }, 400);
		try {
			// Spec's "createBranch (+ checkout)", boring reading: always create
			// then switch. `base` pins the start point via a checkout (default: HEAD).
			if (typeof body.base === "string")
				await checkoutBranch(ctx.repoRoot, body.base);
			await createBranch(ctx.repoRoot, body.name);
			await checkoutBranch(ctx.repoRoot, body.name);
			return c.json({ current: await currentBranch(ctx.repoRoot) });
		} catch (e) {
			return respondGitError(c, e);
		}
	});

	app.post("/api/checkout", async (c) => {
		const body = await jsonBody(c);
		if (body === null) return c.json({ error: "invalid request body" }, 400);
		if (typeof body.name !== "string")
			return c.json({ error: "name is required" }, 400);
		if (badBranchName(body.name))
			return c.json({ error: "invalid branch name" }, 400);
		try {
			await checkoutBranch(ctx.repoRoot, body.name);
			return c.json({ current: await currentBranch(ctx.repoRoot) });
		} catch (e) {
			return respondGitError(c, e);
		}
	});

	// `:name` is single-segment by design – slashed names (drafts/x) arrive
	// percent-encoded (%2F) and stay one segment for the router; Hono decodes
	// the param value for us.
	app.delete("/api/branches/:name", async (c) => {
		const name = c.req.param("name");
		if (badBranchName(name))
			return c.json({ error: "invalid branch name" }, 400);
		try {
			if (name === (await currentBranch(ctx.repoRoot)))
				return c.json({ error: "switch away first" }, 400);
			await deleteBranch(
				ctx.repoRoot,
				name,
				c.req.query("force") !== undefined,
			);
			return c.json({ ok: true });
		} catch (e) {
			// Unmerged without force is a client-decidable state, not an error:
			// git's own words ride the 409 so the UI can ask about a force delete.
			if (
				e instanceof GitError &&
				/not (fully )?merged/i.test(`${e.stdout}\n${e.stderr}`)
			)
				return c.json({ unmerged: true, error: e.message }, 409);
			return respondGitError(c, e);
		}
	});

	// --- M4-2: meta, drafting, merge, restore -------------------------------

	// Unauthenticated by design (the gate exempts it): the Docker HEALTHCHECK
	// has no session, and {ok:true} leaks nothing.
	app.get("/api/health", (c) => c.json({ ok: true }));

	app.get("/api/meta", async (c) => {
		const meta = await repoMeta(ctx.repoRoot, ctx.docsRoot);
		// Explicit .fragmt.json authors entries override derived mappings; the
		// merge happens server-side so core/meta stays free of auth state.
		return c.json({
			...meta,
			authors: { ...verifiedEmailLogins(), ...meta.authors },
		});
	});

	// OKF rungs 1–2 (#21): the sidebar banner's data – the §11 findings over
	// the shared enumeration. Non-OKF repos answer {okf:false} with no scan.
	// Read-only and param-free: nothing request-shaped reaches the walk.
	app.get("/api/validate", async (c) => {
		if (!okfEnabled(ctx.repoRoot)) return c.json({ okf: false });
		const { conformant, findings } = await validateOkf(
			ctx.repoRoot,
			ctx.docsRoot,
		);
		return c.json({ okf: true, conformant, findings });
	});

	// Search (#14): a thin GET over the core's flat scan. `q` missing is a
	// 400; present-but-short is searchDocs' own empty array, not an error.
	app.get("/api/search", async (c) => {
		const q = c.req.query("q");
		if (q === undefined) return c.json({ error: "q is required" }, 400);
		return c.json(await searchDocs(ctx.repoRoot, ctx.docsRoot, q));
	});

	app.post("/api/draft", async (c) => {
		const body = await jsonBody(c);
		if (body === null) return c.json({ error: "invalid request body" }, 400);
		// The branch name is generated (slug-safe), so only the doc path needs
		// a shape check here.
		if (typeof body.docPath !== "string" || body.docPath === "")
			return c.json({ error: "docPath is required" }, 400);
		try {
			return c.json(await startDraft(ctx.repoRoot, body.docPath, ctx.docsRoot));
		} catch (e) {
			return respondGitError(c, e);
		}
	});

	// #18: the draft gutter's payload – body-relative changed lines for one
	// doc on the current draft branch ([] on main / mid-merge / no diff).
	// Existence is a 404 like the doc routes; resolveDocPath is the traversal
	// guard (the raw-URL `..` prefilter below covers /api/docs|folders|raw
	// only, so this route leans on it directly).
	app.get(`${DRAFT_DIFF_PREFIX}*`, async (c) => {
		const docPath = tailPath(c, DRAFT_DIFF_PREFIX);
		if (docPath === undefined || docPath === "")
			return c.json({ error: "invalid doc path" }, 400);
		let abs: string;
		try {
			abs = resolveDocPath(ctx.repoRoot, ctx.docsRoot, docPath);
		} catch (e) {
			if (e instanceof DocPathError) return c.json({ error: e.message }, 400);
			throw e;
		}
		if (!existsSync(abs) || !statSync(abs).isFile())
			return c.json({ error: "doc not found" }, 404);
		return c.json({
			doc: docPath,
			lines: await draftDiffLines(ctx.repoRoot, ctx.docsRoot, docPath),
		});
	});

	app.post("/api/merge", async (c) => {
		try {
			const result = await mergeToMain(ctx.repoRoot, ctx.docsRoot);
			// The conflict is a returned value, not a throw – map it to 409 with
			// the b2 shape verbatim: stood:true {branch, files} (the UI enters
			// resolution mode) or stood:false {files, message} (the honest
			// terminal-reconcile fallback).
			if (!result.merged) return c.json(result, 409);
			return c.json(result);
		} catch (e) {
			if (e instanceof OnMainBranchError)
				return c.json({ error: "nothing to merge – already on main" }, 400);
			return respondGitError(c, e);
		}
	});

	// --- M4-4 b3: the standing merge's resolution surface --------------------

	// Full detail (hunks for docs, summaries for sidecars); the object itself
	// when nothing stands – {inMerge:false}, not an error (meta's summary is
	// the on-switch, this is the payload).
	app.get("/api/merge", async (c) =>
		c.json(await mergeState(ctx.repoRoot, ctx.docsRoot)),
	);

	app.put("/api/merge/resolve", async (c) => {
		const body = await jsonBody(c);
		if (body === null) return c.json({ error: "invalid request body" }, 400);
		if (typeof body.path !== "string" || body.path === "")
			return c.json({ error: "path is required" }, 400);
		const hasContent = body.content !== undefined;
		const hasChoice = body.choice !== undefined;
		if (hasContent === hasChoice)
			return c.json(
				{ error: "exactly one of content or choice is required" },
				400,
			);
		if (hasContent && typeof body.content !== "string")
			return c.json({ error: "content must be a string" }, 400);
		if (
			hasChoice &&
			!["merged", "ours", "theirs"].includes(body.choice as string)
		)
			return c.json({ error: "choice must be merged, ours, or theirs" }, 400);
		if (!inMerge(ctx.repoRoot))
			return c.json({ error: "no merge is in progress" }, 409);
		// Containment: paths are repo-root-relative POSIX straight from git, and
		// membership in the LIVE unmerged set is the check – a stale UI file
		// list (resolved elsewhere) can never reach the disk.
		if (!(await unmergedPaths(ctx.repoRoot)).includes(body.path))
			return c.json({ error: "path is not part of the standing merge" }, 409);
		try {
			if (hasContent)
				await resolveMergeDoc(ctx.repoRoot, body.path, body.content as string);
			else
				await resolveMergeSidecar(
					ctx.repoRoot,
					body.path,
					body.choice as "merged" | "ours" | "theirs",
				);
		} catch (e) {
			return respondGitError(c, e);
		}
		return c.json({ remaining: (await unmergedPaths(ctx.repoRoot)).length });
	});

	app.post("/api/merge/conclude", async (c) => {
		if (!inMerge(ctx.repoRoot))
			return c.json({ error: "no merge is in progress" }, 409);
		try {
			const result = await concludeMerge(ctx.repoRoot);
			// OKF (#21): the merge settled membership across the branch boundary
			// – recompute the references graph and regenerate the indexes once
			// (mechanical index.md conflicts heal by regeneration), in the
			// regen's own commit. Non-OKF repos never reach it.
			if (okfEnabled(ctx.repoRoot))
				await populateOkf(ctx.repoRoot, ctx.docsRoot, commitAuthor(c));
			return c.json(result);
		} catch (e) {
			if (e instanceof MergeUnresolvedError)
				return c.json({ error: e.message }, 409);
			return respondGitError(c, e);
		}
	});

	app.post("/api/merge/abort", async (c) => {
		if (!inMerge(ctx.repoRoot))
			return c.json({ error: "no merge is in progress" }, 409);
		try {
			await abortMerge(ctx.repoRoot);
		} catch (e) {
			return respondGitError(c, e);
		}
		return c.json({ ok: true });
	});

	app.post("/api/restore", async (c) => {
		const body = await jsonBody(c);
		if (body === null) return c.json({ error: "invalid request body" }, 400);
		if (typeof body.path !== "string" || typeof body.sha !== "string")
			return c.json({ error: "path and sha are required" }, 400);
		try {
			return c.json(
				await restoreDoc(
					ctx.repoRoot,
					ctx.docsRoot,
					body.path,
					body.sha,
					commitAuthor(c),
				),
			);
		} catch (e) {
			return respondFileError(c, e);
		}
	});

	app.post("/api/sync", async (c) => {
		try {
			return c.json(await sync(ctx.repoRoot));
		} catch (e) {
			// A rejected push (non-fast-forward) is a conflict signal, not a server
			// error: the next sync's pull --rebase surfaces the real conflict.
			if (
				e instanceof GitError &&
				/non-fast-forward|failed to push some refs/.test(e.stderr)
			) {
				return c.json({ conflict: true, message: e.stderr.trim() });
			}
			return respondGitError(c, e);
		}
	});

	// Anything else under /api is a 404.
	app.all("/api/*", (c) => c.json({ error: "not found" }, 404));

	// Built UI (production). Resolved against this module, not process.cwd() –
	// `fragmt serve` runs inside the user's docs repo, not the install dir.
	// Dev uses the Vite server with an /api proxy instead.
	app.use("/*", serveStatic({ root: UI_DIST }));

	return app;
}

/** Decode the wildcard tail of a route path; undefined on malformed encoding. */
function tailPath(c: Context<AppEnv>, prefix: string): string | undefined {
	try {
		return decodeURIComponent(c.req.path.slice(prefix.length));
	} catch {
		return undefined;
	}
}

/** The metadata editor's five curated keys (#33, D2). */
const META_EDITOR_KEYS = [
	"type",
	"description",
	"tags",
	"status",
	"stale_after",
];
/** Keys a {meta} write may never touch (operator round C): derived
 *  (references/referenced-by = the graph), append-only (verified), stamped
 *  (generated), owned by the rename flow (title), or the bundle's own
 *  (okf_version, §12). A write to one is a 400 `managed key`, never a
 *  splice. */
const MANAGED_META_KEYS = new Set([
	"generated",
	"verified",
	"references",
	"referenced-by",
	"title",
	"okf_version",
]);

/** The doc payload's `frontmatter` (#33 + operator round C): the curated
 *  keys – `title` (the display-name model) plus the OKF editor/trust
 *  fields, normalized through their core readers (refsList,
 *  verifiedEvents – hand-mangled shapes read as empty, never throw) and
 *  omitted when empty, the updateRefsField rule – and, beyond them, every
 *  OTHER §4.1 extension key with a scalar or string-array value, passed
 *  through PARSED (still never the raw YAML bytes; objects and mixed
 *  arrays stay home). The managed set keeps its curated treatment above –
 *  those keys never arrive as editable extensions – so a doc carrying only
 *  `title` serializes exactly as it did before rung 3. */
function curateFrontmatter(
	fm: Record<string, unknown>,
): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const key of ["title", "type", "description", "status", "stale_after"]) {
		if (key in fm) out[key] = fm[key];
	}
	const generated = fm.generated;
	if (
		typeof generated === "object" &&
		generated !== null &&
		typeof (generated as { by?: unknown }).by === "string"
	)
		out.generated = generated;
	const verified = verifiedEvents(fm.verified);
	if (verified.length > 0) out.verified = verified;
	const tags = refsList(fm.tags);
	if (tags.length > 0) out.tags = tags;
	for (const key of ["references", "referenced-by"] as const) {
		const list = refsList(fm[key]);
		if (list.length > 0) out[key] = list;
	}
	for (const [key, value] of Object.entries(fm)) {
		if (
			key in out ||
			META_EDITOR_KEYS.includes(key) ||
			MANAGED_META_KEYS.has(key)
		)
			continue;
		if (
			value === null ||
			typeof value === "string" ||
			typeof value === "number" ||
			typeof value === "boolean" ||
			(Array.isArray(value) && value.every((v) => typeof v === "string"))
		)
			out[key] = value;
	}
	return out;
}

/** Parse a JSON object body; null when absent, malformed, or not an object. */
async function jsonBody(
	c: Context<AppEnv>,
): Promise<Record<string, unknown> | null> {
	try {
		const parsed: unknown = await c.req.json();
		return typeof parsed === "object" && parsed !== null
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

/**
 * Map core file-op errors to responses, mirroring the PUT /api/docs/* handler
 * (DocPathError 400, DocNotFound/ThreadNotFound 404, exists/identity/stale
 * 409). OkfFieldError (a `status` outside the enum, A2) is a 400 like
 * DocPathError – the seam rejected it before any byte was written. Unmapped
 * errors propagate to Hono's default 500.
 */
function respondFileError(c: Context<AppEnv>, e: unknown): Response {
	if (e instanceof OkfFieldError) return c.json({ error: e.message }, 400);
	if (e instanceof DocPathError) return c.json({ error: e.message }, 400);
	if (e instanceof DocNotFoundError)
		return c.json({ error: "doc not found" }, 404);
	if (e instanceof ThreadNotFoundError)
		return c.json({ error: "thread not found" }, 404);
	if (e instanceof PathExistsError) return c.json({ error: e.message }, 409);
	if (e instanceof GitIdentityError)
		return c.json({ error: "git identity not configured" }, 409);
	if (e instanceof StaleDocError)
		return c.json({ error: "doc changed since load – reload" }, 409);
	throw e;
}

/** GitError → 500 { error }; git stays the authority on exotic branch names. */
function respondGitError(c: Context<AppEnv>, e: unknown): Response {
	if (e instanceof GitError) return c.json({ error: e.message }, 500);
	throw e;
}

/** Cheap reject of branch names git can never accept (empty, spaces, "..", leading "-", control chars). */
function badBranchName(name: string): boolean {
	return (
		name === "" ||
		name.startsWith("-") ||
		name.includes("..") ||
		// biome-ignore lint/suspicious/noControlCharactersInRegex: the point – control chars can never be branch names
		/[\s\u0000-\u001f\u007f]/.test(name)
	);
}

/**
 * Traversal check on the raw request line, decoded once so `..%2f` and `%2e%2e`
 * are caught alongside a literal `..`. Malformed encoding is itself a reject –
 * we cannot tell what it would mean downstream.
 */
function isTraversalAttempt(url: string): boolean {
	if (
		![DOCS_PREFIX, FOLDERS_PREFIX, RAW_PREFIX].some((prefix) =>
			url.startsWith(prefix),
		)
	)
		return false;
	try {
		return decodeURIComponent(url).includes("..");
	} catch {
		return true;
	}
}

/**
 * Start the HTTP server. A raw-URL guard rejects `..` in doc/folder/raw
 * requests before the framework's spec-compliant URL normalization collapses
 * the segments
 * (without this, literal `/api/docs/../LICENSE` normalizes to a 404 instead of
 * the spec-required 400). The rest is delegated to @hono/node-server unchanged.
 * `host` pins the interface: loopback for plain serve (default), all
 * interfaces for --auth (the resolved contract comes from the CLI).
 */
export function startServer(
	app: Hono<AppEnv>,
	port: number,
	onListening: (port: number) => void,
	host = "127.0.0.1",
): Server {
	const listener = getRequestListener(app.fetch);
	const server = createServer((req, res) => {
		if (isTraversalAttempt(req.url ?? "")) {
			res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
			res.end(JSON.stringify({ error: "invalid doc path" }));
			return;
		}
		listener(req, res);
	});
	server.listen(port, host, () => {
		const addr = server.address();
		onListening(typeof addr === "object" && addr ? addr.port : port);
	});
	return server;
}
