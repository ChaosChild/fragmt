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
import { askConfirm, ConfirmHost } from "../ui/src/ConfirmDialog.js";
import { DocView } from "../ui/src/DocView.js";
import { GraphView } from "../ui/src/GraphView.js";
import { hasHardWraps } from "../ui/src/hard-wraps.js";
import {
	type BranchAction,
	BranchMenu,
	OpenPRButton,
} from "../ui/src/Menus.js";
import { SearchModal } from "../ui/src/SearchModal.js";

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
		docMetas: {},
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

// --- ui v1 phase 4: the sheet ------------------------------------------------

describe("DocView: the sheet (ui v1)", () => {
	const meta = (
		over: Partial<NonNullable<DocViewProps["docMeta"]>> = {},
	): NonNullable<DocViewProps["docMeta"]> => ({
		author: "Tester",
		authorEmail: "",
		date: "2026-09-01T00:00:00Z",
		version: 3,
		snippet: "",
		title: null,
		okf: {
			type: "concept",
			status: "draft",
			tier: "unverified",
			staleAfter: null,
		},
		...over,
	});

	test("a 5-segment path collapses the breadcrumb to a / … / d / name, the full path in its title", () => {
		const path = "a/b/c/d/name.md";
		render(
			createElement(
				DocView,
				docViewProps({ doc: docOf(path, "Body."), selected: path }),
			),
		);
		const crumb = document.querySelector(".breadcrumb");
		expect(crumb?.textContent).toBe("a / … / d / name");
		expect(crumb?.getAttribute("title")).toBe(path);
	});

	test("the masthead's standfirst is the description, absent without one", () => {
		render(createElement(DocView, docViewProps()));
		expect(document.querySelector(".standfirst")?.textContent).toBe(
			"original description",
		);
		cleanup();
		const bare: DocResponse = {
			...docOf("a.md", "Body."),
			frontmatter: { status: "draft" },
		};
		render(createElement(DocView, docViewProps({ doc: bare })));
		expect(document.querySelector(".standfirst")).toBeNull();
	});

	test("a 1,150-word body reads as 5 min read", () => {
		const body = Array.from({ length: 1150 }, (_, i) => `word${i}`).join(" ");
		render(
			createElement(
				DocView,
				docViewProps({ doc: docOf("a.md", body), docMeta: meta() }),
			),
		);
		expect(document.querySelector(".who span")?.textContent).toBe(
			"v3 · saved Sept 1 · 5 min read".replace(
				"Sept 1",
				new Date("2026-09-01T00:00:00Z").toLocaleDateString([], {
					month: "short",
					day: "numeric",
				}),
			),
		);
	});

	test("Connections lists references and backlinks on OKF, and hides off OKF", () => {
		const doc: DocResponse = {
			...docOf("a.md", "Body."),
			frontmatter: {
				references: ["b.md", "gone.md"],
				"referenced-by": ["sub/c.md"],
			},
		};
		const docs = [
			{ title: "Doc B", path: "b.md" },
			{ title: "Doc C", path: "sub/c.md" },
		];
		const onSelectDoc = vi.fn();
		const onOpenPreview = vi.fn();
		render(
			createElement(
				DocView,
				docViewProps({ doc, docs, onSelectDoc, onOpenPreview }),
			),
		);
		const conn = screen.getByRole("region", { name: "Connections" });
		expect(within(conn).getByText("2 references · 1 backlink")).toBeTruthy();
		const cards = conn.querySelectorAll(".cc");
		expect(cards.length).toBe(3);
		expect(within(conn).getByText("Doc B")).toBeTruthy();
		// A reference to a doc that no longer exists reads as missing.
		expect(conn.querySelector(".cc.missing .cc-path")?.textContent).toBe(
			"gone.md",
		);
		expect(
			conn
				.querySelector('.cc [aria-label="Links here"]')
				?.closest(".cc")
				?.querySelector(".t")?.textContent,
		).toBe("Doc C");
		fireEvent.click(within(conn).getByText("Doc B"));
		expect(onSelectDoc).toHaveBeenCalledWith("b.md");
		fireEvent.click(within(conn).getByText("Doc C"), { shiftKey: true });
		expect(onOpenPreview).toHaveBeenCalledWith("sub/c.md");
		cleanup();

		render(createElement(DocView, docViewProps({ doc, docs, okf: false })));
		expect(screen.queryByRole("region", { name: "Connections" })).toBeNull();
	});

	test("a doc that is both a reference and a backlink is one card with both marks", () => {
		const doc: DocResponse = {
			...docOf("a.md", "Body."),
			frontmatter: {
				references: ["b.md", "sub/c.md"],
				"referenced-by": ["sub/c.md", "d.md"],
			},
		};
		const docs = [
			{ title: "Doc B", path: "b.md" },
			{ title: "Doc C", path: "sub/c.md" },
			{ title: "Doc D", path: "d.md" },
		];
		render(createElement(DocView, docViewProps({ doc, docs })));
		const conn = screen.getByRole("region", { name: "Connections" });
		// The counts stay per direction.
		expect(within(conn).getByText("2 references · 2 backlinks")).toBeTruthy();
		const cards = [...conn.querySelectorAll(".cc")];
		expect(cards.map((c) => c.querySelector(".t")?.textContent)).toEqual([
			"Doc B",
			"Doc C",
			"Doc D",
		]);
		const marks = (c: Element) =>
			[...c.querySelectorAll(".cc-dir [role=img]")].map((m) =>
				m.getAttribute("aria-label"),
			);
		expect(marks(cards[0])).toEqual(["Referenced from this doc"]);
		expect(marks(cards[1])).toEqual(["Referenced from this doc", "Links here"]);
		expect(marks(cards[2])).toEqual(["Links here"]);
	});

	test("the seal says generated by <actor>, or verified by <actor> once verified", () => {
		const generated: DocResponse = {
			...docOf("a.md", "Body."),
			frontmatter: { generated: { by: "agent/1.0" } },
		};
		render(
			createElement(DocView, docViewProps({ doc: generated, docMeta: meta() })),
		);
		expect(document.querySelector(".seal")?.textContent).toBe(
			"?Unverifiedgenerated by agent/1.0",
		);
		cleanup();

		const verified: DocResponse = {
			...docOf("a.md", "Body."),
			frontmatter: {
				generated: { by: "agent/1.0" },
				verified: [{ by: "human:alice", at: "2026-09-02T00:00:00Z" }],
			},
		};
		render(
			createElement(
				DocView,
				docViewProps({
					doc: verified,
					docMeta: meta({
						okf: {
							type: "concept",
							status: "draft",
							tier: "human-reviewed",
							staleAfter: null,
						},
					}),
				}),
			),
		);
		const seal = document.querySelector(".seal");
		expect(seal?.classList.contains("h")).toBe(true);
		expect(seal?.textContent).toMatch(
			/^✓Human-reviewedverified by human:alice · /,
		);
	});
});

