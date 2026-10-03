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
	within,
} from "@testing-library/react";
import { type ComponentProps, createElement } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { App } from "../ui/src/App.js";
import { AuthGate } from "../ui/src/AuthGate.js";
import type {
	DocGraph,
	DocResponse,
	PrFile,
	PrSummary,
	RepoMeta,
	TreeNode,
} from "../ui/src/api.js";
import { DocView } from "../ui/src/DocView.js";
import { GraphView } from "../ui/src/GraphView.js";
import { hasHardWraps } from "../ui/src/hard-wraps.js";
import {
	type BranchAction,
	BranchMenu,
	OpenPRButton,
} from "../ui/src/Menus.js";

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

/** The navigator's doc row (ui v1: data-path carries the tree path – the
 *  title attribute is now the multi-line hover card). */
function cardButton(path: string): HTMLElement {
	const card = document.querySelector<HTMLElement>(
		`button.row[data-path="${path}"]`,
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

describe("DocView: the hard-wrap notice (owner round)", () => {
	test("entering edit mode on a hard-wrapped body pins the slim reflow notice above the editor", async () => {
		const doc = docOf("a.md", "first prose line\nsecond prose line");
		render(createElement(DocView, docViewProps({ doc })));
		// Read mode: no notice.
		expect(screen.queryByText(/hard-wrapped paragraphs/)).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Edit" }));
		await screen.findByRole("button", { name: "Cancel" });
		expect(screen.getByText(/hard-wrapped paragraphs/)).toBeTruthy();
	});

	test("an unwrapped body enters edit mode with no notice", async () => {
		render(createElement(DocView, docViewProps()));
		fireEvent.click(screen.getByRole("button", { name: "Edit" }));
		await screen.findByRole("button", { name: "Cancel" });
		expect(screen.queryByText(/hard-wrapped paragraphs/)).toBeNull();
	});
});

// --- the hard-wrap detector (owner round) --------------------------------------

describe("hasHardWraps", () => {
	test("a wrapped paragraph is true", () => {
		expect(hasHardWraps("first line of prose\nsecond line of prose")).toBe(
			true,
		);
	});

	test("single-line paragraphs are false", () => {
		expect(hasHardWraps("one paragraph\n\nanother paragraph")).toBe(false);
		expect(hasHardWraps("just one line")).toBe(false);
	});

	test("a wrapped code fence is false", () => {
		expect(hasHardWraps("```\nwrapped code\nover lines\n```")).toBe(false);
		expect(hasHardWraps("~~~\nwrapped code\nover lines\n~~~")).toBe(false);
	});

	test("list lines are false", () => {
		expect(hasHardWraps("- first\n- second\n- third")).toBe(false);
		expect(hasHardWraps("1. first\n2. second")).toBe(false);
	});

	test("a paragraph after a fence is still detected", () => {
		expect(hasHardWraps("```\ncode\n```\nprose line one\nprose line two")).toBe(
			true,
		);
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

// --- ui v1 phase 2: the rail, the navigator toggle, the status bar ----------

describe("App: the v1 shell (rail, navigator, status bar)", () => {
	function rail(): HTMLElement {
		return screen.getByRole("navigation", { name: "App" });
	}

	afterEach(() => {
		localStorage.removeItem("fragmt.sidebarCollapsed");
	});

	test("the rail carries Search and the gated Reference graph; Pull requests only with the PR surface", async () => {
		await renderAppReady();
		const r = rail();
		expect(
			within(r).getByRole("button", { name: "Search (Ctrl+K)" }),
		).toBeTruthy();
		expect(
			within(r).getByRole("button", { name: "Reference graph" }),
		).toBeTruthy();
		// Local mode: no auth, so no PR surface.
		expect(
			within(r).queryByRole("button", { name: "Pull requests" }),
		).toBeNull();
		cleanup();

		await renderAuthedApp(prFetch());
		expect(
			await within(rail()).findByRole("button", { name: "Pull requests" }),
		).toBeTruthy();
		cleanup();

		// Non-OKF meta: the graph entry is gone from the rail.
		vi.stubGlobal("fetch", vi.fn(fetchWith({ metaOkf: false })));
		const view = render(createElement(App));
		await view.findByRole("button", { name: "Edit" });
		expect(
			within(rail()).queryByRole("button", { name: "Reference graph" }),
		).toBeNull();
	});

	test("Ctrl+ toggles the navigator's collapsed class, and the choice persists across a remount", async () => {
		await renderAppReady();
		const nav = () => document.querySelector("aside.sidebar");
		expect(nav()?.classList.contains("collapsed")).toBe(false);

		fireEvent.keyDown(window, { key: "\\", ctrlKey: true });
		expect(nav()?.classList.contains("collapsed")).toBe(true);
		expect(localStorage.getItem("fragmt.sidebarCollapsed")).toBe("1");

		cleanup();
		await renderAppReady();
		expect(nav()?.classList.contains("collapsed")).toBe(true);

		fireEvent.keyDown(window, { key: "\\", metaKey: true });
		expect(nav()?.classList.contains("collapsed")).toBe(false);
		expect(localStorage.getItem("fragmt.sidebarCollapsed")).toBe("0");
	});

	test("the status bar reads OKF · 2 findings and opens the findings list", async () => {
		const findings = [
			{ path: "a.md", clause: "type", detail: "type is missing" },
			{ path: "b.md", clause: "frontmatter", detail: "no frontmatter" },
		];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL) => {
				const url = new URL(String(input), "http://localhost");
				if (url.pathname === "/api/validate")
					return jsonResponse({ okf: true, conformant: false, findings });
				return mockFetch(input);
			}),
		);
		await renderAppReady();
		const status = document.querySelector("footer.status") as HTMLElement;
		const btn = await within(status).findByRole("button", {
			name: /OKF · 2 findings/,
		});
		fireEvent.click(btn);
		expect(within(status).getByText("2 docs non-conformant")).toBeTruthy();
		expect(within(status).getByText("b.md")).toBeTruthy();
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

// --- #27 (b3): the PR entry points ---------------------------------------------
//
// The PR surface exists only under auth (App's useAuth() non-null) AND a
// github.com origin (GET /api/prs answers slug non-null) – the same fetch
// stubbing pattern as above, layered over mockFetch with a signed-in session
// and the b2 wire shapes.

const PR12: PrSummary = {
	number: 12,
	title: "Docs: the feat branch",
	state: "open",
	draft: false,
	mergeable: true,
	html_url: "https://github.com/o/r/pull/12",
	head: { ref: "feat", sha: "abc123" },
	base: { ref: "main" },
	user: { login: "tester" },
	changed_files: 2,
};

// b4: the detail's default file page – one parsed patch.
const PR_FILE: PrFile = {
	filename: "docs/a.md",
	status: "modified",
	additions: 2,
	deletions: 1,
	patch: "@@ -1,2 +1,3 @@\n body\n-old line\n+new line\n+another",
};

// current = "work": main is protected (no trash at all, owner round), feat
// is unmerged (trash disabled, D7) and carries PR #12 (the view chip). The
// current branch "work" has no PR – the head-row Open PR button shows.
const BRANCHES_PR = {
	current: "work",
	branches: ["main", "work", "feat"],
	merged: ["main"],
};

function prFetch(
	opts: {
		slug?: { owner: string; repo: string } | null;
		openPrAnswer?: Response;
		/** b4: the list's prs override (the empty-list state). */
		prs?: PrSummary[];
		/** Owner reshape: the byBranch override – the current branch's own
		 *  entry hides the head-row Open PR button. */
		byBranch?: Record<string, { number: number; title: string; state: string }>;
		/** Owner reshape: overlays for the on-main and merge-tooltip cases. */
		meta?: Partial<RepoMeta>;
		branches?: { current: string; branches: string[]; merged?: string[] };
		/** b4: the detail answer – `pr` overlays PR12, `files` is page 1,
		 *  `files2` any later page. */
		detail?: {
			pr?: Partial<PrSummary>;
			files?: PrFile[];
			files2?: PrFile[];
		};
		mergeAnswer?: Response;
		pushAnswer?: Response;
	} = {},
) {
	return async (
		input: RequestInfo | URL,
		init?: RequestInit,
	): Promise<Response> => {
		const url = new URL(String(input), "http://localhost");
		if (url.pathname === "/api/auth/session")
			return jsonResponse({
				enabled: true,
				user: { login: "tester" },
				canWrite: true,
			});
		const action = url.pathname.match(/^\/api\/prs\/(\d+)\/(merge|push)$/);
		if (action) {
			if (action[2] === "merge")
				return opts.mergeAnswer ?? jsonResponse({ merged: true });
			return opts.pushAnswer ?? jsonResponse({ pushed: true });
		}
		if (url.pathname === "/api/prs") {
			// The create: the client sends branch + optional body only; the
			// duplicate/idempotent answer (200 with a PrSummary) covers both.
			if ((init?.method ?? "GET") === "POST")
				return opts.openPrAnswer ?? jsonResponse({ ...PR12, number: 13 });
			return jsonResponse({
				enabled: true,
				slug: "slug" in opts ? opts.slug : { owner: "o", repo: "r" },
				prs: opts.prs ?? [PR12],
				byBranch: opts.byBranch ?? {
					feat: { number: 12, title: PR12.title, state: "open" },
				},
			});
		}
		const detail = url.pathname.match(/^\/api\/prs\/(\d+)$/);
		if (detail) {
			const page = Number(url.searchParams.get("files_page") ?? 1);
			return jsonResponse({
				pr: { ...PR12, ...opts.detail?.pr },
				files:
					page > 1
						? (opts.detail?.files2 ?? [])
						: (opts.detail?.files ?? [PR_FILE]),
				filesPage: page,
			});
		}
		if (url.pathname === "/api/branches")
			return jsonResponse(opts.branches ?? BRANCHES_PR);
		if (url.pathname === "/api/meta")
			return jsonResponse({ ...META, ...opts.meta });
		return mockFetch(input);
	};
}

/** App under a signed-in gate – useAuth() non-null is the PR surface's gate. */
async function renderAuthedApp(
	fetchImpl: (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
) {
	vi.stubGlobal("fetch", vi.fn(fetchImpl));
	const view = render(createElement(AuthGate, null, createElement(App)));
	await view.findByRole("button", { name: "Edit" });
	return view;
}

function prviewTarget(): string | null {
	return (
		document.querySelector(".app-frame")?.getAttribute("data-prview") ?? null
	);
}

describe("App: the PR entry points (#27 b3)", () => {
	test("the PR button hides while auth is off (local mode)", async () => {
		await renderAppReady();
		expect(screen.queryByRole("button", { name: "Pull requests" })).toBeNull();
	});

	test("under auth on a GitHub origin it shows and sets the list target", async () => {
		await renderAuthedApp(prFetch());
		fireEvent.click(
			await screen.findByRole("button", { name: "Pull requests" }),
		);
		expect(prviewTarget()).toBe("list");
	});

	test("hidden on a non-GitHub origin (slug null)", async () => {
		await renderAuthedApp(prFetch({ slug: null }));
		expect(screen.queryByRole("button", { name: "Pull requests" })).toBeNull();
	});

	test("the BranchMenu chip sets the pr:<n> target", async () => {
		await renderAuthedApp(prFetch());
		fireEvent.click(
			screen.getByRole("button", { name: "Branch: work. Switch branch" }),
		);
		fireEvent.click(await screen.findByText("PR #12"));
		await waitFor(() => expect(prviewTarget()).toBe("pr:12"));
	});
});

describe("BranchMenu: PR chips + the merged gate (#27 b3, owner reshape)", () => {
	function openMenu(onAction: (action: BranchAction) => void) {
		vi.stubGlobal("fetch", vi.fn(prFetch()));
		render(
			createElement(BranchMenu, {
				current: "work",
				prsEnabled: true,
				mainName: "main",
				onAction,
			}),
		);
		fireEvent.click(
			screen.getByRole("button", { name: "Branch: work. Switch branch" }),
		);
	}

	test("PR #n on the PR'd branch only – the dashed create chip and its in-menu popover are GONE; the trash gates on merged", async () => {
		const onAction = vi.fn();
		openMenu(onAction);

		// feat has an open PR → the view chip. Creating is NOT a menu act
		// anymore (owner reshape – the dashed chip tried head=main and read
		// "No commits between main and main"): no create chip, no popover.
		expect(await screen.findByText("PR #12")).toBeTruthy();
		expect(
			screen.queryByTitle("Open a pull request for this branch"),
		).toBeNull();
		expect(screen.queryByText("Open pull request")).toBeNull();

		// D7: main never gets a trash at all (protected base, owner round);
		// feat is unmerged → disabled with the tooltip, no force-delete.
		expect(
			screen.queryByRole("button", { name: "Delete branch main" }),
		).toBeNull();
		const featTrash = screen.getByRole("button", {
			name: "Delete branch feat",
		}) as HTMLButtonElement;
		expect(featTrash.disabled).toBe(true);
		expect(featTrash.title).toBe("Not merged yet");
		expect(featTrash.getAttribute("aria-disabled")).toBe("true");

		// The chip routes through App: view-pr with the PR number.
		fireEvent.click(screen.getByText("PR #12"));
		expect(onAction).toHaveBeenCalledWith({ kind: "view-pr", number: 12 });
	});
});

describe("OpenPRButton: the head-row popover (owner reshape)", () => {
	test("a failed open keeps the form open with the server error inline", async () => {
		const onCreated = vi.fn();
		vi.stubGlobal(
			"fetch",
			vi.fn(
				prFetch({
					openPrAnswer: new Response(
						JSON.stringify({ error: "github unreachable" }),
						{
							status: 502,
							headers: { "content-type": "application/json" },
						},
					),
				}),
			),
		);
		render(
			createElement(OpenPRButton, {
				branch: "work",
				base: "main",
				onCreated,
			}),
		);
		fireEvent.click(screen.getByRole("button", { name: "Open pull request" }));
		fireEvent.click(await screen.findByRole("button", { name: "Open PR" }));

		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toBe("github unreachable");
		// The form stays open, nothing fired.
		expect(screen.getByRole("button", { name: "Open PR" })).toBeTruthy();
		expect(onCreated).not.toHaveBeenCalled();
	});

	test("no default-branch knowledge shows the branch alone in the static line", () => {
		render(
			createElement(OpenPRButton, {
				branch: "work",
				base: null,
				onCreated: () => {},
			}),
		);
		fireEvent.click(screen.getByRole("button", { name: "Open pull request" }));
		expect(screen.getByText("work")).toBeTruthy();
	});
});

describe("App: the head-row Open PR button (owner reshape)", () => {
	const OPEN_BTN = { name: "Open pull request" };

	test("hidden while the PR surface is off (auth off – prAvailable false)", async () => {
		await renderAppReady();
		expect(screen.queryByRole("button", OPEN_BTN)).toBeNull();
	});

	test("hidden on main", async () => {
		await renderAuthedApp(
			prFetch({
				meta: { current: "main" },
				branches: { current: "main", branches: ["main", "work"], merged: [] },
			}),
		);
		await waitFor(() =>
			expect(screen.queryByRole("button", OPEN_BTN)).toBeNull(),
		);
	});

	test("hidden while the current branch already has an open PR", async () => {
		await renderAuthedApp(
			prFetch({
				byBranch: {
					work: { number: 12, title: PR12.title, state: "open" },
				},
			}),
		);
		await waitFor(() =>
			expect(screen.queryByRole("button", OPEN_BTN)).toBeNull(),
		);
	});

	test("visible on a draft branch; the popover submits openPR(branch, description) and opens the new PR", async () => {
		await renderAuthedApp(prFetch());
		const open = await screen.findByRole("button", OPEN_BTN);
		// The owner tooltip on the opener…
		expect(open.getAttribute("title")).toBe(
			"Push this branch as the signed-in user and open a GitHub pull request for it",
		);
		// …and the popover: header + the static branch line (the server
		// resolves the true base – the client shows work → main).
		fireEvent.click(open);
		expect(await screen.findByText("Open pull request")).toBeTruthy();
		expect(screen.getByText("work → main")).toBeTruthy();
		fireEvent.change(screen.getByLabelText("Description (optional)"), {
			target: { value: "Adds the a doc" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Open PR" }));

		// Success: the slideout's PR target is the created PR, availability
		// (and byBranch) refreshed on the way.
		await waitFor(() => expect(prviewTarget()).toBe("pr:13"));
		// The client contract: branch + body only – the title derives server-side.
		const post = vi
			.mocked(fetch)
			.mock.calls.find(
				([u, init]) => String(u) === "/api/prs" && init?.method === "POST",
			);
		expect(post).toBeTruthy();
		expect(JSON.parse(String(post?.[1]?.body))).toEqual({
			branch: "work",
			body: "Adds the a doc",
		});
	});

	test("the head tooltips render – Merge spells out the local act beside the count", async () => {
		await renderAuthedApp(
			prFetch({
				meta: { drafts: { "a.md": [{ branch: "work", status: "edited" }] } },
			}),
		);
		const merge = await screen.findByRole("button", { name: "Merge" });
		expect(merge.getAttribute("title")).toBe(
			"Merge this draft branch back into main – local, no GitHub involved (1 doc changed)",
		);
		expect(screen.getByRole("button", OPEN_BTN).getAttribute("title")).toBe(
			"Push this branch as the signed-in user and open a GitHub pull request for it",
		);
	});
});

// --- #27 (b4): the PR review pane ----------------------------------------------

/** The mounted slideout – queries scope to it so pane buttons never collide
 *  with the header's (Merge exists in both). */
function slideoutEl(): HTMLElement {
	const el = document.querySelector<HTMLElement>(".slideout");
	if (!el) throw new Error("no slideout");
	return el;
}

/** Authed App → PR list → PR #12's detail, waited to its ready state (the
 *  pane's title line renders only with a fetched pr). */
async function openPrDetail(
	fetchImpl: (
		url: RequestInfo | URL,
		init?: RequestInit,
	) => Promise<Response> = prFetch(),
): Promise<HTMLElement> {
	await renderAuthedApp(fetchImpl);
	fireEvent.click(await screen.findByRole("button", { name: "Pull requests" }));
	fireEvent.click(await screen.findByText("Docs: the feat branch"));
	return waitFor(() => {
		const slideout = slideoutEl();
		if (!slideout.querySelector(".pr-title"))
			throw new Error("detail not loaded yet");
		return slideout;
	});
}

describe("App: the PR review pane (#27 b4)", () => {
	test("the list renders rows and the head count; a row click opens the detail with status, meta, and patch rows", async () => {
		await renderAuthedApp(prFetch());
		fireEvent.click(
			await screen.findByRole("button", { name: "Pull requests" }),
		);
		expect(await screen.findByText("Pull requests · 1 open")).toBeTruthy();
		fireEvent.click(screen.getByText("Docs: the feat branch"));

		const s = await waitFor(() => {
			const slideout = slideoutEl();
			if (!slideout.querySelector(".pr-title"))
				throw new Error("detail not loaded yet");
			return slideout;
		});
		// The head carries the detail line; the pane the honest chips, the
		// branch pair, and the parsed patch rows.
		expect(within(s).getByText("PR #12 · Docs: the feat branch")).toBeTruthy();
		expect(within(s).getByText("open")).toBeTruthy();
		expect(within(s).getByText("mergeable")).toBeTruthy();
		expect(within(s).getByText("feat")).toBeTruthy();
		expect(within(s).getByText("main")).toBeTruthy();
		expect(s.textContent).toContain("2 files");
		expect(document.querySelectorAll(".pr-patch-row.add")).toHaveLength(2);
		expect(document.querySelectorAll(".pr-patch-row.del")).toHaveLength(1);
		expect(document.querySelectorAll(".pr-patch-row.hunk")).toHaveLength(1);
		expect(document.querySelector(".pr-file-name")?.getAttribute("title")).toBe(
			"docs/a.md",
		);
		// Asserted by attribute, never clicked – happy-dom would really
		// navigate on an un-prevented anchor.
		const gh = within(s).getByRole("link", { name: "Open on GitHub" });
		expect(gh.getAttribute("href")).toBe(PR12.html_url);
		expect(gh.getAttribute("target")).toBe("_blank");
		// Opening a review never navigates the editor.
		expect(breadcrumbText()).toBe("a");
	});

	test("an empty list answers with the calm empty state and a zero count", async () => {
		await renderAuthedApp(prFetch({ prs: [] }));
		fireEvent.click(
			await screen.findByRole("button", { name: "Pull requests" }),
		);
		expect(await screen.findByText("No open pull requests.")).toBeTruthy();
		expect(await screen.findByText("Pull requests · 0 open")).toBeTruthy();
	});

	test("the pager steps 20-file pages: prev disabled on page 1, next only while the page was full", async () => {
		const files20: PrFile[] = Array.from({ length: 20 }, (_, i) => ({
			filename: `f${i}.md`,
			status: "modified",
			additions: 1,
			deletions: 0,
			patch: "@@ -1 +1 @@\n-x\n+y",
		}));
		const s = await openPrDetail(
			prFetch({ detail: { files: files20, files2: files20.slice(0, 3) } }),
		);
		const prev = within(s).getByRole("button", {
			name: "Previous page",
		}) as HTMLButtonElement;
		const next = within(s).getByRole("button", {
			name: "Next page",
		}) as HTMLButtonElement;
		expect(prev.disabled).toBe(true);
		expect(next.disabled).toBe(false);
		expect(s.textContent).toContain("files 1–20 · page 1/≥2");

		fireEvent.click(next);
		await waitFor(() => {
			expect(s.textContent).toContain("files 21–23 · page 2");
		});
		expect(prev.disabled).toBe(false);
		expect(next.disabled).toBe(true);
		// Each page fetched on demand – page 2 only after the click.
		const pages = vi
			.mocked(fetch)
			.mock.calls.filter(([u]) => String(u).startsWith("/api/prs/12?"))
			.map(([u]) =>
				Number(
					new URL(String(u), "http://localhost").searchParams.get("files_page"),
				),
			);
		expect(pages).toEqual([1, 2]);
	});

	test("Merge hides on draft, conflicted, and closed PRs; Push commits hides when closed", async () => {
		for (const over of [
			{ draft: true },
			{ mergeable: false },
			{ state: "closed" as const },
		]) {
			cleanup();
			const s = await openPrDetail(prFetch({ detail: { pr: over } }));
			expect(within(s).queryByRole("button", { name: "Merge" })).toBeNull();
			if (over.state === "closed") {
				expect(
					within(s).queryByRole("button", { name: "Push commits" }),
				).toBeNull();
			} else {
				expect(
					within(s).getByRole("button", { name: "Push commits" }),
				).toBeTruthy();
			}
		}
	});

	test("a conflicted merge answer swaps Merge for the resolve-on-GitHub state", async () => {
		const s = await openPrDetail(
			prFetch({
				mergeAnswer: jsonResponse({
					conflicted: true,
					html_url: "https://github.com/o/r/pull/12",
				}),
			}),
		);
		fireEvent.click(within(s).getByRole("button", { name: "Merge" }));
		expect(
			await within(s).findByText(/conflicts that must be resolved on GitHub/),
		).toBeTruthy();
		expect(within(s).queryByRole("button", { name: "Merge" })).toBeNull();
		const resolve = within(s).getByRole("link", { name: /Resolve on GitHub/ });
		expect(resolve.getAttribute("href")).toBe("https://github.com/o/r/pull/12");
		expect(resolve.getAttribute("target")).toBe("_blank");
	});

	test("a successful merge refreshes the detail (the closed answer replaces the button)", async () => {
		let merged = false;
		const base = prFetch();
		const checkouts: string[] = [];
		const s = await openPrDetail(async (input, init) => {
			const url = new URL(String(input), "http://localhost");
			if (url.pathname === "/api/prs/12/merge") {
				merged = true;
				return jsonResponse({ merged: true });
			}
			if (merged && url.pathname === "/api/prs/12")
				return jsonResponse({
					pr: { ...PR12, state: "closed", mergeable: null },
					files: [PR_FILE],
					filesPage: 1,
				});
			// The post-merge switch (owner round): App checks out main.
			if (url.pathname === "/api/checkout" && init?.method === "POST") {
				checkouts.push(String(init.body));
				return jsonResponse({ current: "main" });
			}
			return base(input, init);
		});
		fireEvent.click(within(s).getByRole("button", { name: "Merge" }));
		expect(await within(s).findByText("closed")).toBeTruthy();
		expect(within(s).queryByRole("button", { name: "Merge" })).toBeNull();
		const detailGets = vi
			.mocked(fetch)
			.mock.calls.filter(([u]) => String(u).startsWith("/api/prs/12?")).length;
		expect(detailGets).toBeGreaterThanOrEqual(2);
		expect(checkouts).toContain('{"name":"main"}');
	});

	test("a push with nothing to push answers with the quiet up-to-date note", async () => {
		const s = await openPrDetail(
			prFetch({ pushAnswer: jsonResponse({ pushed: false }) }),
		);
		fireEvent.click(within(s).getByRole("button", { name: "Push commits" }));
		expect(await within(s).findByText("already up to date")).toBeTruthy();
	});

	test("Escape closes the PR mode back to the comments rail", async () => {
		await renderAuthedApp(prFetch());
		fireEvent.click(
			await screen.findByRole("button", { name: "Pull requests" }),
		);
		expect(prviewTarget()).toBe("list");
		fireEvent.keyDown(window, { key: "Escape" });
		expect(prviewTarget()).toBeNull();
		expect(await screen.findByText("Comments · 0")).toBeTruthy();
	});
});
