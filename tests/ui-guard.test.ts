// @vitest-environment happy-dom
//
// Component harness for the two shipped navigation regressions (the house
// suite covers pure logic + server routes only):
//   1. the sidebar card click and the folder-link click were unguarded
//      navigation seams – unsaved edits were silently dropped on doc switch
//      (fixed by wrapping both in App's guardAction, 3f1c5a3);
//   2. a clean-buffer doc switch inherited the previous doc's edit mode
//      (fixed: DocView exits editing on a `selected` change).
// The App-level tests mount the real App against a stubbed window.fetch
// serving the exact payload shapes ui/src/api.ts consumes (everything 200 –
// only the success paths are under test); the DocView-level ones pin the two
// component contracts (metadata edits dirty the buffer; a `selected` change
// exits edit mode) without any fetch plumbing.
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { type ComponentProps, createElement } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { App } from "../ui/src/App.js";
import type {
	DocGraph,
	DocResponse,
	RepoMeta,
	TreeNode,
} from "../ui/src/api.js";
import { DocView } from "../ui/src/DocView.js";
import { GraphView } from "../ui/src/GraphView.js";

// RTL wraps render/fireEvent/waitFor in act; React 19 requires the flag.
(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// --- the mocked backend: one URL-routed map of real payload shapes ---------

const TREE: TreeNode = {
	name: "",
	path: "",
	type: "dir",
	children: [
		{ name: "a.md", path: "a.md", type: "doc" },
		{ name: "b.md", path: "b.md", type: "doc" },
		{
			name: "sub",
			path: "sub",
			type: "dir",
			children: [{ name: "c.md", path: "sub/c.md", type: "doc" }],
		},
	],
};

// `current` != `main` puts App off-main: the Edit flip skips the draft dance
// (beforeEdit just syncs) while meta.okf switches the metadata block on.
const META: RepoMeta = {
	main: "main",
	current: "work",
	docs: {
		"a.md": {
			author: "Tester",
			authorEmail: "",
			date: "2026-09-01T00:00:00Z",
			version: 1,
			snippet: "first",
			title: null,
			okf: {
				type: "concept",
				status: "draft",
				tier: "unverified",
				staleAfter: null,
			},
		},
		"b.md": {
			author: "Tester",
			authorEmail: "",
			date: "2026-09-02T00:00:00Z",
			version: 1,
			snippet: "second",
			title: null,
			okf: {
				type: "concept",
				status: "draft",
				tier: "unverified",
				staleAfter: null,
			},
		},
	},
	drafts: {},
	deleted: [],
	authors: {},
	agents: [],
	okf: true,
	merge: null,
};

const BRANCHES = { current: "work", branches: ["main", "work"] };

const VALIDATE = { okf: true, conformant: true, findings: [] };

function docOf(path: string, markdown: string): DocResponse {
	return {
		path,
		frontmatter: { description: "original description", status: "draft" },
		markdown,
		hash: `hash-${path}`,
	};
}

// a.md's body carries a folder link (sub/ resolves through the tree's known
// folders – M4-3 b6); tests 1–2 simply never click it.
const DOCS: Record<string, DocResponse> = {
	"a.md": docOf("a.md", "Body of a. See [sub docs](sub/)."),
	"b.md": docOf("b.md", "Body of b."),
	"sub/c.md": docOf("sub/c.md", "Body of c."),
};

function jsonResponse(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

function notFound(what: string): Response {
	return new Response(JSON.stringify({ error: `not mocked: ${what}` }), {
		status: 404,
		headers: { "content-type": "application/json" },
	});
}

async function mockFetch(input: RequestInfo | URL): Promise<Response> {
	const url = new URL(String(input), "http://localhost");
	if (url.pathname === "/api/tree") return jsonResponse(TREE);
	if (url.pathname === "/api/branches") return jsonResponse(BRANCHES);
	if (url.pathname === "/api/meta") return jsonResponse(META);
	if (url.pathname === "/api/validate") return jsonResponse(VALIDATE);
	if (url.pathname === "/api/sync") return jsonResponse({ conflict: false });
	// The graph lens fetches on open; the body carries the okf flag beside
	// the graph itself (fetchGraph drops non-OKF answers to null).
	if (url.pathname === "/api/graph")
		return jsonResponse({ okf: true, ...GRAPH });
	const comments = url.pathname.match(/^\/api\/docs\/(.+)\/comments$/);
	if (comments) return jsonResponse({ comments: {} });
	const doc = url.pathname.match(/^\/api\/docs\/(.+)$/);
	if (doc) {
		const payload = DOCS[decodeURIComponent(doc[1])];
		return payload ? jsonResponse(payload) : notFound(url.pathname);
	}
	return notFound(url.pathname);
}

/** mockFetch with the OKF gate's two inputs overridden independently – the
 *  entry button reads meta.okf AND validate.okf, each alone off must hide it. */
function fetchWith(opts: { metaOkf?: boolean; validateOkf?: boolean }) {
	const meta = { ...META, okf: opts.metaOkf ?? true };
	const validate = { ...VALIDATE, okf: opts.validateOkf ?? true };
	return async (input: RequestInfo | URL): Promise<Response> => {
		const url = new URL(String(input), "http://localhost");
		if (url.pathname === "/api/meta") return jsonResponse(meta);
		if (url.pathname === "/api/validate") return jsonResponse(validate);
		return mockFetch(input);
	};
}

beforeEach(() => {
	vi.stubGlobal("fetch", vi.fn(mockFetch));
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

// --- App-level helpers ------------------------------------------------------

/** Mount App and wait for the boot to settle: doc a.md auto-selected, read
 *  mode's Edit affordance rendered (the editor's readiness marker). */
async function renderAppReady() {
	const view = render(createElement(App));
	return view.findByRole("button", { name: "Edit" });
}

/** Flip into the unified edit session (off-main: a sync, no draft dance) and
 *  wait for edit mode's Cancel affordance. */
async function enterEditMode() {
	fireEvent.click(screen.getByRole("button", { name: "Edit" }));
	await screen.findByRole("button", { name: "Cancel" });
}

/** The metadata form's input for one curated key (edit mode: rows are
 *  label.meta-row > span.meta-key + input). */
function metaInput(key: string): HTMLInputElement {
	const keySpan = screen.getByText(`${key}:`);
	const row = keySpan.closest("label");
	const input = row?.querySelector("input");
	if (!input) throw new Error(`no metadata input for "${key}"`);
	return input;
}

function breadcrumbText(): string {
	return document.querySelector(".breadcrumb")?.textContent ?? "";
}

/** The sidebar's doc card (its title attribute is the tree path). */
function cardButton(path: string): HTMLElement {
	const card = document.querySelector<HTMLElement>(
		`button.doc-card[title="${path}"]`,
	);
	if (!card) throw new Error(`no sidebar card for "${path}"`);
	return card;
}

async function expectReadMode(path: string, bodyText: string) {
	const segs = path.replace(/\.md$/, "").split("/");
	// DocView's breadcrumb: directory segments joined with " / ", then the name.
	const crumb =
		segs.length > 1
			? `${segs.slice(0, -1).join(" / ")} / ${segs.at(-1)}`
			: (segs[0] ?? "");
	await waitFor(
		() => {
			expect(breadcrumbText()).toBe(crumb);
			expect(screen.getByText(bodyText)).toBeTruthy();
		},
		{ timeout: 3000 },
	);
	expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
	expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
	expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
}

// --- App-level regression seams ----------------------------------------------

describe("App: the dirty guard parks navigation (component harness)", () => {
	test("dirty metadata parks a card switch behind the save-or-discard banner; Discard completes it in read mode", async () => {
		await renderAppReady();
		await enterEditMode();

		// The regression's precondition: a metadata edit flips the dirty chain
		// (buffer OR metadata – operator round D's one seam).
		const description = metaInput("description");
		fireEvent.change(description, { target: { value: "changed description" } });

		// The card click must NOT navigate: doc a.md stays open, the banner
		// names the parked action and the cost.
		fireEvent.click(cardButton("b.md"));
		expect(await screen.findByText("Open b.md?")).toBeTruthy();
		expect(screen.getByText("This document has unsaved changes.")).toBeTruthy();
		expect(breadcrumbText()).toBe("a");

		// Discard: the switch completes – and the next doc opens in READ mode
		// (the session belonged to the doc it was discarded with).
		fireEvent.click(screen.getByRole("button", { name: "Discard" }));
		await expectReadMode("b.md", "Body of b.");
	});

	test("a clean-buffer switch from edit mode lands the next doc in read mode (D1)", async () => {
		await renderAppReady();
		await enterEditMode();

		// No buffer or metadata change: the guard lets the switch straight
		// through – and DocView must exit the edit session on the `selected`
		// change, or b.md would inherit a.md's editor state.
		fireEvent.click(cardButton("b.md"));
		await expectReadMode("b.md", "Body of b.");
	});

	test("a dirty buffer parks a folder-link switch behind the banner too", async () => {
		await renderAppReady();
		await enterEditMode();
		fireEvent.change(metaInput("description"), {
			target: { value: "changed description" },
		});

		// The folder link in a.md's body: sub/ resolves to the tree folder,
		// whose first doc is sub/c.md – the same guarded seam. The buffer is
		// dirty in EDIT mode here (metadata is the only way to get dirty), so
		// the click carries Ctrl – edit mode's follow modifier (a plain click
		// is cursor placement; folder links route to onSelectFolder in both
		// modes).
		const link = await waitFor(() => {
			const el = document.querySelector<HTMLAnchorElement>(
				'.edit-area a[href="sub/"]',
			);
			if (!el) throw new Error("folder link not rendered yet");
			return el;
		});
		fireEvent.click(link, { ctrlKey: true });
		expect(await screen.findByText("Open sub/c.md?")).toBeTruthy();
		expect(screen.getByText("This document has unsaved changes.")).toBeTruthy();
		expect(breadcrumbText()).toBe("a");

		fireEvent.click(screen.getByRole("button", { name: "Discard" }));
		await expectReadMode("sub/c.md", "Body of c.");
	});
});

// --- DocView-level contracts (no App, no fetch) ------------------------------

type DocViewProps = ComponentProps<typeof DocView>;

function docViewProps(over: Partial<DocViewProps> = {}): DocViewProps {
	const doc = over.doc ?? DOCS["a.md"];
	return {
		doc,
		selected: "a.md",
		onSaved: () => {},
		onReload: () => {},
		onDirtyChange: () => {},
		onCommentsChanged: () => {},
		onSpanClick: () => {},
		pendingAction: null,
		onPendingActionCancel: () => {},
		conflict: null,
		onDismissConflict: () => {},
		onEscapeSurfacesClear: () => false,
		onBeforeEdit: () => Promise.resolve(true),
		branch: "work",
		led: "green",
		ledLabel: "Synced",
		draftBranch: null,
		onOpenDraft: () => {},
		onDraft: false,
		authors: {},
		docs: [],
		onSelectDoc: () => {},
		onOpenPreview: () => {},
		onSelectFolder: () => {},
		pendingAnchor: null,
		onAnchorConsumed: () => {},
		folders: [],
		rootMoveValid: false,
		onBeforeRename: () => Promise.resolve(true),
		onMoveDoc: () => {},
		onDeleteDoc: () => {},
		onRenamed: () => {},
		okf: true,
		referencesOpen: false,
		onOpenReferences: () => {},
		...over,
	};
}

describe("DocView: the two component contracts", () => {
	test("a metadata input change reports dirty up to App (onDirtyChange(true))", async () => {
		const onDirtyChange = vi.fn();
		render(createElement(DocView, docViewProps({ onDirtyChange })));

		// Enter the unified session (the gate resolves true), then touch the
		// metadata form only – the buffer never changed.
		fireEvent.click(screen.getByRole("button", { name: "Edit" }));
		await screen.findByRole("button", { name: "Cancel" });
		expect(onDirtyChange).not.toHaveBeenCalledWith(true);

		fireEvent.change(metaInput("description"), {
			target: { value: "changed description" },
		});
		expect(onDirtyChange).toHaveBeenCalledWith(true);
	});

	test("a selected prop change exits edit mode (the clean-buffer rule)", async () => {
		const props = docViewProps();
		const view = render(createElement(DocView, props));
		fireEvent.click(screen.getByRole("button", { name: "Edit" }));
		await screen.findByRole("button", { name: "Cancel" });

		// Doc b.md selected: the session ends – no Cancel/Save carry over.
		view.rerender(
			createElement(DocView, { ...props, doc: DOCS["b.md"], selected: "b.md" }),
		);
		await waitFor(() => {
			expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
			expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
		});
		expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
	});
});

// --- rung 5 (#21): GraphView + the sidebar's graph entry ----------------------

// A small fixture payload in the exact shape /api/graph answers with.
const GRAPH: DocGraph = {
	nodes: [
		{
			path: "a.md",
			title: "A",
			type: "concept",
			status: "draft",
			tier: "unverified",
			stale: false,
		},
		{
			path: "b.md",
			title: "B",
			type: null,
			status: null,
			tier: "machine-confirmed",
			stale: true,
		},
		{
			path: "c.md",
			title: "C",
			type: "concept",
			status: "stable",
			tier: "human-reviewed",
			stale: false,
		},
	],
	edges: [{ from: "a.md", to: "b.md" }],
};

describe("GraphView: the fixture mount (component harness)", () => {
	beforeEach(() => {
		// The force loop runs in rAF; a no-op stub keeps the deterministic
		// seed layout on screen and React's act environment quiet.
		vi.stubGlobal(
			"requestAnimationFrame",
			vi.fn(() => 0),
		);
		vi.stubGlobal("cancelAnimationFrame", vi.fn());
	});

	test("mounts from a fixture DocGraph: the count line, every node, every label", () => {
		render(
			createElement(GraphView, {
				graph: GRAPH,
				onOpenDoc: () => {},
				onClose: () => {},
			}),
		);
		expect(screen.getByText("3 docs · 1 links")).toBeTruthy();
		expect(document.querySelectorAll(".gv-node")).toHaveLength(3);
		expect(screen.getByText("A")).toBeTruthy();
		expect(screen.getByText("B")).toBeTruthy();
		expect(screen.getByText("C")).toBeTruthy();
	});

	test("clicking a node invokes onOpenDoc with that path", () => {
		const onOpenDoc = vi.fn();
		render(
			createElement(GraphView, { graph: GRAPH, onOpenDoc, onClose: () => {} }),
		);
		const node = document.querySelectorAll(".gv-node")[0];
		if (!node) throw new Error("no graph nodes rendered");
		fireEvent.click(node);
		expect(onOpenDoc).toHaveBeenCalledTimes(1);
		expect(onOpenDoc).toHaveBeenCalledWith("a.md");
	});

	// The regression the early return fixes: the svg's pointerdown used to
	// capture the pointer unconditionally, so the browser's derived click
	// never reached the circle's onClick. Documents the guard's path: the
	// press bubbles to the svg handler, the click still opens the doc.
	test("a press that bubbles to the svg never eats the node's click (pointerDown then click)", () => {
		const onOpenDoc = vi.fn();
		render(
			createElement(GraphView, { graph: GRAPH, onOpenDoc, onClose: () => {} }),
		);
		const node = document.querySelectorAll(".gv-node")[0];
		if (!node) throw new Error("no graph nodes rendered");
		fireEvent.pointerDown(node);
		fireEvent.click(node);
		expect(onOpenDoc).toHaveBeenCalledTimes(1);
		expect(onOpenDoc).toHaveBeenCalledWith("a.md");
	});
});

describe("App: the graph entry + lens (rung 5)", () => {
	beforeEach(() => {
		// GraphView's force loop runs in rAF; a no-op stub keeps the
		// deterministic seed layout on screen and React's act environment
		// quiet while the lens is mounted inside App.
		vi.stubGlobal(
			"requestAnimationFrame",
			vi.fn(() => 0),
		);
		vi.stubGlobal("cancelAnimationFrame", vi.fn());
	});

	test("the head-row entry is present with okf on (findings []), opens the lens, and Close graph unmounts it", async () => {
		await renderAppReady();
		// The stubs answer okf (findings []): an OKF repo with nothing to
		// flag – the entry shows in the head row, the banner stays hidden.
		expect(screen.queryByText(/non-conformant/)).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Reference graph" }));

		expect(await screen.findByText("3 docs · 1 links")).toBeTruthy();
		expect(document.querySelector(".gv-pane")).toBeTruthy();

		// Exiting is always safe – no guard on close.
		fireEvent.click(screen.getByRole("button", { name: "Close graph" }));
		await waitFor(() => {
			expect(document.querySelector(".gv-pane")).toBeNull();
		});
	});

	test("the entry is absent when meta okf is off, and when validate answers not-okf", async () => {
		// meta okf false: App fetches no validate at all – the gate reads off.
		vi.stubGlobal("fetch", vi.fn(fetchWith({ metaOkf: false })));
		let view = render(createElement(App));
		await view.findByRole("button", { name: "Edit" });
		expect(
			screen.queryByRole("button", { name: "Reference graph" }),
		).toBeNull();
		cleanup();

		// validate {okf:false}: the fetch answers, the gate still reads off.
		vi.stubGlobal("fetch", vi.fn(fetchWith({ validateOkf: false })));
		view = render(createElement(App));
		await view.findByRole("button", { name: "Edit" });
		expect(
			screen.queryByRole("button", { name: "Reference graph" }),
		).toBeNull();
	});
});