describe("App: doc paths inside comments", () => {
	function commentFetch() {
		return vi.fn(async (input: RequestInfo | URL) => {
			const url = new URL(String(input), "http://localhost");
			if (url.pathname === "/api/docs/a.md/comments")
				return jsonResponse({
					comments: {
						t1: {
							id: "t1",
							quote: "first",
							author: "Tester",
							createdAt: "2026-09-01T00:00:00Z",
							resolved: false,
							replies: [
								{
									author: "Tester",
									body: "see b.md",
									at: "2026-09-01T00:00:00Z",
								},
							],
						},
					},
				});
			if (url.pathname === "/api/docs/a.md")
				return jsonResponse(
					docOf("a.md", 'One <span data-c="t1">first</span> line.'),
				);
			return mockFetch(input);
		});
	}
	const docRef = () =>
		screen.findByRole("button", { name: "b.md" }) as Promise<HTMLElement>;

	test("a click with unsaved edits parks behind the save-or-discard banner instead of navigating", async () => {
		vi.stubGlobal("fetch", commentFetch());
		await renderAppReady();
		await enterEditMode();
		fireEvent.change(metaInput("description"), {
			target: { value: "dirty now" },
		});
		fireEvent.click(await docRef());
		expect(
			await screen.findByText("This document has unsaved changes."),
		).toBeTruthy();
		// Still on a.md, still editing – nothing was dropped.
		expect(breadcrumbText()).toBe("a");
		expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
	});

	test("Ctrl/Cmd+click opens the path in the preview, the main doc stays", async () => {
		vi.stubGlobal("fetch", commentFetch());
		await renderAppReady();
		fireEvent.click(await docRef(), { ctrlKey: true });
		const pane = await screen.findByRole("complementary", { name: "Preview" });
		expect(within(pane).getByText("b.md")).toBeTruthy();
		expect(breadcrumbText()).toBe("a");
		cleanup();

		vi.stubGlobal("fetch", commentFetch());
		await renderAppReady();
		fireEvent.click(await docRef(), { metaKey: true });
		expect(
			await screen.findByRole("complementary", { name: "Preview" }),
		).toBeTruthy();
	});

	test("a plain click on a clean buffer opens the doc in the main pane", async () => {
		vi.stubGlobal("fetch", commentFetch());
		await renderAppReady();
		fireEvent.click(await docRef());
		await waitFor(() => expect(breadcrumbText()).toBe("b"));
		expect(screen.queryByRole("complementary", { name: "Preview" })).toBeNull();
	});
});

