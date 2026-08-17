import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import { getRequestListener } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { type Context, Hono } from "hono";
import {
	checkoutBranch,
	createBranch,
	createDoc,
	createFolder,
	currentBranch,
	DocNotFoundError,
	DocPathError,
	deleteDoc,
	deleteFolder,
	docHash,
	GitError,
	GitIdentityError,
	listBranches,
	listTree,
	moveDoc,
	PathExistsError,
	readDoc,
	renameFolder,
	StaleDocError,
	sync,
	writeDoc,
} from "../core/index.js";

export interface ServerContext {
	repoRoot: string;
	docsRoot: string;
}

const DOCS_PREFIX = "/api/docs/";
const FOLDERS_PREFIX = "/api/folders/";

/** Package-root `ui/dist`. Same depth from `src/server/` (tsx) and `dist/server/` (built). */
const UI_DIST = fileURLToPath(new URL("../../ui/dist", import.meta.url));

/** Build the Hono app. Thin: parse request → call core → serialize. No fs/git here. */
export function createApp(ctx: ServerContext): Hono {
	const app = new Hono();

	app.get("/api/tree", (c) => c.json(listTree(ctx.repoRoot, ctx.docsRoot)));

	app.get("/api/docs/*", (c) => {
		let docPath: string;
		try {
			docPath = decodeURIComponent(c.req.path.slice(DOCS_PREFIX.length));
		} catch {
			return c.json({ error: "invalid doc path" }, 400);
		}
		try {
			const doc = readDoc(ctx.repoRoot, ctx.docsRoot, docPath);
			// rawFrontmatter held back from the UI in v1 (M2 reattaches it on save).
			return c.json({
				path: doc.path,
				frontmatter: doc.frontmatter,
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
		let payload: { markdown?: unknown; baseHash?: unknown };
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
		try {
			const { sha, hash } = await writeDoc(
				ctx.repoRoot,
				ctx.docsRoot,
				docPath,
				payload.markdown,
				payload.baseHash,
			);
			return c.json({ sha, hash });
		} catch (e) {
			if (e instanceof DocPathError) return c.json({ error: e.message }, 400);
			if (e instanceof DocNotFoundError)
				return c.json({ error: "doc not found" }, 404);
			if (e instanceof StaleDocError)
				return c.json({ error: "doc changed since load — reload" }, 409);
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
			);
			return c.json({ sha });
		} catch (e) {
			return respondFileError(c, e);
		}
	});

	app.patch("/api/docs/*", async (c) => {
		const from = tailPath(c, DOCS_PREFIX);
		if (from === undefined) return c.json({ error: "invalid doc path" }, 400);
		const body = await jsonBody(c);
		if (body === null) return c.json({ error: "invalid request body" }, 400);
		if (typeof body.to !== "string")
			return c.json({ error: "to is required" }, 400);
		try {
			const { sha } = await moveDoc(ctx.repoRoot, ctx.docsRoot, from, body.to);
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
			const { sha } = await deleteDoc(ctx.repoRoot, ctx.docsRoot, docPath);
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
			const { sha } = await createFolder(ctx.repoRoot, ctx.docsRoot, body.path);
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
			);
			return c.json({ sha });
		} catch (e) {
			return respondFileError(c, e);
		}
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

	// Built UI (production). Resolved against this module, not process.cwd() —
	// `fragmt serve` runs inside the user's docs repo, not the install dir.
	// Dev uses the Vite server with an /api proxy instead.
	app.use("/*", serveStatic({ root: UI_DIST }));

	return app;
}

/** Decode the wildcard tail of a route path; undefined on malformed encoding. */
function tailPath(c: Context, prefix: string): string | undefined {
	try {
		return decodeURIComponent(c.req.path.slice(prefix.length));
	} catch {
		return undefined;
	}
}

/** Parse a JSON object body; null when absent, malformed, or not an object. */
async function jsonBody(c: Context): Promise<Record<string, unknown> | null> {
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
 * (DocPathError 400, DocNotFound 404, exists/identity 409). Unmapped errors
 * propagate to Hono's default 500.
 */
function respondFileError(c: Context, e: unknown): Response {
	if (e instanceof DocPathError) return c.json({ error: e.message }, 400);
	if (e instanceof DocNotFoundError)
		return c.json({ error: "doc not found" }, 404);
	if (e instanceof PathExistsError) return c.json({ error: e.message }, 409);
	if (e instanceof GitIdentityError)
		return c.json({ error: "git identity not configured" }, 409);
	throw e;
}

/** GitError → 500 { error }; git stays the authority on exotic branch names. */
function respondGitError(c: Context, e: unknown): Response {
	if (e instanceof GitError) return c.json({ error: e.message }, 500);
	throw e;
}

/** Cheap reject of branch names git can never accept (empty, spaces, "..", leading "-", control chars). */
function badBranchName(name: string): boolean {
	return (
		name === "" ||
		name.startsWith("-") ||
		name.includes("..") ||
		// biome-ignore lint/suspicious/noControlCharactersInRegex: the point — control chars can never be branch names
		/[\s\u0000-\u001f\u007f]/.test(name)
	);
}

/**
 * Traversal check on the raw request line, decoded once so `..%2f` and `%2e%2e`
 * are caught alongside a literal `..`. Malformed encoding is itself a reject —
 * we cannot tell what it would mean downstream.
 */
function isTraversalAttempt(url: string): boolean {
	if (![DOCS_PREFIX, FOLDERS_PREFIX].some((prefix) => url.startsWith(prefix)))
		return false;
	try {
		return decodeURIComponent(url).includes("..");
	} catch {
		return true;
	}
}

/**
 * Start the HTTP server. A raw-URL guard rejects `..` in doc/folder requests
 * before the framework's spec-compliant URL normalization collapses the segments
 * (without this, literal `/api/docs/../LICENSE` normalizes to a 404 instead of
 * the spec-required 400). The rest is delegated to @hono/node-server unchanged.
 */
export function startServer(
	app: Hono,
	port: number,
	onListening: (port: number) => void,
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
	server.listen(port, () => {
		const addr = server.address();
		onListening(typeof addr === "object" && addr ? addr.port : port);
	});
	return server;
}
