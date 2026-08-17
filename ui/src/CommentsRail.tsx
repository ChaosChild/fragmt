import { Check, Reply, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CommentThread } from "./api";
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

function ThreadCard({
	thread,
	orphan,
	onJump,
	onReply,
	onResolve,
	onDelete,
}: {
	thread: CommentThread;
	/** No live data-c span in the rendered doc (M4 orphan rule). */
	orphan: boolean;
	onJump: (id: string) => void;
	onReply: (id: string, body: string) => Promise<boolean>;
	onResolve: (id: string) => void;
	onDelete: (id: string) => void;
}) {
	const [replying, setReplying] = useState(false);
	const [text, setText] = useState("");
	const [sending, setSending] = useState(false);
	const replyBoxRef = useRef<HTMLTextAreaElement>(null);
	// Opening the form hands focus to it — focus management after the user's
	// own Reply click, done programmatically (no autoFocus attribute).
	useEffect(() => {
		if (replying) replyBoxRef.current?.focus();
	}, [replying]);

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

	const classes = [
		"comment-thread",
		thread.resolved ? "resolved" : "",
		orphan ? "orphan" : "",
	]
		.filter(Boolean)
		.join(" ");
	// data-c keys the staged hover rule and the rail-side jump target; orphans
	// have no span to jump to, so they render without it.
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
			<div className="comment-body">{thread.replies[0]?.body}</div>
			{thread.replies.slice(1).map((reply) => (
				<div className="comment-reply" key={reply.at}>
					<div className="comment-header">
						<span className="author">{reply.author}</span>
						<span className="time">{timeAgo(reply.at)}</span>
					</div>
					<div className="comment-body">{reply.body}</div>
				</div>
			))}
			{orphan && (
				<p className="orphan-note">
					Orphaned &mdash; original text no longer in document
				</p>
			)}
			<div className="comment-actions">
				{!thread.resolved && !orphan && (
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
					<textarea
						rows={3}
						required
						aria-label={`Reply to ${thread.author}`}
						placeholder="Reply…"
						value={text}
						ref={replyBoxRef}
						onChange={(e) => setText(e.target.value)}
					/>
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
	onDelete,
	error,
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
	onDelete: (id: string) => void;
	error: string | null;
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
				{threads
					.filter((t) => showResolved || !t.resolved)
					.map((t) => (
						<ThreadCard
							key={t.id}
							thread={t}
							orphan={!liveIds.has(t.id)}
							onJump={jumpToDoc}
							onReply={onReply}
							onResolve={onResolve}
							onDelete={onDelete}
						/>
					))}
			</div>
		</aside>
	);
}