describe("App: marginalia (ui v1 phase 5)", () => {
	test("two anchored threads render two notes; clicking the second span focuses the second note", async () => {
		const thread = (id: string, quote: string) => ({
			id,
			quote,
			author: "Tester",
			createdAt: "2026-09-01T00:00:00Z",
			resolved: false,
			replies: [
				{
					author: "Tester",
					body: `note on ${quote}`,
					at: "2026-09-01T00:00:00Z",
				},
			],
		});
		const body =
			'One <span data-c="t1">first</span> line.\n\nTwo <span data-c="t2">second</span> line.';
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL) => {
				const url = new URL(String(input), "http://localhost");
				if (url.pathname === "/api/docs/a.md/comments")
					return jsonResponse({
						comments: { t1: thread("t1", "first"), t2: thread("t2", "second") },
					});
				if (url.pathname === "/api/docs/a.md")
					return jsonResponse(docOf("a.md", body));
				return mockFetch(input);
			}),
		);
		await renderAppReady();
		const margin = screen.getByRole("complementary", { name: "Comments" });
		await waitFor(() =>
			expect(margin.querySelectorAll(".note").length).toBe(2),
		);
		const span = await waitFor(() => {
			const el = document.querySelector<HTMLElement>('.sheet [data-c="t2"]');
			if (!el) throw new Error("span not rendered yet");
			return el;
		});
		fireEvent.click(span);
		await waitFor(() =>
			expect(
				margin.querySelector('.note[data-note="t2"]')?.classList.contains("on"),
			).toBe(true),
		);
		expect(
			margin.querySelector('.note[data-note="t1"]')?.classList.contains("on"),
		).toBe(false);
	});
});

describe("App: the preview beside the doc (ui v1 phase 6)", () => {
	/** a.md links sub/c.md; PUTs are recorded and answered like a save. */
	function previewFetch(puts: string[]) {
		return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = new URL(String(input), "http://localhost");
			if (url.pathname === "/api/docs/a.md" && init?.method === "PUT") {
				puts.push(String(init.body));
				return jsonResponse({ sha: "s1", hash: "h1" });
			}
			if (url.pathname === "/api/docs/a.md")
				return jsonResponse(docOf("a.md", "See [C](sub/c.md) here."));
			return mockFetch(input);
		});
	}

	async function openPreview() {
		const link = await waitFor(() => {
			const el = document.querySelector<HTMLElement>(
				'.sheet a[href="sub/c.md"]',
			);
			if (!el) throw new Error("link not rendered yet");
			return el;
		});
		fireEvent.click(link, { shiftKey: true });
		return screen.findByRole("complementary", { name: "Preview" });
	}

	test("with a preview open, Edit still works, Link at cursor is gated on edit mode and inserts the previewed path, and Save saves it", async () => {
		const puts: string[] = [];
		vi.stubGlobal("fetch", previewFetch(puts));
		await renderAppReady();
		const pane = await openPreview();

		// Read mode: the button is there, disabled, and says why.
		const link = within(pane).getByRole("button", { name: /Link at cursor/ });
		expect((link as HTMLButtonElement).disabled).toBe(true);
		expect(link.getAttribute("title")).toBe(
			"Start editing the main doc to insert a link",
		);

		// The main doc stays fully interactive beside the preview.
		await enterEditMode();
		expect(screen.getByRole("complementary", { name: "Preview" })).toBeTruthy();
		await waitFor(() =>
			expect((link as HTMLButtonElement).disabled).toBe(false),
		);
		fireEvent.click(link);
		await waitFor(() =>
			expect(
				document.querySelectorAll('.sheet a[href="sub/c.md"]').length,
			).toBe(2),
		);

		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() => expect(puts.length).toBe(1));
		const saved = JSON.parse(puts[0]) as { markdown: string };
		// The inserted reference is the @-menu's own shape: title + path href.
		expect(saved.markdown.match(/\]\(sub\/c\.md\)/g)?.length).toBe(2);
	});

	test("Escape closes the preview before it touches the edit session", async () => {
		vi.stubGlobal("fetch", previewFetch([]));
		await renderAppReady();
		await openPreview();
		await enterEditMode();
		const editor = document.querySelector(".sheet .ProseMirror") as HTMLElement;
		fireEvent.keyDown(editor, { key: "Escape" });
		await waitFor(() =>
			expect(
				screen.queryByRole("complementary", { name: "Preview" }),
			).toBeNull(),
		);
		// Still editing: the first Escape was spent on the preview.
		expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
	});
});

