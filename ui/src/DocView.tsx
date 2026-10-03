import {
	BadgeCheck,
	Check,
	ChevronRight,
	Clock,
	FolderInput,
	Pencil,
	Trash2,
	TriangleAlert,
	X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
	addComment,
	type DocMeta,
	type DocMetaEdit,
	type DocResponse,
	getDraftDiff,
	type RepoMeta,
	SaveError,
	STATUS_VALUES,
	saveDoc,
	setTitle,
	verifyDoc,
} from "./api";
import { CommandBar } from "./CommandBar";
import {
	avatarUser,
	collapseCrumb,
	displayTitle,
	extensionRows,
	isoToLocal,
	isReservedDoc,
	metaViewRows,
	readMinutes,
	TRUST_WORD,
	toIsoUtc,
	trustClass,
	wordCount,
} from "./display";
import { EditorPane, type EditorPaneHandle } from "./EditorPane";
import type { AtDoc } from "./editor/at";
import { hasHardWraps } from "./hard-wraps";
import { MenuPopover, useMenu } from "./Menus";
import { shortDate } from "./Sidebar";

/**
 * The email-parallel avatar (item 3): the config authors map first (email →
 * GitHub username, App passes it from meta), then the keyless GitHub noreply
 * heuristic – `123456+user@` or `user@` – either way
 * avatars.githubusercontent.com/<user>?s=76; a load error or non-matching
 * email falls back to the author's initials.
 */
function Avatar({
	author,
	email,
	authors,
}: {
	author: string;
	email: string;
	authors: Record<string, string>;
}) {
	const [broken, setBroken] = useState(false);
	const user = avatarUser(email, authors);
	if (user && !broken) {
		return (
			<img
				className="avatar"
				src={`https://avatars.githubusercontent.com/${user}?s=76`}
				alt=""
				width={38}
				height={38}
				onError={() => setBroken(true)}
			/>
		);
	}
	const initials = author
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((w) => w[0] ?? "")
		.join("")
		.toUpperCase();
	return (
		<span className="avatar" aria-hidden="true">
			{initials}
		</span>
	);
}

/** The trust seal's ring glyph and word per mark (ui v1) – the glyph
 *  carries the tier without colour (DESIGN.md §9). */
const SEAL_GLYPH = { u: "?", m: "M", h: "✓", s: "!" } as const;
const SEAL_WORD = {
	u: "Unverified",
	m: "Machine-confirmed",
	h: "Human-reviewed",
	s: "Stale",
} as const;

/** The metadata form's five fields (#33, D2) – status "" means unset (null
 *  on save, which REMOVES the key); stale is the datetime-local value. */
interface MetaForm {
	type: string;
	description: string;
	tags: string;
	status: string;
	stale: string;
}

/** Seed the form from the doc payload's curated frontmatter: a non-string
 *  scalar (hand-mangled YAML) reads as unset, the refsList rule. */
function metaFormOf(doc: DocResponse): MetaForm {
	const fm = doc.frontmatter;
	return {
		type: typeof fm.type === "string" ? fm.type : "",
		description: typeof fm.description === "string" ? fm.description : "",
		tags: (fm.tags ?? []).join(", "),
		status: typeof fm.status === "string" ? fm.status : "",
		stale: isoToLocal(fm.stale_after),
	};
}

/** The status select's options: the enum plus the doc's own out-of-enum
 *  value when one is stored (A2 gates WRITES at the seam; a stored oddity
 *  must stay visible, or the select would read unset and a save would
 *  silently drop it). */
function statusOptions(current: string): string[] {
	return (
		current !== "" && !(STATUS_VALUES as readonly string[]).includes(current)
			? [current]
			: []
	).concat([...STATUS_VALUES]);
}

/**
 * The doc pane: reading mode by default (DESIGN §3), one explicit Edit action
 * flips the SAME mounted Tiptap editor to editable (M4 review decision 3 –
 * one rendering path, no reflow between modes). Save commits via PUT; a 409
 * shows a non-destructive banner and keeps the user's buffer (M2 spec).
 * Comment anchoring (M4-2) is one combined POST – doc body and sidecar
 * thread in a single server-side commit – without ever flipping the mode.
 * The comments rail lives in App, always present beside this pane; DocView
 * only forwards highlight-span clicks to it.
 */
