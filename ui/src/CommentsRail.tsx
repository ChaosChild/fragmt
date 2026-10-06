import {
	Check,
	MessageSquare,
	Reply,
	RotateCcw,
	Trash2,
	X,
} from "lucide-react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import type { CommentThread } from "./api";
import { isAgent } from "./display";
import { type AtDoc, filterAtDocs } from "./editor/at";
import { layoutNotes } from "./margin-layout";

/** "2h ago" for recent, a locale date once older – the rail's quiet meta. */
function timeAgo(iso: string): string {
	const ms = Date.now() - new Date(iso).getTime();
	if (Number.isNaN(ms)) return "";
	const min = Math.floor(ms / 60_000);
	if (min < 1) return "now";
	if (min < 60) return `${min}m ago`;
	const hours = Math.floor(min / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	if (days < 7) return `${days}d ago`;
	return new Date(iso).toLocaleDateString();
}

/** The pin's two letters – the author's initials. */
function initials(name: string): string {
	return name
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((w) => w[0] ?? "")
		.join("")
		.toUpperCase();
}

/** Restart the flash animation (class off → reflow → class on). */
function flash(el: Element) {
	el.classList.remove("flash");
	void (el as HTMLElement).offsetWidth;
	el.classList.add("flash");
}

/** Regex-escape a literal path for the linkify alternation. */
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A comment body with known doc paths as in-app links (M4-2): split on the
 * known path list, longest first so overlapping paths can't half-match, with
 * a word-boundary-ish guard so "a.md" doesn't fire inside "beta.md".
 * ponytail: regex rebuilt per render – the rail holds a handful of bodies.
 */
function DocRefText({
	text,
	docs,
	onOpenDoc,
}: {
	text: string;
	docs: AtDoc[];
	onOpenDoc: (path: string, opts?: { preview?: boolean }) => void;
}) {
	const paths = docs
		.map((d) => d.path)
		.filter(Boolean)
		.sort((a, b) => b.length - a.length);
	if (paths.length === 0 || !text) return <>{text}</>;
	const re = new RegExp(`(?<![\\w/.-])(${paths.map(escapeRe).join("|")})`, "g");
	const out: ReactNode[] = [];
	let last = 0;
	for (const m of text.matchAll(re)) {
		const i = m.index ?? 0;
		if (i > last) out.push(text.slice(last, i));
		out.push(
			<button
				type="button"
				className="doc-ref"
				key={`${m[0]}@${i}`}
				title={`${m[0]} – Ctrl/Cmd+click to preview`}
				onClick={(e) =>
					onOpenDoc(
						m[0],
						e.ctrlKey || e.metaKey ? { preview: true } : undefined,
					)
				}
			>
				{m[0]}
			</button>,
		);
		last = i + m[0].length;
	}
	if (out.length === 0) return <>{text}</>;
	out.push(text.slice(last));
	return <>{out}</>;
}

function ThreadCard({
	thread,
	orphan,
	agents,
	docs,
	onOpenDoc,
	onJump,
	onReply,
	onResolve,
	onReopen,
	onDelete,
}: {
	thread: CommentThread;
	/** No live data-c span in the rendered doc AND a quote to lose (the M4
	 *  orphan rule) – a quote-less thread is doc-level (#61), not an orphan. */
	orphan: boolean;
	/** Config agent display names (meta) – the agent chip (M4-4 b5). */
	agents: string[];
	/** The tree's docs – @ mentions and body linkification (M4-2). */
	docs: AtDoc[];
	onOpenDoc: (path: string, opts?: { preview?: boolean }) => void;
	onJump: (id: string) => void;
	onReply: (id: string, body: string) => Promise<boolean>;
	onResolve: (id: string) => void;
	onReopen: (id: string) => void;
	onDelete: (id: string) => void;
}) {
	const [replying, setReplying] = useState(false);
	const [text, setText] = useState("");
	const [sending, setSending] = useState(false);
	// Reply collapsing: long stacks show the opening + latest reply only;
	// the middle hides behind the expander until asked for.
	const [expanded, setExpanded] = useState(false);
	// @ mentions (M4-2), hand-rolled – a textarea is not Tiptap: the word
	// before the caret (`@…`), a filtered list above the box, and the three
	// keys that navigate it. `start` is the @'s index; Escape suppresses
	// reopening until a different @ word starts.
	const [at, setAt] = useState<{
		items: AtDoc[];
		start: number;
		sel: number;
	} | null>(null);
	const atDismissed = useRef<number | null>(null);
	const replyBoxRef = useRef<HTMLTextAreaElement>(null);
	// Opening the form hands focus to it – focus management after the user's
	// own Reply click, done programmatically (no autoFocus attribute).
	useEffect(() => {
		if (replying) replyBoxRef.current?.focus();
	}, [replying]);

	function detectAt(el: HTMLTextAreaElement) {
		const caret = el.selectionStart ?? 0;
		const m = el.value.slice(0, caret).match(/@([^\s@]*)$/);
		if (!m || atDismissed.current === caret - m[0].length) {
			setAt(null);
			return;
		}
		atDismissed.current = null;
		setAt({
			items: filterAtDocs(docs, m[1]).slice(0, 8),
			start: caret - m[0].length,
			sel: 0,
		});
	}

	/** Replace the @word with the doc path text; caret lands after it. */
	function insertAtDoc(item: AtDoc) {
		const el = replyBoxRef.current;
		if (!el || !at) return;
		const caret = el.selectionStart ?? el.value.length;
		const pos = at.start + item.path.length;
		setText(el.value.slice(0, at.start) + item.path + el.value.slice(caret));
		setAt(null);
		requestAnimationFrame(() => {
			el.focus();
			el.setSelectionRange(pos, pos);
		});
	}

	async function submitReply() {
		const body = text.trim();
		if (!body || sending) return;
		setSending(true);
		// Success closes the form; a failure keeps the text – never lose the write.
		if (await onReply(thread.id, body)) {
			setReplying(false);
			setText("");
		}
		setSending(false);
	}

	// Replies beyond the opening comment – one shows as-is, none show
	// nothing, 2+ collapse to the latest plus the expander above.
	const rest = thread.replies.slice(1);

	const classes = [
		"comment-thread",
		thread.resolved ? "resolved" : "",
		orphan ? "orphan" : "",
	]
		.filter(Boolean)
		.join(" ");
	// data-c keys the rail-side jump target (doc→rail focus); orphans have
	// no span to jump to, so they render without it.
	return (
		<div className={classes} data-c={orphan ? undefined : thread.id}>
			{thread.quote === "" ? (
				/* #61: a CLI-started doc-level thread has no span and no quote –
				   an honest header instead of empty quotes; Reply/Resolve stay. */
				<div className="comment-quote">Doc-level note</div>
			) : orphan ? (
				<div className="comment-quote">&ldquo;{thread.quote}&rdquo;</div>
			) : (
				<button
					type="button"
					className="comment-quote"
					onClick={() => onJump(thread.id)}
					aria-label="Jump to commented text"
				>
					&ldquo;{thread.quote}&rdquo;
				</button>
			)}
			<div className="comment-header">
				<span className="author">
					{thread.author}
					{isAgent(thread.author, agents) && (
						<span className="agent-chip">agent</span>
					)}
				</span>
				<span className="time">{timeAgo(thread.createdAt)}</span>
			</div>
			<div className="comment-body">
				<DocRefText
					text={thread.replies[0]?.body ?? ""}
					docs={docs}
					onOpenDoc={onOpenDoc}
				/>
			</div>
			{rest.length > 1 && !expanded && (
				<button
					type="button"
					className="label-meta show-earlier"
					aria-expanded={expanded}
					onClick={() => setExpanded(true)}
				>
					Show {rest.length - 1} earlier{" "}
					{rest.length - 1 === 1 ? "reply" : "replies"}
				</button>
			)}
			{(expanded ? rest : rest.slice(-1)).map((reply) => (
				<div className="comment-reply" key={reply.at}>
					<div className="comment-header">
						<span className="author">
							{reply.author}
							{isAgent(reply.author, agents) && (
								<span className="agent-chip">agent</span>
							)}
						</span>
						<span className="time">{timeAgo(reply.at)}</span>
					</div>
					<div className="comment-body">
						<DocRefText text={reply.body} docs={docs} onOpenDoc={onOpenDoc} />
					</div>
				</div>
			))}
			{orphan && (
				<p className="orphan-note">
					Orphaned &mdash; original text no longer in document
				</p>
			)}
			<div className="comment-actions">
				{thread.resolved ? (
					/* The mock's .comment-thread.resolved shape: Reopen + Delete. */
					<button type="button" onClick={() => onReopen(thread.id)}>
						<RotateCcw aria-hidden="true" />
						Reopen
					</button>
				) : (
					!orphan && (
						<>
							<button type="button" onClick={() => setReplying((v) => !v)}>
								<Reply aria-hidden="true" />
								Reply
							</button>
							<button type="button" onClick={() => onResolve(thread.id)}>
								<Check aria-hidden="true" />
								Resolve
							</button>
						</>
					)
				)}
				<button
					type="button"
					className="danger"
					onClick={() => onDelete(thread.id)}
				>
					<Trash2 aria-hidden="true" />
					Delete
				</button>
			</div>
			{replying && (
				<form
					className="popover-form"
					onSubmit={(e) => {
						e.preventDefault();
						void submitReply();
					}}
				>
					<div className="at-wrap">
						<textarea
							rows={3}
							required
							aria-label={`Reply to ${thread.author}`}
							placeholder="Reply…"
							value={text}
							ref={replyBoxRef}
							onChange={(e) => {
								setText(e.target.value);
								detectAt(e.target);
							}}
							onBlur={() => setAt(null)}
							onKeyDown={(e) => {
								if (!at) return;
								if (e.key === "ArrowDown") {
									e.preventDefault();
									setAt((a) =>
										a
											? { ...a, sel: Math.min(a.sel + 1, a.items.length - 1) }
											: a,
									);
								} else if (e.key === "ArrowUp") {
									e.preventDefault();
									setAt((a) => (a ? { ...a, sel: Math.max(0, a.sel - 1) } : a));
								} else if (e.key === "Enter") {
									e.preventDefault();
									const item = at.items[at.sel];
									if (item) insertAtDoc(item);
								} else if (e.key === "Escape") {
									e.preventDefault();
									e.stopPropagation();
									atDismissed.current = at.start;
									setAt(null);
								}
							}}
						/>
						{at && at.items.length > 0 && (
							// The slash menu's panel and buttons, anchored above the
							// textarea (mousedown-prevented items keep the caret).
							<div
								className="slash-menu at-list"
								role="menu"
								aria-label="Reference a document"
							>
								{at.items.map((d, i) => (
									<button
										type="button"
										role="menuitem"
										key={d.path}
										data-selected={i === at.sel || undefined}
										onMouseDown={(e) => e.preventDefault()}
										onMouseEnter={() =>
											setAt((a) => (a ? { ...a, sel: i } : a))
										}
										onClick={() => insertAtDoc(d)}
									>
										<span>{d.title}</span>
										<span className="kbd">{d.path}</span>
									</button>
								))}
							</div>
						)}
					</div>
					<div className="popover-actions">
						<button
							type="button"
							className="iconbtn subtle"
							onClick={() => setReplying(false)}
						>
							Cancel
						</button>
						<button
							type="submit"
							className="iconbtn primary"
							disabled={sending}
						>
							Reply
						</button>
					</div>
				</form>
			)}
		</div>
	);
}

/**
 * The margin (ui v1, phase 5; the thread list since M4-5): marginalia beside
 * the sheet. Live threads sit level with their highlighted text, placed by
 * layoutNotes from measured anchor tops; orphans (and, when shown, resolved
 * threads whose span is gone) list below under "Not anchored". App owns the
 * sidecar state and the mutations; this owns the layout and its UI state
 * (resolved toggle, the focused note, reply boxes). It renders inside the
 * doc's scroll container (DocView's .page), so notes scroll with the text;
 * ≤1180px the CSS turns it back into the static list of the bottom sheet.
 */
export function CommentsRail({
	threads,
	liveIds,
	agents,
	onClose,
	focus,
	onReply,
	onResolve,
	onReopen,
	onDelete,
	error,
	docs,
	onOpenDoc,
	pins = false,
}: {
	threads: CommentThread[];
	/** Ids whose data-c span is present in the rendered doc (App's reconcile). */
	liveIds: Set<string>;
	/** Config agent display names (meta) – the agent chip (M4-4 b5). */
	agents: string[];
	/** Fold the ≤1180px sheet – a jump-to-doc target reads best full-width
	 *  there; the desktop margin is permanent, nothing to close. */
	onClose: () => void;
	/** Doc→margin focus trigger; `n` re-arms repeated clicks on the same span. */
	focus: { id: string; n: number } | null;
	onReply: (id: string, body: string) => Promise<boolean>;
	onResolve: (id: string) => void;
	/** A resolved thread's Reopen action (M4-2) – back to the open list. */
	onReopen: (id: string) => void;
	onDelete: (id: string) => void;
	error: string | null;
	/** The tree's docs – @ mentions and body linkification (M4-2). */
	docs: AtDoc[];
	/** A linkified doc path was clicked – open that doc in the main pane
	 *  through App's guarded navigation, or (Ctrl/Cmd+click) in the preview. */
	onOpenDoc: (path: string, opts?: { preview?: boolean }) => void;
	/** A preview shares the desk (ui v1, phase 6): notes fold to 34px author
	 *  pins at the same positions; a pin (or its highlight) expands that one
	 *  note as a popover, Escape folds it again. */
	pins?: boolean;
}) {
	const [showResolved, setShowResolved] = useState(false);
	const [focused, setFocused] = useState<string | null>(null);
	const [expanded, setExpanded] = useState<string | null>(null);
	useEffect(() => {
		if (!pins) setExpanded(null);
	}, [pins]);
	// Escape folds the popover – on document, so it is consumed before App's
	// window-level chain would close the preview itself.
	useEffect(() => {
		if (!expanded) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape" || e.defaultPrevented) return;
			e.preventDefault();
			setExpanded(null);
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [expanded]);
	const notesRef = useRef<HTMLDivElement>(null);
	const [tops, setTops] = useState<Map<string, number>>(() => new Map());
	const [notesHeight, setNotesHeight] = useState(0);
	// Read inside the focus effect without re-running it on every refetch.
	const threadsRef = useRef(threads);
	threadsRef.current = threads;
	// Read at focus time only – toggling pins must not replay the last focus.
	const pinsRef = useRef(pins);
	pinsRef.current = pins;

	const resolvedCount = threads.filter((t) => t.resolved).length;
	const openCount = threads.length - resolvedCount;
	const visible = (t: CommentThread) => !t.resolved || showResolved;
	const placedThreads = threads.filter((t) => liveIds.has(t.id) && visible(t));
	const unanchored = threads.filter((t) => !liveIds.has(t.id) && visible(t));

	// Measure and place. Anchors are the sheet's own data-c spans (read mode
	// and the editor render the same ones); tops are relative to the notes
	// container, which scrolls with the sheet.
	const frame = useRef(0);
	const layout = useCallback(() => {
		cancelAnimationFrame(frame.current);
		frame.current = requestAnimationFrame(() => {
			const root = notesRef.current;
			const sheet = root?.closest(".page")?.querySelector(".sheet");
			if (!root || !sheet) return;
			const base = root.getBoundingClientRect().top;
			const items = (Array.from(root.children) as HTMLElement[])
				.filter((el) => el.classList.contains("note"))
				.map((el) => {
					const id = el.dataset.note ?? "";
					const anchor = sheet.querySelector(`[data-c="${CSS.escape(id)}"]`);
					return {
						id,
						anchorTop: anchor
							? anchor.getBoundingClientRect().top - base
							: null,
						height: el.offsetHeight,
					};
				});
			// Pins ride a sheet that scrolls on its own (preview mode): an
			// anchor scrolled above the view takes its pin out with it.
			const next = layoutNotes(items, {
				gap: 12,
				top: pinsRef.current ? Number.NEGATIVE_INFINITY : 0,
				focused,
			});
			let bottom = 0;
			for (const it of items) {
				const y = next.get(it.id);
				if (y !== undefined) bottom = Math.max(bottom, y + it.height);
			}
			setTops((prev) =>
				prev.size === next.size &&
				[...next].every(([id, y]) => prev.get(id) === y)
					? prev
					: next,
			);
			setNotesHeight(bottom);
		});
	}, [focused]);

	// Re-layout on everything that can move an anchor or resize a note: the
	// thread list and toggles (this render), the sheet's size (typing that
	// adds a line, image loads, window and theme changes), any edit inside
	// the sheet (a MutationObserver – the editor's updates without plumbing a
	// callback through DocView), each note's size, and late web fonts.
	// Every render may move the notes; layout() is rAF-throttled and bails
	// out when nothing moved.
	useLayoutEffect(() => {
		layout();
	});
	// biome-ignore lint/correctness/useExhaustiveDependencies: placedThreads.length is the re-observe trigger – a new note needs its own ResizeObserver entry.
	useEffect(() => {
		const root = notesRef.current;
		const sheet = root?.closest(".page")?.querySelector(".sheet");
		if (!root || !sheet) return;
		// (happy-dom and older engines lack ResizeObserver – the mutation
		// and render triggers still lay out.)
		const ro =
			typeof ResizeObserver === "undefined" ? null : new ResizeObserver(layout);
		ro?.observe(sheet);
		for (const el of Array.from(root.children)) ro?.observe(el);
		// In preview mode the sheet is its own scroller – its anchors move
		// under a still margin, so the pins follow every scroll.
		sheet.addEventListener("scroll", layout, { passive: true });
		const mo = new MutationObserver(layout);
		mo.observe(sheet, { childList: true, subtree: true, characterData: true });
		void document.fonts?.ready.then(layout);
		// The previous run's cleanup cancelled any pending frame – including
		// the one this render's layout effect just scheduled – so lay out
		// again rather than rely on an observer firing.
		layout();
		return () => {
			sheet.removeEventListener("scroll", layout);
			ro?.disconnect();
			mo.disconnect();
			cancelAnimationFrame(frame.current);
		};
	}, [layout, placedThreads.length]);

	// A highlighted span was clicked in the doc: focus its note (a resolved
	// target forces the toggle on – the showResolved dep re-runs this once
	// the note exists) and flash it. The re-layout lands the note level with
	// its anchor.
	useEffect(() => {
		if (!focus) return;
		if (
			!showResolved &&
			threadsRef.current.find((t) => t.id === focus.id)?.resolved
		) {
			setShowResolved(true);
		}
		setFocused(focus.id);
		if (pinsRef.current) setExpanded(focus.id);
		const card = notesRef.current?.parentElement?.querySelector(
			`[data-c="${CSS.escape(focus.id)}"]`,
		);
		if (card) {
			// ≤1180px the margin is the bottom sheet's list – bring it in view.
			card.scrollIntoView({ behavior: "smooth", block: "nearest" });
			flash(card);
		}
	}, [focus, showResolved]);

	// The reverse direction: the quote button scrolls the doc's span into view
	// and flashes it (app.html's jump). onClose folds the ≤1180px sheet away
	// so the target reads full-width.
	function jumpToDoc(id: string) {
		const target = document.querySelector(
			`.sheet [data-c="${CSS.escape(id)}"]`,
		);
		if (!target) return;
		onClose();
		target.scrollIntoView({ behavior: "smooth", block: "center" });
		flash(target);
	}

	const card = (t: CommentThread) => (
		<ThreadCard
			key={t.id}
			thread={t}
			// #61: a quote-less thread is doc-level – no span by design, so the
			// orphan treatment (warn border, no Reply/Resolve) never applies.
			orphan={!liveIds.has(t.id) && t.quote !== ""}
			agents={agents}
			docs={docs}
			onOpenDoc={onOpenDoc}
			onJump={jumpToDoc}
			onReply={onReply}
			onResolve={onResolve}
			onReopen={onReopen}
			onDelete={onDelete}
		/>
	);

	return (
		<div className="margin-body">
			<div className="margin-h">
				<MessageSquare aria-hidden="true" />
				<b>Notes</b>
				<span className="n">{openCount}</span>
				<span className="sp" />
				{resolvedCount > 0 && (
					<button
						type="button"
						className="show-resolved"
						aria-pressed={showResolved}
						onClick={() => setShowResolved((v) => !v)}
					>
						{showResolved
							? "Hide resolved"
							: `Show resolved · ${resolvedCount}`}
					</button>
				)}
				{/* The ≤1180px sheet's fold (hidden on desktop – the margin has
				    no closed state there). */}
				<button
					type="button"
					className="margin-close"
					aria-label="Close comments"
					title="Close comments"
					onClick={onClose}
				>
					<X aria-hidden="true" />
				</button>
			</div>
			{error && (
				<p className="rail-error" role="alert">
					{error}
				</p>
			)}
			<div
				className="margin-notes"
				ref={notesRef}
				style={{ height: notesHeight }}
			>
				{pins &&
					placedThreads.map((t) => (
						<div
							key={t.id}
							className={`note pin${expanded === t.id ? " on" : ""}`}
							data-note={t.id}
							style={
								tops.has(t.id)
									? { top: tops.get(t.id) }
									: { visibility: "hidden" }
							}
						>
							<button
								type="button"
								className="pin-btn"
								aria-label={`Comment by ${t.author}: ${t.quote}`}
								title={`${t.author}: ${t.replies[0]?.body ?? ""}`}
								aria-expanded={expanded === t.id}
								onClick={() => {
									setFocused(t.id);
									setExpanded((x) => (x === t.id ? null : t.id));
								}}
							>
								{initials(t.author)}
							</button>
						</div>
					))}
				{pins &&
					expanded &&
					tops.has(expanded) &&
					placedThreads
						.filter((t) => t.id === expanded)
						.map((t) => (
							<div
								key={t.id}
								className="pin-pop"
								style={{ top: tops.get(t.id) }}
							>
								{card(t)}
							</div>
						))}
				{!pins &&
					placedThreads.map((t) => (
						// biome-ignore lint/a11y/noStaticElementInteractions: a pointer convenience – the card's own buttons are the keyboard path; focusing only re-runs the layout.
						// biome-ignore lint/a11y/useKeyWithClickEvents: as above.
						<div
							key={t.id}
							className={`note${focused === t.id ? " on" : ""}`}
							data-note={t.id}
							style={
								tops.has(t.id)
									? { top: tops.get(t.id) }
									: { visibility: "hidden" }
							}
							onClick={() => setFocused(t.id)}
						>
							{card(t)}
						</div>
					))}
			</div>
			{!pins && unanchored.length > 0 && (
				<div className="margin-rest">
					<p className="margin-group">Not anchored</p>
					{unanchored.map(card)}
				</div>
			)}
			{!pins && (
				<p className="margin-hint">Select text in the doc to leave a note.</p>
			)}
		</div>
	);
}