describe("SearchModal: the palette (ui v1 phase 8)", () => {
	const HITS = [
		{ path: "a.md", title: "Alpha sync", snippet: "first sync" },
		{ path: "b.md", title: "Beta sync", snippet: "second sync" },
		{ path: "sub/c.md", title: "Gamma sync", snippet: "third sync" },
	];

	/** /api/search answers HITS; doc fetches are recorded and can be held. */
	function paletteFetch(docCalls: string[], hold?: Map<string, () => void>) {
		return vi.fn(async (input: RequestInfo | URL) => {
			const url = new URL(String(input), "http://localhost");
			if (url.pathname === "/api/search") return jsonResponse(HITS);
			const m = url.pathname.match(/^\/api\/docs\/(.+)$/);
			if (m) {
				const path = decodeURIComponent(m[1]);
				docCalls.push(path);
				const body = jsonResponse(docOf(path, `Body of ${path} with sync.`));
				const release = hold?.get(path);
				if (release) {
					await new Promise<void>((resolve) => hold?.set(path, resolve));
				}
				return body;
			}
			return mockFetch(input);
		});
	}

	function mount(extra: Partial<ComponentProps<typeof SearchModal>> = {}) {
		render(
			createElement(SearchModal, {
				open: true,
				onClose: () => {},
				onOpen: () => {},
				...extra,
			}),
		);
		const input = screen.getByRole("combobox", { name: "Search documents" });
		fireEvent.change(input, { target: { value: "sync" } });
		return input;
	}

	test("arrow keys move the selection; the preview fetches the settled selection once", async () => {
		const calls: string[] = [];
		vi.stubGlobal("fetch", paletteFetch(calls));
		const input = mount();
		await screen.findByText("Alpha", { exact: false });
		await waitFor(() => expect(calls).toEqual(["a.md"]));
		// Two quick moves inside the debounce: only the last selection loads.
		fireEvent.keyDown(input, { key: "ArrowDown" });
		fireEvent.keyDown(input, { key: "ArrowDown" });
		await waitFor(() =>
			expect(
				document.querySelector(".search-preview .kicker")?.textContent,
			).toContain("sub/c.md"),
		);
		expect(calls).toEqual(["a.md", "sub/c.md"]);
		// Back to a cached one: no new request.
		fireEvent.keyDown(input, { key: "ArrowUp" });
		fireEvent.keyDown(input, { key: "ArrowUp" });
		await waitFor(() =>
			expect(
				document.querySelector(".search-preview .kicker")?.textContent,
			).toContain("a.md"),
		);
		expect(calls).toEqual(["a.md", "sub/c.md"]);
	});

	test("a preview response that lands after the selection moved on is ignored", async () => {
		const calls: string[] = [];
		const hold = new Map<string, () => void>([["a.md", () => {}]]);
		vi.stubGlobal("fetch", paletteFetch(calls, hold));
		const input = mount();
		await waitFor(() => expect(calls).toEqual(["a.md"]));
		// a.md is still in flight; move to b.md and let it load.
		fireEvent.keyDown(input, { key: "ArrowDown" });
		await waitFor(() =>
			expect(
				document.querySelector(".search-preview .kicker")?.textContent,
			).toContain("b.md"),
		);
		// Now release the stale a.md answer – the preview must stay on b.md.
		hold.get("a.md")?.();
		await new Promise((r) => setTimeout(r, 50));
		expect(
			document.querySelector(".search-preview .kicker")?.textContent,
		).toContain("b.md");
	});

	test("the Actions group shows for 'sync' and runs the sync handler", async () => {
		vi.stubGlobal("fetch", paletteFetch([]));
		const onSync = vi.fn();
		const onClose = vi.fn();
		mount({ onSync, onClose, onNewDoc: () => {} });
		const row = await screen.findByText("Sync now");
		// "New document" doesn't match "sync" – not offered.
		expect(screen.queryByText("New document")).toBeNull();
		fireEvent.click(row);
		expect(onSync).toHaveBeenCalledTimes(1);
		expect(onClose).toHaveBeenCalled();
	});
});

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
		expect(document.querySelector(".gv-count")?.textContent).toBe("3 docs");
		expect(screen.getByText("1 links · 1 isolated")).toBeTruthy();
		expect(document.querySelectorAll(".gv-node")).toHaveLength(3);
		expect(screen.getByText("A")).toBeTruthy();
		expect(screen.getByText("B")).toBeTruthy();
		expect(screen.getByText("C")).toBeTruthy();
	});

	test("a click selects (inspector, neighbours lit); Open or a double-click navigates", () => {
		const onOpenDoc = vi.fn();
		render(
			createElement(GraphView, { graph: GRAPH, onOpenDoc, onClose: () => {} }),
		);
		const node = document.querySelectorAll(".gv-node")[0];
		if (!node) throw new Error("no graph nodes rendered");
		fireEvent.click(node);
		expect(onOpenDoc).not.toHaveBeenCalled();
		const insp = screen.getByRole("complementary", {
			name: "Selected document",
		});
		expect(within(insp).getByText("a.md")).toBeTruthy();
		// a.md → b.md: b is a neighbour, c (isolated) dims.
		expect(within(insp).getByText("References · 1")).toBeTruthy();
		const groups = document.querySelectorAll(".gv-n");
		expect(groups[2].classList.contains("dim")).toBe(true);
		expect(groups[1].classList.contains("dim")).toBe(false);
		fireEvent.click(within(insp).getByRole("button", { name: "Open" }));
		expect(onOpenDoc).toHaveBeenCalledWith("a.md");
		fireEvent.doubleClick(document.querySelectorAll(".gv-node")[1]);
		expect(onOpenDoc).toHaveBeenLastCalledWith("b.md");
	});

	test("keyboard: Enter selects a node, Shift+Enter opens it", () => {
		const onOpenDoc = vi.fn();
		render(
			createElement(GraphView, { graph: GRAPH, onOpenDoc, onClose: () => {} }),
		);
		const b = document.querySelectorAll<HTMLElement>(".gv-n")[1];
		expect(b.getAttribute("tabindex")).toBe("0");
		fireEvent.keyDown(b, { key: "Enter" });
		expect(b.getAttribute("aria-pressed")).toBe("true");
		fireEvent.keyDown(b, { key: "Enter", shiftKey: true });
		expect(onOpenDoc).toHaveBeenCalledWith("b.md");
	});

	test("grouping draws a hull per folder; folding one collapses it into a folder node and back", () => {
		localStorage.removeItem("fragmt.graphGroup");
		const node = (path: string) => ({
			path,
			title: path,
			type: null,
			status: null,
			tier: "unverified" as const,
			stale: false,
		});
		const graph: DocGraph = {
			nodes: [node("a.md"), node("ref/x.md"), node("ref/api/y.md")],
			edges: [
				{ from: "a.md", to: "ref/x.md" },
				{ from: "a.md", to: "ref/api/y.md" },
			],
		};
		render(
			createElement(GraphView, {
				graph,
				onOpenDoc: () => {},
				onClose: () => {},
			}),
		);
		// Default: 2 levels – ref and ref/api.
		expect(document.querySelectorAll(".gv-hull")).toHaveLength(2);
		fireEvent.click(screen.getByRole("button", { name: "1 level" }));
		expect(document.querySelectorAll(".gv-hull")).toHaveLength(1);
		expect(localStorage.getItem("fragmt.graphGroup")).toBe("1");
		fireEvent.click(screen.getByRole("button", { name: "Fold ref" }));
		expect(document.querySelectorAll(".gv-node")).toHaveLength(1);
		const folder = screen.getByRole("button", { name: "Unfold ref" });
		expect(folder.textContent).toContain("ref/ · 2 docs");
		// The two links into ref merge into one edge of weight 2.
		expect(document.querySelector(".gv-weight")?.textContent).toBe("2");
		fireEvent.click(folder);
		expect(document.querySelectorAll(".gv-node")).toHaveLength(3);
		localStorage.removeItem("fragmt.graphGroup");
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
		expect(
			screen.getByRole("complementary", { name: "Selected document" }),
		).toBeTruthy();
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

		expect(await screen.findByText("1 links · 1 isolated")).toBeTruthy();
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
		/** ui v1: the rendered diff's two sides for any doc path. */
		prDoc?: unknown;
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
		if (/^\/api\/prs\/\d+\/doc$/.test(url.pathname))
			return jsonResponse(
				opts.prDoc ?? {
					base: { frontmatter: { title: "A" }, body: "Old line here.\n" },
					head: { frontmatter: { title: "A2" }, body: "New line here.\n" },
				},
			);
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

describe("BranchMenu: branch state lines (ui v1 phase 7)", () => {
	test("rows carry the PR chip or 'no PR', ahead/behind, and the conflict warning from /api/branches/status", async () => {
		const base = prFetch();
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = new URL(String(input), "http://localhost");
				if (url.pathname === "/api/branches/status")
					return jsonResponse({
						branches: [
							{
								name: "feat",
								ahead: 3,
								behind: 1,
								conflicts: true,
								lastCommitAt: "2026-09-01T00:00:00Z",
							},
							{
								name: "work",
								ahead: 1,
								behind: 0,
								conflicts: false,
								lastCommitAt: "2026-09-01T00:00:00Z",
							},
						],
					});
				return base(input, init);
			}),
		);
		render(
			createElement(BranchMenu, {
				current: "work",
				prsEnabled: true,
				mainName: "main",
				onAction: () => {},
			}),
		);
		fireEvent.click(
			screen.getByRole("button", { name: "Branch: work. Switch branch" }),
		);
		expect(await screen.findByText("PR #12")).toBeTruthy();
		expect(await screen.findByText("conflicts with main")).toBeTruthy();
		const row = (name: string) =>
			Array.from(document.querySelectorAll<HTMLElement>(".br")).find(
				(r) => r.querySelector(".bn")?.textContent === name,
			) as HTMLElement;
		const feat = row("feat");
		expect(within(feat).getByText(/3 ahead · 1 behind/)).toBeTruthy();
		const work = row("work");
		expect(within(work).getByText("1 ahead")).toBeTruthy();
		expect(within(work).getByText("no PR")).toBeTruthy();
		expect(within(work).queryByText("conflicts with main")).toBeNull();
		// main leads the list and never gets a "no PR" chip.
		const rows = Array.from(document.querySelectorAll(".br .bn")).map(
			(el) => el.textContent,
		);
		expect(rows[0]).toBe("main");
		const main = row("main");
		expect(within(main).queryByText("no PR")).toBeNull();
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

/** The mounted PR list drawer (ui v1). */
function drawerEl(): HTMLElement {
	const el = document.querySelector<HTMLElement>(".pr-drawer");
	if (!el) throw new Error("no PR drawer");
	return el;
}

/** Authed App → PR list → PR #12's full-stage review, waited to its ready
 *  state (the title renders only with a fetched pr). Queries scope to the
 *  review so its buttons never collide with the navigator's (Merge). */
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
		const review = document.querySelector<HTMLElement>(".pr-review");
		if (!review?.querySelector(".pr-title"))
			throw new Error("review not loaded yet");
		return review;
	});
}

