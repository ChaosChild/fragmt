// "./api.js" (not "./api"): this file is typechecked by BOTH configs – the
// root nodenext program reaches it via tests/comment-summary.test.ts.
import type { CommentThread } from "./api.js";

/** Dogfood round (#15, 2026-08-26): the PREVIEW's comment-span tooltip – the
 *  thread's first comment as one line, e.g. `andrei · open – "Pin this
 *  wording?"` – so a reader can decide whether to open the doc in the main
 *  pane before clicking anything. The main doc's spans keep the mark's
 *  "View comment"; the preview has no jump to promise.
 *
 *  Missing pieces drop out by design: the sidecar carries no per-thread
 *  version, a fetch that hasn't landed (or failed) leaves the thread absent,
 *  and an unwritten body leaves the quote-less meta line. */
const BODY_MAX = 80;

/** Collapse whitespace and clamp to BODY_MAX chars, "…" marking the cut. */
function truncateBody(raw: string): string {
	const body = raw.replace(/\s+/g, " ").trim();
	if (body.length <= BODY_MAX) return body;
	return `${body.slice(0, BODY_MAX).trimEnd()}…`;
}

/** The span-title line: `<author> · <open|resolved>[ – "<body>"]`. */
export function commentSpanTitle(thread: CommentThread): string {
	const meta = [thread.author, thread.resolved ? "resolved" : "open"]
		.filter(Boolean)
		.join(" · ");
	const body = truncateBody(thread.replies[0]?.body ?? "");
	return body ? `${meta} – "${body}"` : meta;
}
