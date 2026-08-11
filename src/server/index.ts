import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import { getRequestListener } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import {
	DocNotFoundError,
	DocPathError,
	listTree,
	readDoc,
} from "../core/index.js";

export interface ServerContext {
	repoRoot: string;
	docsRoot: string;
}

const DOCS_PREFIX = "/api/docs/";

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
			});
		} catch (e) {
			if (e instanceof DocPathError) return c.json({ error: e.message }, 400);
			if (e instanceof DocNotFoundError)
				return c.json({ error: "doc not found" }, 404);
			throw e;
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

/**
 * Traversal check on the raw request line, decoded once so `..%2f` and `%2e%2e`
 * are caught alongside a literal `..`. Malformed encoding is itself a reject —
 * we cannot tell what it would mean downstream.
 */
function isTraversalAttempt(url: string): boolean {
	if (!url.startsWith(DOCS_PREFIX)) return false;
	try {
		return decodeURIComponent(url).includes("..");
	} catch {
		return true;
	}
}

/**
 * Start the HTTP server. A raw-URL guard rejects `..` in doc requests before
 * the framework's spec-compliant URL normalization collapses the segments
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