/** The review's Source tab – the patch rows and the pager. */
function showSource(review: HTMLElement) {
	fireEvent.click(within(review).getByRole("button", { name: "Source" }));
}

describe("App: the rendered PR diff (ui v1 phase 9)", () => {
	test("Rendered is the default tab: changed frontmatter keys and an inline word change", async () => {
		const s = await openPrDetail();
		const rendered = within(s).getByRole("button", { name: "Rendered" });
		expect(rendered.getAttribute("aria-pressed")).toBe("true");
		await waitFor(() =>
			expect(s.querySelector(".fm-row .k")?.textContent).toBe("title"),
		);
		expect(s.querySelector(".fm-row s")?.textContent).toBe("A");
		expect(s.querySelector(".fm-row u")?.textContent).toBe("A2");
		expect(s.querySelector(".rd .chg del")?.textContent).toBe("Old");
		expect(s.querySelector(".rd .chg ins")?.textContent).toBe("New");
		// No patch rows until Source.
		expect(document.querySelectorAll(".pr-patch-row")).toHaveLength(0);
		showSource(s);
		expect(document.querySelectorAll(".pr-patch-row").length).toBeGreaterThan(
			0,
		);
	});

	test("consecutive reflowed paragraphs collapse into one row with a Show toggle", async () => {
		const wrapped = [
			"One line\nwrapped.",
			"Two line\nwrapped.",
			"Three line\nwrapped.",
		];
		const s = await openPrDetail(
			prFetch({
				prDoc: {
					base: { frontmatter: {}, body: wrapped.join("\n\n") },
					head: {
						frontmatter: {},
						body: wrapped.map((p) => p.replaceAll("\n", " ")).join("\n\n"),
					},
				},
			}),
		);
		const row = await within(s).findByText(/3 paragraphs reflowed/);
		expect(row.closest(".reflow")?.textContent).toContain(
			"line breaks only, no words changed",
		);
		expect(within(s).queryByText("One line wrapped.")).toBeNull();
		fireEvent.click(within(s).getByRole("button", { name: "Show" }));
		expect(within(s).getByText("One line wrapped.")).toBeTruthy();
	});

	test("opening a review with unsaved edits parks behind the save-or-discard banner", async () => {
		await renderAuthedApp(prFetch());
		await enterEditMode();
		fireEvent.change(metaInput("description"), { target: { value: "dirty" } });
		fireEvent.click(
			await screen.findByRole("button", { name: "Pull requests" }),
		);
		fireEvent.click(await screen.findByText("Docs: the feat branch"));
		expect(
			await screen.findByText("This document has unsaved changes."),
		).toBeTruthy();
		expect(document.querySelector(".pr-review")).toBeNull();
	});
});

