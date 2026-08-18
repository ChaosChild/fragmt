import { Check, Reply, RotateCcw, Trash2, X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { CommentThread } from "./api";
import { type AtDoc, filterAtDocs } from "./editor/at";
import { ThemeToggle } from "./ThemeToggle";

/** "2h ago" for recent, a locale date once older — the rail's quiet meta. */
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
 * ponytail: regex rebuilt per render — the rail holds a handful of bodies.
 */
function DocRefText({
	text,
	docs,
	onOpenDoc,
}: {
	text: string;
	docs: AtDoc[];
	onOpenDoc: (path: string) => void;
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
				onClick={() => onOpenDoc(m[0])}
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
	docs,
	onOpenDoc,
	onJump,
	onReply,
	onResolve,
	onReopen,
	onDelete,
}: {
	thread: CommentThread;
	/** No live data-c span in the rendered doc (M4 orphan rule). */
	orphan: boolean;
	/** The tree's docs — @ mentions and body linkification (M4-2). */
	docs: AtDoc[];
	onOpenDoc: (path: string) => void;
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
	// @ mentions (M4-2), hand-rolled — a textarea is not Tiptap: the word
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
	// Opening the form hands focus to it — focus management after the user's
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
		// Success closes the form; a failure keeps the text — never lose the write.
		if (await onReply(thread.id, body)) {
			setReplying(false);
			setText("");
		}
		setSending(false);
	}

	// Replies beyond the opening comment — one shows as-is, none show
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
			{orphan ? (
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
				<span className="author">{thread.author}</span>
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
						<span className="author">{reply.author}</span>
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
 * The comments rail (M4-5): margin notes for the open doc, per the staged
 * app.html markup. App owns the sidecar state and the mutations; the rail is
 * presentational plus its own UI state (resolved toggle, reply boxes). The
 * head also carries the app's sync LED + theme toggle (review decision 2) —
 * `open` only matters where the CSS turns the rail into a bottom sheet.
 */
export function CommentsRail({
	threads,
	liveIds,
	led,
	ledLabel,
	open,
	onClose,
	focus,
	onReply,
	onResolve,
	onReopen,
	onDelete,
	error,
	docs,
	onOpenDoc,
}: {
	threads: CommentThread[];
	/** Ids whose data-c span is present in the rendered doc (App's reconcile). */
	liveIds: Set<string>;
	led: "green" | "amber" | "red";
	ledLabel: string;
	open: boolean;
	onClose: () => void;
	/** Doc→rail jump trigger; `n` re-arms repeated clicks on the same span. */
	focus: { id: string; n: number } | null;
	onReply: (id: string, body: string) => Promise<boolean>;
	onResolve: (id: string) => void;
	/** A resolved thread's Reopen action (M4-2) — back to the open list. */
	onReopen: (id: string) => void;
	onDelete: (id: string) => void;
	error: string | null;
	/** The tree's docs — @ mentions and body linkification (M4-2). */
	docs: AtDoc[];
	/** A linkified doc path was clicked — open that doc (App). */
	onOpenDoc: (path: string) => void;
}) {
	const [showResolved, setShowResolved] = useState(false);
	const bodyRef = useRef<HTMLDivElement>(null);
	// Read inside the focus effect without re-running it on every refetch.
	const threadsRef = useRef(threads);
	threadsRef.current = threads;

	const resolvedCount = threads.filter((t) => t.resolved).length;

	// A highlighted span was clicked in the doc: reveal it (a resolved target
	// forces the toggle on — the showResolved dep re-runs this once the card
	// exists), scroll it into view, flash it.
	useEffect(() => {
		if (!focus) return;
		if (
			!showResolved &&
			threadsRef.current.find((t) => t.id === focus.id)?.resolved
		) {
			setShowResolved(true);
		}
		const card = bodyRef.current?.querySelector(
			`[data-c="${CSS.escape(focus.id)}"]`,
		);
		if (card) {
			card.scrollIntoView({ behavior: "smooth", block: "center" });
			flash(card);
		}
	}, [focus, showResolved]);

	// The reverse direction: the quote button scrolls the doc's span into view
	// and flashes it (app.html's jump). onClose folds the mobile sheet away —
	// a visual no-op on desktop, where the rail is a static margin column.
	function jumpToDoc(id: string) {
		const target = document.querySelector(`.main [data-c="${CSS.escape(id)}"]`);
		if (!target) return;
		onClose();
		target.scrollIntoView({ behavior: "smooth", block: "center" });
		flash(target);
	}

	return (
		<aside
			className={`comments-rail${open ? " open" : ""}`}
			aria-label="Comments"
		>
			<div className="rail-head">
				<span className="rail-title">Comments · {threads.length}</span>
				<div className="rail-spacer" />
				<span
					className={`sync-indicator${led === "amber" ? " warn" : led === "red" ? " err" : ""}`}
					role="status"
					title={ledLabel}
				>
					<span className={`led ${led}`} aria-hidden="true" />
					{ledLabel}
				</span>
				<ThemeToggle />
				<button
					type="button"
					className="rail-close"
					aria-label="Close comments"
					onClick={onClose}
				>
					<X aria-hidden="true" />
				</button>
			</div>
			<div className="rail-body" ref={bodyRef}>
				{error && (
					<p className="rail-error" role="alert">
						{error}
					</p>
				)}
				{threads.length === 0 && (
					<p className="label-meta" style={{ padding: "4px 4px 16px" }}>
						No comments yet &mdash; select text in the document to anchor a
						note.
					</p>
				)}
				{/* Open threads always sit on top; the resolved block renders
				    after them (and after the toggle) so expanding it never
				    pushes the open ones down the rail. */}
				{threads
					.filter((t) => !t.resolved)
					.map((t) => (
						<ThreadCard
							key={t.id}
							thread={t}
							orphan={!liveIds.has(t.id)}
							docs={docs}
							onOpenDoc={onOpenDoc}
							onJump={jumpToDoc}
							onReply={onReply}
							onResolve={onResolve}
							onReopen={onReopen}
							onDelete={onDelete}
						/>
					))}
				{resolvedCount > 0 && (
					<button
						type="button"
						className="label-meta show-resolved"
						aria-pressed={showResolved}
						onClick={() => setShowResolved((v) => !v)}
					>
						{showResolved
							? "Hide resolved"
							: `Show resolved (${resolvedCount})`}
					</button>
				)}
				{showResolved &&
					threads
						.filter((t) => t.resolved)
						.map((t) => (
							<ThreadCard
								key={t.id}
								thread={t}
								orphan={!liveIds.has(t.id)}
								docs={docs}
								onOpenDoc={onOpenDoc}
								onJump={jumpToDoc}
								onReply={onReply}
								onResolve={onResolve}
								onReopen={onReopen}
								onDelete={onDelete}
							/>
						))}
			</div>
		</aside>
	);
}