export function DocView({
	doc,
	selected,
	onSaved,
	onReload,
	onDirtyChange,
	onCommentsChanged,
	onSpanClick,
	pendingAction,
	onPendingActionCancel,
	conflict,
	onDismissConflict,
	onEscapeSurfacesClear,
	onBeforeEdit,
	onDraftFirst,
	docMeta,
	branch,
	draftBranch,
	onOpenDraft,
	onDraft,
	docs,
	onSelectDoc,
	onOpenPreview,
	onSelectFolder,
	pendingAnchor,
	onAnchorConsumed,
	authors,
	folders,
	rootMoveValid,
	onBeforeRename,
	onMoveDoc,
	onDeleteDoc,
	onRenamed,
	okf,
	docMetas,
	repo,
}: {
	doc: DocResponse | null;
	selected: string | null;
	onSaved: (doc: DocResponse) => void;
	onReload: () => void;
	onDirtyChange: (dirty: boolean) => void;
	/** Bumps App's sidecar refetch after a successful create. */
	onCommentsChanged: () => void;
	/** A comment highlight was activated in the doc – jump the rail to it. */
	onSpanClick: (id: string) => void;
	/** An action blocked on the save-or-discard choice – a branch switch or
	 *  a header file op (M3, generalized M4-3 b4); the headline names it and
	 *  `go` runs after Save/Discard (App clears its state). */
	pendingAction: { headline: string; go: () => void } | null;
	onPendingActionCancel: () => void;
	/** Sync conflict message (M3) – the calm banner, never a merge UI. */
	conflict: string | null;
	onDismissConflict: () => void;
	/** The Escape chain's slideout slot (#15 b5, App) – forwarded verbatim to
	 *  EditorPane: true = the slideout was open and the Escape closed it. */
	onEscapeSurfacesClear?: () => boolean;
	/** Pre-edit gate (App): true = flip to edit mode. On main, App drafts
	 *  first (protected main) and returns false on failure – the banner is
	 *  App's; DocView stays dumb. */
	onBeforeEdit: () => Promise<boolean>;
	/** Protected main: awaited before the combined comment POST when the doc
	 *  write must go through a draft (App provides it only on main). */
	onDraftFirst?: () => Promise<boolean>;
	/** The open doc's git metadata (author/version/date) – the doc-head lines. */
	docMeta?: DocMeta;
	/** Current branch name – the "vN · branch" segment. */
	branch: string | null;
	/** The branch a draft pill would check out; null = no pill (App computes). */
	draftBranch: string | null;
	onOpenDraft: () => void;
	/** On a non-main branch touching THIS doc – the pill's non-clickable
	 *  flip side, the "on draft" badge (App computes; M4-3). */
	onDraft: boolean;
	/** email → GitHub username – Avatar's first lookup (App, from meta). */
	authors: Record<string, string>;
	/** The tree's docs – the editor's @ menu and link-click doc set (M4-2). */
	docs: AtDoc[];
	/** An in-doc link resolved to a tree doc – navigate in-app (App); the
	 *  #fragment rides along and scrolls after the new doc renders (M4-3 b6). */
	onSelectDoc: (path: string, anchor?: string) => void;
	/** A doc-link click chose the slideout preview (#15) – edit-mode clicks
	 *  (any modifier) and read-mode Shift/hover-↗ hits; App opens the pane. */
	onOpenPreview: (path: string, anchor?: string) => void;
	/** An in-doc link resolved to a tree folder – App expands it in the
	 *  sidebar and selects its first doc (M4-3 b6). */
	onSelectFolder: (path: string) => void;
	/** A cross-doc #fragment waiting to scroll after the doc loads (App owns
	 *  it; EditorPane consumes it). */
	pendingAnchor: string | null;
	/** The pending anchor was consumed – App clears it. */
	onAnchorConsumed: () => void;
	/** Collision-free move destinations (M4-4 b1, App pre-filters): every
	 *  tree folder except the current parent and folders already holding a
	 *  child named like this doc – a guaranteed 409 is never offered. */
	folders: string[];
	/** Root ("") is offerable – true only from a subfolder and only when
	 *  root holds no same-named child (App computes; M4-4 b1). */
	rootMoveValid: boolean;
	/** Pre-rename gate (App): on main a title write is a doc-body write, so
	 *  the draft starts (and checks out) first; false = App bannered and
	 *  the box stays closed. The dirty gate is DocView's banner (below). */
	onBeforeRename: () => Promise<boolean>;
	/** Move to a tree folder ("" = docsRoot root) – App runs the dirty guard
	 *  and the existing move op; selection follows the new path. */
	onMoveDoc: (folder: string) => void;
	/** Delete the open doc – App runs the dirty guard, the confirm, and the
	 *  existing delete op; the display name rides along for the confirm. */
	onDeleteDoc: (displayName: string) => void;
	/** A frontmatter write landed (rename or metadata edit, #33) – App
	 *  reloads the doc (frontmatter changed) + meta. */
	onRenamed: () => void;
	/** OKF mode (#33) – gates the kicker's type, the trust seal, the
	 *  metadata block, the Verify affordances and Connections (App, meta). */
	okf: boolean;
	/** Every doc's git/OKF meta (App, meta.docs) – Connections' trust marks. */
	docMetas: Record<string, DocMeta>;
	/** The repo identity (meta.repo) – the history line's GitHub link. */
	repo?: RepoMeta["repo"];
}) {
	const [editing, setEditing] = useState(false);
	const [saving, setSaving] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);
	const [dirty, setDirtyLocal] = useState(false);
	// EditorPane reports buffer dirtiness; App needs it for the branch-switch
	// guard (M3), so every change also flows up. Operator round D: metadata
	// edits ride the SAME seam – `dirty` now means "buffer OR metadata
	// changed", so the whole dirty-guard chain (navigation, branch switches,
	// file ops) covers a mid-edit metadata form. metaDirty is tracked beside
	// it because the editor can only speak for its own buffer (an editor
	// revert must not clear a metadata change, and vice versa).
	const [metaDirty, setMetaDirty] = useState(false);
	const setDirty = (d: boolean) => {
		setDirtyLocal(d);
		onDirtyChange(d);
	};
	const editorDirty = (d: boolean) => setDirty(d || metaDirty);
	const touchMeta = () => {
		setMetaDirty(true);
		setDirty(true);
	};
	const clearDirty = () => {
		setMetaDirty(false);
		setDirty(false);
	};
	const [confirmingCancel, setConfirmingCancel] = useState(false);
	// Discard must drop the edited buffer: the editor stays mounted across
	// the mode flip, so bumping the key remounts it fresh from doc.markdown.
	const [resetCount, setResetCount] = useState(0);
	// M4-3 b4 header file actions: the move picker's anchored popover, the
	// rename box, and its blocked-on-dirty state (the local flavor of
	// pendingAction – the box opens after the choice).
	const moveMenu = useMenu();
	const [renaming, setRenaming] = useState(false);
	const [renameValue, setRenameValue] = useState("");
	const [renameError, setRenameError] = useState<string | null>(null);
	const [renameBusy, setRenameBusy] = useState(false);
	const [pendingRename, setPendingRename] = useState(false);
	// #33 (D2, operator round D): the unified metadata editor – one Edit
	// mode for content AND metadata, one Save for both. The seed holds the
	// values the edit session opened with: the save sends ONLY changed
	// fields, so untouched lines keep their bytes (a JSON.stringify'd
	// rewrite of an unquoted YAML scalar would churn the diff for no
	// semantic change). The form seeds FRESH per edit session (the Edit
	// flip) and renders only while editing – a doc switch can never
	// superimpose one doc's form on another's, because the dirty guard
	// parks the switch until the session saves or discards.
	const [metaError, setMetaError] = useState<string | null>(null);
	const [metaForm, setMetaForm] = useState<MetaForm>({
		type: "",
		description: "",
		tags: "",
		status: "",
		stale: "",
	});
	const [metaSeed, setMetaSeed] = useState<MetaForm | null>(null);
	// The §4.1 extension rows (operator round C) – arbitrary scalar keys the
	// payload passed through, edited as text beside the curated five; the
	// seed record rides the same diff (only changed rows save, a cleared
	// value removes the key).
	const [metaExt, setMetaExt] = useState<Record<string, string>>({});
	const [metaExtSeed, setMetaExtSeed] = useState<Record<string, string>>({});
	// Operator round D: the pending add-key rows – "+ add key" appends a
	// name+value pair, each row removable, and every filled name joins the
	// SAME save's edits (a bad name surfaces the server's inline 400). The
	// rows carry a ref-counter id: React keys stay stable across removals.
	const [metaAdds, setMetaAdds] = useState<
		{ id: number; name: string; value: string }[]
	>([]);
	const addSeq = useRef(0);
	// #33 (A1): the read-mode Verify button's in-flight state.
	const [verifying, setVerifying] = useState(false);
	// M4-3 b6: the dead-link note's payload – a relative .md link that matched
	// nothing in the tree. Cleared on doc change (the note describes the open
	// doc's links) and by its Dismiss button.
	const [linkNotFound, setLinkNotFound] = useState<string | null>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: `selected` is the change trigger – the note describes the open doc's links and clears with it.
	useEffect(() => {
		setLinkNotFound(null);
	}, [selected]);
	// Operator round E1: a doc switch ends the edit session – the next doc
	// opens in read mode, never carrying the previous doc's editor state.
	// Dirty switches never arrive (App's guard parks them behind the
	// save-or-discard banner); this handles the clean-buffer case.
	// biome-ignore lint/correctness/useExhaustiveDependencies: `selected` is the change trigger – the setters are stable, and the session ends with the doc it belonged to.
	useEffect(() => {
		setEditing(false);
		setConfirmingCancel(false);
	}, [selected]);
	// The draft gutter (#18): the main pane marks the blocks the draft's
	// commits touched. Refires on doc/branch changes, skips off-draft, and a
	// failed fetch is just no marking – a decoration never becomes an error.
	const [changedLines, setChangedLines] = useState<
		{ start: number; end: number }[]
	>([]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: `branch` never enters the effect body – it is the refetch trigger (a checkout must refresh the gutter).
	useEffect(() => {
		setChangedLines([]);
		if (!onDraft || !selected) return;
		let live = true;
		getDraftDiff(selected)
			.then((r) => {
				if (live) setChangedLines(r.lines);
			})
			.catch(() => {
				if (live) setChangedLines([]);
			});
		return () => {
			live = false;
		};
	}, [selected, branch, onDraft]);
	// Operator round D: a doc switch mid-edit re-seeds the form from the NEW
	// doc – the session continues on fresh values, never superimposing the
	// old doc's (the operator's state-superimposition bug, closed at the
	// root). Guarded switches never arrive dirty (they park in the banner);
	// the unguarded rail/folder links only travel with a clean buffer, so
	// nothing is lost. seededPath keeps same-doc refetches (comments, sync)
	// from wiping pending edits.
	const seededPath = useRef<string | null>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: seedMetaForm is a state-only setter (stable in behavior, recreated per render) – the seed must fire on the editing/doc transitions alone.
	useEffect(() => {
		if (!editing || !doc || seededPath.current === doc.path) return;
		seededPath.current = doc.path;
		seedMetaForm(doc);
	}, [editing, doc]);
	const renameRef = useRef<HTMLInputElement>(null);
	const editorRef = useRef<EditorPaneHandle>(null);
	const paneRef = useRef<HTMLDivElement>(null);

	// The confirm banners render at the top of the pane – bring them into view
	// when one appears, otherwise a mid-document Esc raises it unseen.
	useEffect(() => {
		if (confirmingCancel || pendingAction || pendingRename) {
			paneRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
		}
	}, [confirmingCancel, pendingAction, pendingRename]);

	// The rename box opens focused with its initial value selected (and
	// re-selects on refocus).
	useEffect(() => {
		if (renaming) renameRef.current?.select();
	}, [renaming]);

	const conflictBanner = conflict && (
		<div className="conflict-banner" role="alert">
			<div>
				<strong>Sync conflict</strong>
				{conflict} Resolve the file in your editor or on GitHub – the next sync
				picks up the result.
			</div>
			<button
				type="button"
				className="iconbtn subtle dismiss"
				onClick={onDismissConflict}
			>
				Dismiss
			</button>
		</div>
	);

	if (!selected) {
		return (
			<div className="doc-pane">
				{conflictBanner}
				<p className="label-meta">Select a document.</p>
			</div>
		);
	}
	const segs = selected.split("/");
	const file = segs[segs.length - 1];
	// The display-name model (M4-3 b4): frontmatter title, else the basename
	// sans .md – the sidebar cards and the @ menu resolve the same way.
	const displayName = displayTitle(doc?.frontmatter.title, file);
	// §3.1: reserved files (index.md/log.md) hold no concept frontmatter –
	// the OKF affordances and badges never apply to them.
	const reserved = isReservedDoc(selected);
	// The §4.1 extension rows for the open doc (operator round C) – the
	// edit-mode rows read them; read-only values (string arrays and friends)
	// render, never edit. The view block's full row list (operator round D)
	// sits beside it: curated + extension + managed, friendly-formatted.
	const extRows = doc ? extensionRows(doc.frontmatter) : null;
	const viewRows = doc ? metaViewRows(doc.frontmatter) : [];
	// The Verify tooltip's date (operator round D): the LATEST verified
	// event's `at` (payload list form; a hand-written undated event has none).
	const latestVerifiedEvents = doc?.frontmatter.verified;
	const latestVerifiedAt = Array.isArray(latestVerifiedEvents)
		? (() => {
				const at = latestVerifiedEvents[latestVerifiedEvents.length - 1]?.at;
				return typeof at === "string" ? at : null;
			})()
		: null;

	// --- header file actions (M4-3 b4) --------------------------------------
	// Rename gates in the spec's order: a dirty buffer raises the
	// save-or-discard banner first (the branch-switch mechanism, local here
	// because the box opens afterwards), then App's gate – on main the title
	// write is a doc-body write, so a draft starts first. The file path
	// never changes; only the frontmatter title does.
	function requestRename() {
		if (!doc) return;
		if (dirty) {
			setPendingRename(true);
			return;
		}
		void proceedRename();
	}

	async function proceedRename() {
		if (!doc || !(await onBeforeRename())) return;
		setRenameValue(displayName);
		setRenameError(null);
		setRenaming(true);
	}

	function closeRename() {
		setRenaming(false);
		setRenameError(null);
	}

	async function submitRename() {
		if (!doc || renameBusy) return;
		const title = renameValue.trim();
		if (!title) {
			closeRename(); // empty input = cancel
			return;
		}
		setRenameBusy(true);
		setRenameError(null);
		try {
			await setTitle(doc.path, title);
		} catch (e) {
			// The box stays open – the error sits inline next to the input.
			setRenameError(e instanceof Error ? e.message : String(e));
			return;
		} finally {
			setRenameBusy(false);
		}
		closeRename();
		onRenamed();
	}

	// --- #33 (D2, operator round D): the unified metadata editor ----------

	// The edit session's seed: called on the Edit flip, fresh every time –
	// the form is never carried across docs or sessions (a switch is parked
	// by the dirty guard until the session ends). Reserved files seed too
	// (harmlessly empty): their block renders the §3.1 note, never rows.
	function seedMetaForm(d: DocResponse) {
		const form = metaFormOf(d);
		// The extension rows seed beside the curated five – string arrays
		// and other non-scalars stay out (read-only rows).
		const ext: Record<string, string> = {};
		for (const row of extensionRows(d.frontmatter).editable)
			ext[row.key] = row.value;
		setMetaSeed(form);
		setMetaForm(form);
		setMetaExtSeed(ext);
		setMetaExt(ext);
		setMetaAdds([]);
		setMetaError(null);
	}

	/** The session's changed-key payload (the seed-diff rule): only fields
	 *  that moved since the Edit flip ride the save, so untouched YAML lines
	 *  keep their bytes. Returns undefined when nothing changed – the save is
	 *  then content-only. */
	function metaEditsOf(): DocMetaEdit | undefined {
		if (!metaSeed) return undefined;
		const edits: DocMetaEdit = {};
		const type = metaForm.type.trim();
		if (type !== metaSeed.type.trim()) edits.type = type || null;
		const description = metaForm.description.trim();
		if (description !== metaSeed.description.trim())
			edits.description = description || null;
		const tags = metaForm.tags
			.split(",")
			.map((t) => t.trim())
			.filter(Boolean);
		const seedTags = metaSeed.tags
			.split(",")
			.map((t) => t.trim())
			.filter(Boolean);
		if (tags.join("\u0000") !== seedTags.join("\u0000")) edits.tags = tags;
		if (metaForm.status !== metaSeed.status)
			edits.status = metaForm.status || null;
		// Diff in form space (minutes precision) – the ISO conversion happens
		// only on send, so a round-trip through toIsoUtc never reads as a change.
		if (metaForm.stale !== metaSeed.stale)
			edits.stale_after = metaForm.stale ? toIsoUtc(metaForm.stale) : null;
		// Extension rows: the same seed diff – only changed rows ride the
		// save, a cleared value removes the key.
		for (const [key, value] of Object.entries(metaExt)) {
			if (value === (metaExtSeed[key] ?? "")) continue;
			edits[key] = value.trim() || null;
		}
		// The pending add-key rows: every filled name is one more write on
		// the same save; an empty-named row is a row not filled in yet.
		for (const add of metaAdds) {
			const key = add.name.trim();
			if (key !== "") edits[key] = add.value.trim() || null;
		}
		return Object.keys(edits).length > 0 ? edits : undefined;
	}

	// #33 (A1): the read-mode Verify button – the verified event in its own
	// commit; the reload picks up the doc's new tier chip. Like comment
	// resolve (its sibling affordance), it never flips the mode.
	async function handleVerify() {
		if (!doc || verifying) return;
		setVerifying(true);
		try {
			await verifyDoc(doc.path);
		} catch (e) {
			setSaveError(e instanceof Error ? e.message : String(e));
			return;
		} finally {
			setVerifying(false);
		}
		onRenamed();
	}

	// The command bar's start slot (ui v1): the breadcrumb – folder segments
	// quiet, the doc name in ink, the middle collapsed past 3 segments – and
	// the three file actions right after it, both modes (M4-3 b4). The
	// rename box takes the crumb's place while it is open.
	const crumbSegs = collapseCrumb([...segs.slice(0, -1), displayName]);
	const cmdStart =
		renaming && doc ? (
			<form
				className="rename-form"
				onSubmit={(e) => {
					e.preventDefault();
					void submitRename();
				}}
			>
				<input
					ref={renameRef}
					value={renameValue}
					onChange={(e) => setRenameValue(e.target.value)}
					onFocus={(e) => e.target.select()}
					onKeyDown={(e) => {
						if (e.key === "Escape") {
							// Consumed (#15 b5): the box is an Escape surface –
							// the window fallback must not also close the
							// slideout on the same press.
							e.preventDefault();
							closeRename();
						}
					}}
					aria-label="Document title"
					disabled={renameBusy}
				/>
				<button
					type="submit"
					className="btn icon"
					aria-label="Confirm rename"
					title="Confirm rename"
					disabled={renameBusy}
				>
					<Check aria-hidden="true" />
				</button>
				<button
					type="button"
					className="btn icon"
					aria-label="Cancel rename"
					title="Cancel rename"
					onClick={closeRename}
					disabled={renameBusy}
				>
					<X aria-hidden="true" />
				</button>
				{renameError && (
					<span className="rename-error" role="alert">
						{renameError}
					</span>
				)}
			</form>
		) : (
			<div className="crumb-line">
				<nav className="breadcrumb" aria-label="Breadcrumb" title={selected}>
					{crumbSegs.map((seg, i) =>
						i === crumbSegs.length - 1 ? (
							<b key="name">{seg}</b>
						) : (
							// biome-ignore lint/suspicious/noArrayIndexKey: segments repeat ("…", same-named folders) – the position is the identity.
							<span key={i}>
								{seg}
								<span className="sep"> / </span>
							</span>
						),
					)}
				</nav>
				{doc && (
					<>
						<button
							type="button"
							className="btn icon"
							aria-label="Rename document"
							title="Rename"
							onClick={requestRename}
						>
							<Pencil aria-hidden="true" />
						</button>
						<span className="menu-wrap" ref={moveMenu.wrapRef}>
							<button
								type="button"
								className="btn icon"
								aria-label="Move document"
								title="Move"
								aria-expanded={moveMenu.open}
								onClick={moveMenu.toggle}
							>
								<FolderInput aria-hidden="true" />
							</button>
							<MenuPopover anchor={moveMenu.anchor} popRef={moveMenu.popRef}>
								{/* App pre-filters (M4-4 b1): folders here are collision-free
								    already – the current parent and occupied folders never
								    arrive, and root rides on rootMoveValid. */}
								{rootMoveValid && (
									<button
										type="button"
										className="menu-item"
										onClick={() => {
											moveMenu.close();
											onMoveDoc("");
										}}
									>
										/ (root)
									</button>
								)}
								{folders.map((f) => (
									<button
										key={f}
										type="button"
										className="menu-item"
										onClick={() => {
											moveMenu.close();
											onMoveDoc(f);
										}}
									>
										{f}
									</button>
								))}
								{folders.length === 0 && !rootMoveValid && (
									<p className="menu-empty">no collision-free destination</p>
								)}
							</MenuPopover>
						</span>
						<button
							type="button"
							className="btn icon"
							aria-label="Delete document"
							title="Delete"
							onClick={() => onDeleteDoc(displayName)}
						>
							<Trash2 aria-hidden="true" />
						</button>
					</>
				)}
			</div>
		);

	// The one PUT seam both save paths share (M2): sends the buffer with
	// DocView's base hash; on success the doc state/hash refresh through
	// onSaved (App.setDoc → same-content setContent → dirty resets), so the
	// next save doesn't 409 itself. `verified` (#33, A1) is Save as
	// Verified – the event rides the save's own commit. `meta` (operator
	// round D) is the session's changed metadata keys – the SAME commit as
	// the content (writeDoc's metaEdits). A rejected meta edit (bad name,
	// managed key, enum) reads INLINE in the metadata block and the mode
	// stays open; everything else keeps the save banner.
	async function persist(markdown: string, verified = false): Promise<boolean> {
		if (!doc || saving) return false;
		setSaving(true);
		setSaveError(null);
		setMetaError(null);
		const meta = metaEditsOf();
		try {
			const { hash } = await saveDoc(
				doc.path,
				markdown,
				doc.hash,
				verified,
				meta,
			);
			clearDirty();
			onSaved({ ...doc, markdown, hash });
			// An OKF save always moves the frontmatter (the generated stamp at
			// minimum) – refetch so the payload's stamps, chips, and
			// verifiedByYou read canonical. The body string is identical, so
			// the mounted editor never reflows.
			if (okf && !reserved) onReload();
			return true;
		} catch (e) {
			if (e instanceof SaveError && e.status === 409) {
				setSaveError("changed on disk – copy your changes, then reload");
			} else if (meta !== undefined) {
				setMetaError(e instanceof Error ? e.message : String(e));
			} else {
				setSaveError(e instanceof Error ? e.message : String(e));
			}
			return false;
		} finally {
			setSaving(false);
		}
	}

	async function handleSave(verified = false): Promise<boolean> {
		const ok = await persist(editorRef.current?.getMarkdown() ?? "", verified);
		if (ok) {
			setEditing(false);
			setConfirmingCancel(false);
		}
		return ok;
	}

	// Comment anchoring (M4-2's one-commit contract): the mark is already
	// applied locally by the composer; ONE POST carries the serialized doc
	// body + base hash AND the thread – the server writes both files in a
	// single commit. A failure (e.g. a stale base hash → 409) leaves disk
	// untouched; the banner shows it and the buffer's mark just sits there
	// until saved or discarded. The mode is never flipped – commenting from
	// read mode stays in read mode.
	async function handleComment(id: string, quote: string, body: string) {
		if (!doc || saving) return;
		setSaving(true);
		setSaveError(null);
		try {
			// Protected main: on main the doc write drafts first (App) – the
			// baseHash and serialized body stay valid, a fresh checkout
			// doesn't change file content. False = App bannered; no POST.
			if (onDraftFirst && !(await onDraftFirst())) return;
			await addComment(doc.path, {
				id,
				quote,
				body,
				docBody: editorRef.current?.getMarkdown() ?? "",
				docBaseHash: doc.hash,
			});
			// The doc changed on disk (mark included) – refetch for the
			// canonical body + hash the next save or comment builds on. A
			// pending metadata edit keeps its part of the dirty flag (the
			// form's changes have NOT ridden this write).
			setDirty(metaDirty);
			onReload();
			onCommentsChanged();
		} catch (e) {
			setSaveError(e instanceof Error ? e.message : String(e));
		} finally {
			setSaving(false);
		}
	}

	// Cancel gates on unsaved work: the first ask raises the banner (Escape or
	// the Cancel button alike), confirming discards. A clean buffer just exits.
	function requestCancel() {
		if (!dirty) {
			setEditing(false);
			setSaveError(null);
			setConfirmingCancel(false);
			return;
		}
		if (confirmingCancel) {
			discardAndClose();
			return;
		}
		setConfirmingCancel(true);
	}

	function discardAndClose() {
		setEditing(false);
		setSaveError(null);
		setConfirmingCancel(false);
		clearDirty();
		setResetCount((c) => c + 1);
	}

	// The shared save-or-discard banner: Keep editing keeps the buffer;
	// Discard or a successful Save clears it and continues with `onGo`.
	// One shape, three users – a blocked branch switch (App's pendingAction),
	// a blocked header file op (same), and a blocked rename (the box opens
	// afterwards, so its continue is local).
	const guardBanner = (
		headline: string,
		onKeep: () => void,
		onGo: () => void,
	) => (
		<div className="conflict-banner" role="alert">
			<div>
				<strong>{headline}?</strong>
				This document has unsaved changes.
			</div>
			<div className="doc-actions">
				<button
					type="button"
					className="iconbtn subtle dismiss"
					onClick={onKeep}
				>
					Keep editing
				</button>
				<button
					type="button"
					className="iconbtn"
					onClick={() => {
						discardAndClose();
						onGo();
					}}
				>
					Discard
				</button>
				<button
					type="button"
					className="iconbtn primary"
					disabled={saving}
					onClick={() =>
						void handleSave().then((ok) => {
							if (ok) onGo();
						})
					}
				>
					Save
				</button>
			</div>
		</div>
	);
	const pendingBanner =
		pendingAction &&
		guardBanner(
			pendingAction.headline,
			onPendingActionCancel,
			pendingAction.go,
		);
	const pendingRenameBanner =
		pendingRename &&
		guardBanner(
			"Rename this document",
			() => setPendingRename(false),
			() => void proceedRename(),
		);

	// The metadata block's rows: the §3.1 note on reserved files, inputs
	// while editing, read-only rows otherwise.
	const metaBody = reserved ? (
		<p className="meta-note">
			This is a reserved OKF file – index.md and log.md hold no concept
			frontmatter (type, status, trust, references; §3.1), so there is nothing
			to edit. A directory index is generated by fragmt and regenerated whenever
			its folder's docs change.
		</p>
	) : editing ? (
		<div className="meta-rows">
			<label className="meta-row">
				<span className="meta-key">type:</span>
				<input
					value={metaForm.type}
					onChange={(e) => {
						setMetaForm({ ...metaForm, type: e.target.value });
						touchMeta();
					}}
					disabled={saving}
				/>
			</label>
			<label className="meta-row">
				<span className="meta-key">description:</span>
				<input
					value={metaForm.description}
					onChange={(e) => {
						setMetaForm({ ...metaForm, description: e.target.value });
						touchMeta();
					}}
					disabled={saving}
				/>
			</label>
			<label className="meta-row">
				<span className="meta-key">tags:</span>
				<input
					value={metaForm.tags}
					placeholder="comma-separated"
					onChange={(e) => {
						setMetaForm({ ...metaForm, tags: e.target.value });
						touchMeta();
					}}
					disabled={saving}
				/>
			</label>
			<label className="meta-row">
				<span className="meta-key">status:</span>
				{/* Enum-only (A2): the select is the convenience, the API
								    seam is the guard; a stored out-of-enum value stays
								    visible as its own option. */}
				<select
					value={metaForm.status}
					onChange={(e) => {
						setMetaForm({ ...metaForm, status: e.target.value });
						touchMeta();
					}}
					disabled={saving}
				>
					<option value="">unset</option>
					{statusOptions(metaForm.status).map((s) => (
						<option key={s} value={s}>
							{s}
						</option>
					))}
				</select>
			</label>
			<label className="meta-row">
				<span className="meta-key">stale_after:</span>
				<input
					type="datetime-local"
					value={metaForm.stale}
					onChange={(e) => {
						setMetaForm({ ...metaForm, stale: e.target.value });
						touchMeta();
					}}
					disabled={saving}
				/>
			</label>
			{/* §4.1 extension rows (operator round C): arbitrary scalar
							    keys, editable like the curated five (a cleared value
							    removes the key on save); string-array values and
							    anything else render READ-ONLY – hand-editing complex
							    YAML is raw-file territory.
							    ponytail: no structured editor for array-valued keys –
							    they display only; a chip editor can ride these rows
							    if ever wanted. */}
			{extRows?.editable.map((r) => (
				<label className="meta-row" key={r.key}>
					<span className="meta-key">{r.key}:</span>
					<input
						value={metaExt[r.key] ?? ""}
						onChange={(e) => {
							setMetaExt({ ...metaExt, [r.key]: e.target.value });
							touchMeta();
						}}
						disabled={saving}
					/>
				</label>
			))}
			{extRows?.readOnly.map((r) => (
				<div className="meta-row readonly" key={r.key} title={r.value}>
					<span className="meta-key">{r.key}:</span>
					<span className="meta-readonly-value">{r.value}</span>
				</div>
			))}
			{extRows !== null && extRows.readOnly.length > 0 && (
				<p className="meta-note">
					list-valued keys are read-only here – edit the raw file for complex
					YAML
				</p>
			)}
			{/* The managed/derived rows (operator round D): the view
							    block's friendly formatting, read-only in edit mode
							    too – generated/verified are stamped and append-only,
							    references/referenced-by derive from the body. */}
			{viewRows
				.filter((r) =>
					["generated", "verified", "references", "referenced-by"].includes(
						r.key,
					),
				)
				.map((r) => (
					<div className="meta-row readonly" key={r.key} title={r.value}>
						<span className="meta-key">{r.key}:</span>
						<span className="meta-readonly-value">{r.value}</span>
					</div>
				))}
			{/* The pending add-key rows (operator round D): "+ add key"
							    appends a removable name+value pair; every filled name
							    joins the SAME save's edits (the server's grammar gate
							    answers a bad name with an inline error, the session
							    stays open). */}
			{metaAdds.map((row) => (
				<div className="meta-row add" key={row.id}>
					<span className="meta-key">add:</span>
					<span className="meta-add">
						<input
							value={row.name}
							placeholder="name"
							aria-label="New key name"
							onChange={(e) => {
								setMetaAdds(
									metaAdds.map((r) =>
										r.id === row.id ? { ...r, name: e.target.value } : r,
									),
								);
								touchMeta();
							}}
							disabled={saving}
						/>
						<input
							value={row.value}
							placeholder="value"
							aria-label="New key value"
							onChange={(e) => {
								setMetaAdds(
									metaAdds.map((r) =>
										r.id === row.id ? { ...r, value: e.target.value } : r,
									),
								);
								touchMeta();
							}}
							disabled={saving}
						/>
						<button
							type="button"
							className="tool-btn"
							aria-label="Remove pending key"
							title="Remove"
							onClick={() =>
								setMetaAdds(metaAdds.filter((r) => r.id !== row.id))
							}
							disabled={saving}
						>
							<X aria-hidden="true" />
						</button>
					</span>
				</div>
			))}
			<button
				type="button"
				className="meta-add-key"
				onClick={() => {
					addSeq.current += 1;
					setMetaAdds([
						...metaAdds,
						{ id: addSeq.current, name: "", value: "" },
					]);
				}}
				disabled={saving}
			>
				+ add key
			</button>
		</div>
	) : (
		<div className="meta-rows">
			{viewRows.map((r) => (
				<div className="meta-row readonly" key={r.key} title={r.value}>
					<span className="meta-key">{r.key}:</span>
					<span className="meta-readonly-value">{r.value}</span>
				</div>
			))}
		</div>
	);

	// The byline line (ui v1): "vN · saved <date> · N min read" – the same in
	// both modes, so entering edit mode never reflows the masthead; the
	// ribbon and the command bar say "editing". The sync LED lives in the
	// status bar alone (DESIGN.md §7).
	const words = doc ? wordCount(doc.markdown) : 0;
	const lineSegs: string[] = [];
	if (docMeta) lineSegs.push(`v${docMeta.version}`);
	if (docMeta) lineSegs.push(`saved ${shortDate(docMeta.date)}`);
	if (doc) lineSegs.push(`${readMinutes(words)} min read`);

	// The masthead's standfirst follows the live form while editing (the
	// description is a metadata field), the stored value otherwise.
	const description = editing
		? metaForm.description.trim()
		: typeof doc?.frontmatter.description === "string"
			? doc.frontmatter.description.trim()
			: "";
	const docType =
		typeof doc?.frontmatter.type === "string"
			? doc.frontmatter.type.trim()
			: "";

	// The trust seal (information only – Verify lives in the command bar):
	// the tier as a stamped object, then who stands behind it – the latest
	// verification when one exists, else the generated stamp's actor.
	const trust = trustClass(docMeta?.okf);
	const latestVerified = Array.isArray(latestVerifiedEvents)
		? latestVerifiedEvents[latestVerifiedEvents.length - 1]
		: undefined;
	const sealLine = latestVerified?.by
		? `verified by ${latestVerified.by}${latestVerified.at ? ` · ${shortDate(latestVerified.at)}` : ""}`
		: doc?.frontmatter.generated?.by
			? `generated by ${doc.frontmatter.generated.by}`
			: null;

	// Connections (OKF): outgoing references, then backlinks, as cards.
	const references = doc?.frontmatter.references ?? [];
	const referencedBy = doc?.frontmatter["referenced-by"] ?? [];
	const connection = (path: string, backlink: boolean) => {
		const known = docs.find((d) => d.path === path);
		const mark = trustClass(docMetas[path]?.okf);
		return (
			<button
				key={`${backlink ? "in" : "out"}:${path}`}
				type="button"
				className={`cc${backlink ? " in" : ""}${known ? "" : " missing"}`}
				title={
					backlink
						? `${path} links here – Shift+click to preview`
						: `${path} – Shift+click to preview`
				}
				onClick={(e) => (e.shiftKey ? onOpenPreview(path) : onSelectDoc(path))}
			>
				<span className="p">
					{mark && (
						<span
							className={`tr ${mark}`}
							role="img"
							aria-label={TRUST_WORD[mark]}
						/>
					)}
					<span className="cc-path">{path}</span>
				</span>
				<span className="t">{known ? known.title : "missing"}</span>
			</button>
		);
	};

	// The history line's GitHub link: the doc's commit log on this branch.
	const docRepoPath = [repo?.docsRoot, selected].filter(Boolean).join("/");
	const historyUrl =
		repo?.slug && branch
			? `https://github.com/${encodeURIComponent(repo.slug.owner)}/${encodeURIComponent(repo.slug.repo)}/commits/${[...branch.split("/"), ...docRepoPath.split("/")].map(encodeURIComponent).join("/")}`
			: null;

	// One rendering path (M4 review decision 3): the editor is mounted in
	// BOTH modes – read is `editable: false` on the same instance, Edit/Save/
	// Cancel are mode flips with no remount (only a discard bumps the key to
	// drop the buffer). The editor carries the `markdown` typography class,
	// so the document reads identically in both modes (M2 pixel parity).
	return (
		<div className="docview">
			<CommandBar
				start={
					<>
						{cmdStart}
						{editing && dirty && (
							<span className="chip amber">
								<span className="led amber" aria-hidden="true" />
								Unsaved changes
							</span>
						)}
					</>
				}
			>
				{/* The draft pill (item 3): only on main, when a draft elsewhere
				    touches this doc – click checks the draft out (App). Its flip
				    side (M4-3): on a draft branch touching THIS doc, a
				    NON-clickable "on draft" chip (span – nothing to click). */}
				{doc && draftBranch && (
					<button type="button" className="draft-pill" onClick={onOpenDraft}>
						<Pencil aria-hidden="true" />
						draft exists – open
					</button>
				)}
				{doc && onDraft && <span className="chip accent">on draft</span>}
				{doc &&
					(editing ? (
						<>
							<button
								type="button"
								className="btn"
								onClick={requestCancel}
								disabled={saving}
							>
								<X aria-hidden="true" />
								<span className="label">Cancel</span>
							</button>
							{/* #33 (A1): Save as Verified – the event lands in the
							    save's own commit (the PUT's verified flag). */}
							{okf && !reserved && (
								<button
									type="button"
									className="btn line"
									onClick={() => void handleSave(true)}
									disabled={saving}
								>
									<BadgeCheck aria-hidden="true" />
									<span className="label">Save as verified</span>
								</button>
							)}
							<button
								type="button"
								className="btn primary"
								onClick={() => void handleSave()}
								disabled={saving}
							>
								<Check aria-hidden="true" />
								<span className="label">{saving ? "Saving…" : "Save"}</span>
								<span className="kbd" aria-hidden="true">
									Ctrl S
								</span>
							</button>
						</>
					) : (
						<>
							{/* #33 (A1): Verify beside Edit, read mode only – the
							    verified event in its own commit, the mode never flips
							    (comment resolve's sibling). Operator round D:
							    verifiedByYou reflects an own verification that
							    postdates the generated stamp – the filled style and
							    "Verified" word say so, and the button STAYS clickable
							    (events are append-only; re-verify is legal). Operator
							    round E: Edit REFUSES on a reserved file (disabled +
							    the §3.1 tooltip) – index.md/log.md are
							    fragmt-generated, and a saved edit would be
							    overwritten by the next regen. The core writeDoc stays
							    permissive; only the UI's affordance is withdrawn. */}
							{okf && !reserved && (
								<button
									type="button"
									className={`btn line${doc.verifiedByYou ? " verified" : ""}`}
									onClick={() => void handleVerify()}
									disabled={verifying || saving}
									title={
										doc.verifiedByYou && latestVerifiedAt
											? `verified by you · ${shortDate(latestVerifiedAt)} – click to re-verify`
											: undefined
									}
								>
									<BadgeCheck aria-hidden="true" />
									<span className="label">
										{verifying
											? "Verifying…"
											: doc.verifiedByYou
												? "Verified"
												: "Verify"}
									</span>
								</button>
							)}
							<button
								type="button"
								className="btn primary"
								disabled={reserved}
								title={
									reserved
										? "Reserved file – generated by fragmt; edits would be overwritten (OKF §3.1)"
										: undefined
								}
								onClick={() => {
									// App gates the flip (protected main: draft first)
									// – only a true enters edit mode. The flip IS the
									// unified session: content AND metadata (operator
									// round D) – the seed lands with it, fresh per
									// session.
									void onBeforeEdit().then((proceed) => {
										if (!proceed) return;
										if (doc) seedMetaForm(doc);
										setEditing(true);
										setSaveError(null);
									});
								}}
							>
								<Pencil aria-hidden="true" />
								<span className="label">Edit</span>
							</button>
						</>
					))}
			</CommandBar>
			<div className="desk">
				<div className="page">
					<article
						className={`sheet${editing ? " editing" : ""}`}
						ref={paneRef}
					>
						{editing && (
							<div className="edit-ribbon">
								<Pencil aria-hidden="true" />
								Editing on a draft
								{branch && <span className="mono">{branch}</span>}
							</div>
						)}
						{/* Dead-link note (M4-3 b6): a relative link that looks like a
						    doc but matches nothing – said plainly at the top of the
						    sheet, dismissable, never a tab hijack. */}
						{linkNotFound && (
							<div className="conflict-banner" role="status">
								<div>
									<strong>Link not found</strong>
									{linkNotFound}
								</div>
								<button
									type="button"
									className="iconbtn subtle dismiss"
									onClick={() => setLinkNotFound(null)}
								>
									Dismiss
								</button>
							</div>
						)}
						{conflictBanner}
						{pendingBanner}
						{pendingRenameBanner}
						{confirmingCancel && (
							<div className="conflict-banner" role="alert">
								<div>
									<strong>Discard unsaved changes?</strong>
									Your edits will be lost.
								</div>
								<div className="doc-actions">
									<button
										type="button"
										className="iconbtn subtle dismiss"
										onClick={() => setConfirmingCancel(false)}
									>
										Keep editing
									</button>
									<button
										type="button"
										className="iconbtn"
										onClick={discardAndClose}
									>
										Discard
									</button>
								</div>
							</div>
						)}
						{saveError && (
							<div className="conflict-banner" role="alert">
								<div>
									<strong>Save failed</strong>
									{saveError}
								</div>
								<button
									type="button"
									className="iconbtn subtle dismiss"
									onClick={() => {
										setEditing(false);
										setSaveError(null);
										clearDirty();
										onReload();
									}}
								>
									Reload
								</button>
							</div>
						)}
						{doc && (
							<header className="masthead">
								<div className="kicker">
									{okf && docType && <span className="type">{docType}</span>}
									{okf && docType && <span className="rule" />}
									<span>{selected}</span>
								</div>
								<h1 className="title">{displayName}</h1>
								{description && <p className="standfirst">{description}</p>}
								<div className="byline">
									<Avatar
										author={docMeta?.author ?? ""}
										email={docMeta?.authorEmail ?? ""}
										authors={authors}
									/>
									<div className="who">
										<b>{docMeta?.author ?? "–"}</b>
										<span>{lineSegs.join(" · ")}</span>
									</div>
									<span className="sp" />
									{okf && trust && (
										<div
											className={`seal ${trust}`}
											title="OKF trust tier (§5.3)"
										>
											<span className="ring" aria-hidden="true">
												{SEAL_GLYPH[trust]}
											</span>
											<div>
												<b>{SEAL_WORD[trust]}</b>
												{sealLine && <span>{sealLine}</span>}
											</div>
										</div>
									)}
								</div>
							</header>
						)}
						{/* #33 (D2, operator round D): the unified metadata block – ONE
						    surface for viewing and editing, between the masthead and
						    the content. Read mode: a native collapsed details/summary
						    with one read-only row per key – the curated five, the
						    §4.1 extensions, and the managed/derived family
						    friendly-formatted (metaViewRows). Edit mode: the block
						    auto-expands (the `open` attribute rides the mode; a
						    read-mode toggle is the user's own) and its rows become
						    inputs – the command bar's Save/Cancel own the session,
						    content and metadata together. Reserved docs render the
						    §3.1 note inside the block, never rows (§3.1). */}
						{doc && okf && (
							<details className="meta-block" open={editing || undefined}>
								<summary>
									<ChevronRight className="ch" aria-hidden="true" />
									<span className="meta-title">Details</span>
									<span className="pv">
										{reserved
											? "reserved file"
											: [
													docType,
													typeof doc.frontmatter.status === "string"
														? doc.frontmatter.status
														: "",
													`${viewRows.length} keys`,
												]
													.filter(Boolean)
													.join(" · ")}
									</span>
								</summary>
								{metaBody}
								{metaError && (
									<span className="rename-error" role="alert">
										{metaError}
									</span>
								)}
							</details>
						)}
						{/* The hard-wrap warning (owner round): stateless – visible
						    while editing AND the loaded body still hard-wraps; a save
						    that reflows (onSaved updates doc.markdown) or leaving
						    edit mode removes it. No dismiss button by design. */}
						{editing && doc && hasHardWraps(doc.markdown) && (
							<p className="notice hard-wrap-note">
								<TriangleAlert aria-hidden="true" />
								<span>
									This document has hard-wrapped paragraphs. The editor saves
									each paragraph as a single line, so saving will reflow the
									document and the diff will show it fully changed – the content
									itself is unaffected.
								</span>
							</p>
						)}
						{doc ? (
							<div className="prose">
								<EditorPane
									key={`${doc.path}#${resetCount}`}
									ref={editorRef}
									markdown={doc.markdown}
									editable={editing}
									saving={saving}
									onDirtyChange={editorDirty}
									onSave={() => void handleSave()}
									onCancel={requestCancel}
									onEscapeSurfacesClear={onEscapeSurfacesClear}
									onComment={(id, quote, body) =>
										void handleComment(id, quote, body)
									}
									onSpanClick={onSpanClick}
									docPath={selected ?? doc.path}
									docs={docs}
									folders={folders}
									onSelectDoc={onSelectDoc}
									onOpenPreview={onOpenPreview}
									onSelectFolder={onSelectFolder}
									onLinkNotFound={setLinkNotFound}
									anchor={pendingAnchor}
									onAnchorConsumed={onAnchorConsumed}
									changedLines={changedLines}
								/>
							</div>
						) : null}
						{doc && okf && (
							<section className="conn" aria-label="Connections">
								<div className="conn-h">
									<h3>Connections</h3>
									<span>
										{references.length}{" "}
										{references.length === 1 ? "reference" : "references"} ·{" "}
										{referencedBy.length}{" "}
										{referencedBy.length === 1 ? "backlink" : "backlinks"}
									</span>
								</div>
								{reserved ? (
									<p className="conn-note">
										Reserved file – index.md and log.md carry no reference
										fields (OKF §3.1). An index's links are its generated
										content.
									</p>
								) : references.length + referencedBy.length === 0 ? (
									<p className="conn-note">
										No connections yet – body links land here on save.
									</p>
								) : (
									<div className="conn-grid">
										{references.map((p) => connection(p, false))}
										{referencedBy.map((p) => connection(p, true))}
									</div>
								)}
							</section>
						)}
						{doc && docMeta && (
							<p className="history">
								<Clock aria-hidden="true" />
								<span>
									{docMeta.version}{" "}
									{docMeta.version === 1 ? "version" : "versions"} · last by{" "}
									{docMeta.author}, {shortDate(docMeta.date)}
								</span>
								{historyUrl && (
									<a href={historyUrl} target="_blank" rel="noreferrer">
										History on GitHub ↗
									</a>
								)}
							</p>
						)}
					</article>
				</div>
			</div>
		</div>
	);
}