describe("App: the PR review pane (#27 b4)", () => {
	test("the list renders rows and the head count; a row click opens the detail with status, meta, and patch rows", async () => {
		await renderAuthedApp(prFetch());
		fireEvent.click(
			await screen.findByRole("button", { name: "Pull requests" }),
		);
		// ui v1: the list is a drawer over the doc, its Open tab counting.
		const open = await within(drawerEl()).findByRole("button", {
			name: /^Open\s*1$/,
		});
		expect(open.getAttribute("aria-pressed")).toBe("true");
		fireEvent.click(screen.getByText("Docs: the feat branch"));

		const s = await waitFor(() => {
			const review = document.querySelector<HTMLElement>(".pr-review");
			if (!review?.querySelector(".pr-title"))
				throw new Error("review not loaded yet");
			return review;
		});
		// The review takes the stage: the title, the honest state, the
		// mergeability check, the branch pair, and – on Source – the rows.
		expect(s.querySelector(".pr-title")?.textContent).toBe(
			"Docs: the feat branch",
		);
		expect(within(s).getByText("Open")).toBeTruthy();
		expect(within(s).getByText("No conflicts with main")).toBeTruthy();
		expect(s.querySelector(".rv-head .flow")?.textContent).toBe("feat → main");
		expect(s.textContent).toContain("2 files");
		expect(document.querySelector(".pr-drawer")).toBeNull();
		showSource(s);
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
		// The review takes over the stage but never moves the selection:
		// leaving it lands back on the same doc.
		fireEvent.keyDown(window, { key: "Escape" });
		await waitFor(() => expect(breadcrumbText()).toBe("a"));
	});

	test("an empty list answers with the calm empty state and a zero count", async () => {
		await renderAuthedApp(prFetch({ prs: [] }));
		fireEvent.click(
			await screen.findByRole("button", { name: "Pull requests" }),
		);
		expect(await screen.findByText("No open pull requests.")).toBeTruthy();
		expect(
			within(drawerEl()).getByRole("button", { name: /^Open\s*0$/ }),
		).toBeTruthy();
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
		showSource(s);
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
			expect(
				within(s).queryByRole("button", { name: "Merge into main" }),
			).toBeNull();
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
		fireEvent.click(within(s).getByRole("button", { name: "Merge into main" }));
		expect(
			await within(s).findByText(/conflicts that must be resolved on GitHub/),
		).toBeTruthy();
		expect(
			within(s).queryByRole("button", { name: "Merge into main" }),
		).toBeNull();
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
		fireEvent.click(within(s).getByRole("button", { name: "Merge into main" }));
		expect(await within(s).findByText("Closed")).toBeTruthy();
		expect(
			within(s).queryByRole("button", { name: "Merge into main" }),
		).toBeNull();
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
		// ui v1: the threads live in the sheet's margin, not the slideout – the
		// pane unmounts and the margin's Notes header is what remains.
		await waitFor(() => expect(document.querySelector(".slideout")).toBeNull());
		expect(
			within(screen.getByRole("complementary", { name: "Comments" })).getByText(
				"Notes",
			),
		).toBeTruthy();
	});
});

describe("AuthGate: the sign-in page (ui v1 phase 12)", () => {
	const signedOut = async (input: RequestInfo | URL): Promise<Response> => {
		const url = new URL(String(input), "http://localhost");
		if (url.pathname === "/api/auth/session")
			return jsonResponse({ enabled: true, user: null, canWrite: false });
		return mockFetch(input);
	};

	test("signed out: the wordmark, the GitHub link, nothing about the repo", async () => {
		vi.stubGlobal("fetch", vi.fn(signedOut));
		render(createElement(AuthGate, null, createElement(App)));
		expect(await screen.findByRole("heading", { name: "fragmt" })).toBeTruthy();
		const link = screen.getByRole("link", { name: "Continue with GitHub" });
		expect(link.getAttribute("href")).toBe("/api/auth/login");
		expect(screen.queryByRole("status")).toBeNull();
		// The app never mounted – no repo payloads were asked for.
		const asked = vi
			.mocked(fetch)
			.mock.calls.map(([u]) => new URL(String(u), "http://localhost").pathname);
		expect(asked).toEqual(["/api/auth/session"]);
	});

	test("a 401 mid-session lands back here with the session-ended notice", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL) => {
				const url = new URL(String(input), "http://localhost");
				if (url.pathname === "/api/auth/session")
					return jsonResponse({
						enabled: true,
						user: { login: "tester" },
						canWrite: true,
					});
				return new Response(JSON.stringify({ error: "sign in" }), {
					status: 401,
					headers: { "content-type": "application/json" },
				});
			}),
		);
		render(createElement(AuthGate, null, createElement(App)));
		expect(await screen.findByText(/Your session ended/)).toBeTruthy();
		expect(
			screen.getByRole("link", { name: "Continue with GitHub" }),
		).toBeTruthy();
	});
});

describe("ConfirmDialog: the house confirm (no window.confirm)", () => {
	test("no host mounted: resolves false – nothing destructive runs unasked", async () => {
		expect(await askConfirm({ title: "Delete?", confirmLabel: "Delete" })).toBe(
			false,
		);
	});

	test("confirm resolves true; Cancel and Escape resolve false; focus starts on Cancel", async () => {
		render(createElement(ConfirmHost));

		let p = askConfirm({
			title: "Delete branch drafts/x?",
			body: "The local branch is removed.",
			confirmLabel: "Delete branch",
			danger: true,
		});
		const dlg = await screen.findByRole("dialog", {
			name: "Delete branch drafts/x?",
		});
		expect(within(dlg).getByText("The local branch is removed.")).toBeTruthy();
		const cancel = within(dlg).getByRole("button", { name: "Cancel" });
		expect(document.activeElement).toBe(cancel);
		const go = within(dlg).getByRole("button", { name: "Delete branch" });
		expect(go.classList.contains("danger")).toBe(true);
		fireEvent.click(go);
		expect(await p).toBe(true);
		expect(screen.queryByRole("dialog")).toBeNull();

		p = askConfirm({ title: "Again?", confirmLabel: "Go" });
		fireEvent.click(
			within(await screen.findByRole("dialog")).getByRole("button", {
				name: "Cancel",
			}),
		);
		expect(await p).toBe(false);

		p = askConfirm({ title: "Escape me", confirmLabel: "Go" });
		const esc = new KeyboardEvent("keydown", {
			key: "Escape",
			bubbles: true,
			cancelable: true,
		});
		(await screen.findByRole("dialog")).dispatchEvent(esc);
		expect(await p).toBe(false);
		// Prevented, so the window-level Escape chain leaves the stage alone.
		expect(esc.defaultPrevented).toBe(true);
	});
});
