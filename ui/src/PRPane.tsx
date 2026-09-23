import { ChevronLeft, SquareArrowOutUpRight } from "lucide-react";
import { useEffect, useState } from "react";
import type { PrView } from "./App";
import {
	getPR,
	getPRs,
	mergePR,
	type PrFile,
	type PrSummary,
	pushPR,
} from "./api";

/** The server's fixed per_page (#27 b2) – a full page is the pager's only
 *  "a next page might exist" signal (GitHub answers no total). */
const FILES_PER_PAGE = 20;
// ponytail: 500 rendered patch rows per file – an agent-generated dump can
// carry thousands; raise (or virtualize) if real reviews ever hit the ceiling.
const MAX_PATCH_ROWS = 500;

/**
 * The slideout's fourth mode (#27 b4, D4 + D6): the PR list, then the paged
 * review – state chips read verbatim (open/closed, draft, mergeable or
 * conflicted, nothing while GitHub still computes), one file card per
 * 20-file page with unified patch rows in the merge-conflict view's visual
 * language. Merge and Push commits attempt and surface the server's answer
 * (permissions are enforced server-side, never guessed here); a conflicted
 * merge swaps the button for the resolve-on-GitHub state – the one
 * defer-to-GitHub moment. Nothing here navigates the editor: no dirty-guard
 * slot, no selection changes, no Escape handler of its own.
 */
export function PRPane({
	prView,
	setPrView,
	onHead,
}: {
	prView: PrView;
	setPrView: (v: PrView | null) => void;
	/** Reports the slideout head's title line (App holds it): the list's
	 *  "Pull requests · N open", the detail's "PR #n · title". */
	onHead: (title: string) => void;
}) {
	// The line while a fetch is out – the subviews' reports land when data
	// does, so the head never shows the previous view's title past a switch.
	useEffect(() => {
		onHead(prView.kind === "pr" ? `PR #${prView.n}` : "Pull requests");
	}, [prView, onHead]);
	return prView.kind === "list" ? (
		<PrList onOpen={(n) => setPrView({ kind: "pr", n })} onHead={onHead} />
	) : (
		<PrDetail
			n={prView.n}
			onBack={() => setPrView({ kind: "list" })}
			onHead={onHead}
		/>
	);
}

/** The list: one row per open PR – `#number · title · head-ref`. */
function PrList({
	onOpen,
	onHead,
}: {
	onOpen: (n: number) => void;
	onHead: (title: string) => void;
}) {
	const [prs, setPrs] = useState<PrSummary[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: mount-only – onHead is App's stable state setter; the pane remounts per open, so there is no later refresh to catch.
	useEffect(() => {
		let cancelled = false;
		getPRs()
			.then((r) => {
				if (cancelled) return;
				const list = r.prs ?? [];
				setPrs(list);
				onHead(`Pull requests · ${list.length} open`);
			})
			.catch((e: unknown) => {
				if (!cancelled) setError(e instanceof Error ? e.message : String(e));
			});
		return () => {
			cancelled = true;
		};
	}, []);

	if (error) {
		return (
			<div className="pr-pane">
				<p className="pr-error" role="alert">
					{error}
				</p>
			</div>
		);
	}
	return (
		<div className="pr-pane">
			{prs === null ? (
				<p className="pr-note">Loading pull requests…</p>
			) : prs.length === 0 ? (
				<p className="pr-note">No open pull requests.</p>
			) : (
				<ul className="pr-list">
					{prs.map((p) => (
						<li key={p.number}>
							<button
								type="button"
								className="pr-row"
								title={p.title}
								onClick={() => onOpen(p.number)}
							>
								<span className="pr-num">#{p.number}</span> ·{" "}
								<span>{p.title}</span> ·{" "}
								<span className="pr-ref">{p.head.ref}</span>
							</button>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

/** The review: head area (back, title, chips, branch pair, actions), then
 *  one page of file cards and the pager. */
function PrDetail({
	n,
	onBack,
	onHead,
}: {
	n: number;
	onBack: () => void;
	onHead: (title: string) => void;
}) {
	const [pr, setPr] = useState<PrSummary | null>(null);
	const [files, setFiles] = useState<PrFile[]>([]);
	const [page, setPage] = useState(1);
	// D6: a merge answered {conflicted:true} – the Merge button swaps for
	// the resolve-on-GitHub state.
	const [conflicted, setConflicted] = useState(false);
	const [note, setNote] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	// The explicit re-fetch trigger: a merged/pushed action refreshes the
	// detail through the same effect.
	const [refresh, setRefresh] = useState(0);

	// biome-ignore lint/correctness/useExhaustiveDependencies: onHead is App's stable state setter; refresh is a deliberate trigger (merge/push success), not a value the effect reads.
	useEffect(() => {
		let cancelled = false;
		setError(null);
		getPR(n, page)
			.then((r) => {
				if (cancelled) return;
				setPr(r.pr);
				setFiles(r.files);
				onHead(`PR #${n} · ${r.pr.title}`);
			})
			.catch((e: unknown) => {
				if (!cancelled) setError(e instanceof Error ? e.message : String(e));
			});
		return () => {
			cancelled = true;
		};
	}, [n, page, refresh]);

	async function run(action: () => Promise<void>) {
		setBusy(true);
		setError(null);
		try {
			await action();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	}

	const merge = () =>
		run(async () => {
			const r = await mergePR(n);
			if ("merged" in r) setRefresh((x) => x + 1);
			else setConflicted(true);
		});

	const push = () => {
		if (!pr) return;
		run(async () => {
			const r = await pushPR(n, pr.head.ref);
			if (r.pushed) setRefresh((x) => x + 1);
			else setNote("already up to date");
		});
	};

	const showMerge =
		pr !== null &&
		pr.state === "open" &&
		!pr.draft &&
		pr.mergeable === true &&
		!conflicted;

	return (
		<div className="pr-pane">
			<div className="pr-top">
				<button type="button" className="pr-back" onClick={onBack}>
					<ChevronLeft aria-hidden="true" />
					All pull requests
				</button>
				{pr && (
					<a
						className="iconbtn subtle"
						href={pr.html_url}
						target="_blank"
						rel="noreferrer"
						title="Open on GitHub"
						aria-label="Open on GitHub"
					>
						<SquareArrowOutUpRight aria-hidden="true" />
					</a>
				)}
			</div>
			{error && (
				<p className="pr-error" role="alert">
					{error}
				</p>
			)}
			{!pr && !error && <p className="pr-note">Loading pull request…</p>}
			{pr && (
				<>
					<h2 className="pr-title" title={pr.title}>
						{pr.title}
					</h2>
					<p className="pr-status">
						<span className="okf-chip">{pr.state}</span>
						{pr.draft && <span className="okf-chip">draft</span>}
						{pr.mergeable === true && (
							<span className="okf-chip">mergeable</span>
						)}
						{pr.mergeable === false && (
							<span className="okf-chip warn">conflicted</span>
						)}
					</p>
					<p className="pr-meta">
						<span className="pr-ref">{pr.head.ref}</span> →{" "}
						<span className="pr-ref">{pr.base.ref}</span> · {pr.changed_files}{" "}
						{pr.changed_files === 1 ? "file" : "files"}
					</p>
					<div className="pr-actions">
						{showMerge && (
							<button
								type="button"
								className="iconbtn primary"
								disabled={busy}
								onClick={merge}
							>
								Merge
							</button>
						)}
						{pr.state === "open" && (
							<button
								type="button"
								className="iconbtn subtle"
								disabled={busy}
								onClick={push}
							>
								Push commits
							</button>
						)}
					</div>
					{conflicted && (
						<p className="pr-conflict">
							This pull request has conflicts that must be resolved on GitHub{" "}
							<a href={pr.html_url} target="_blank" rel="noreferrer">
								Resolve on GitHub ↗
							</a>
						</p>
					)}
					{note && <p className="pr-note">{note}</p>}
					{files.map((f) => (
						<PrFileBlock key={f.filename} file={f} />
					))}
					<PrPager page={page} count={files.length} onPage={setPage} />
				</>
			)}
		</div>
	);
}

/** One file card: mono filename (truncated, full in the title attr), the
 *  colored +/− counts, then the patch rows – or the quiet no-patch note
 *  (binary or too large for GitHub to send). */
function PrFileBlock({ file }: { file: PrFile }) {
	return (
		<section className="pr-file">
			<header className="pr-file-head">
				<span className="pr-file-name" title={file.filename}>
					{file.filename}
				</span>
				<span className="pr-file-stats">
					<span className="pr-add">+{file.additions}</span>{" "}
					<span className="pr-del">−{file.deletions}</span>
				</span>
			</header>
			{file.patch ? (
				<PatchRows patch={file.patch} />
			) : (
				<p className="pr-note">no patch</p>
			)}
		</section>
	);
}

/** The unified patch as one row per line: @@ hunk heads, +/- changes, the
 *  rest context – capped at MAX_PATCH_ROWS so one huge file cannot flood
 *  the DOM. */
function PatchRows({ patch }: { patch: string }) {
	const lines = patch.split("\n");
	const shown = lines.slice(0, MAX_PATCH_ROWS);
	return (
		<div className="pr-patch">
			{shown.map((line, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: patch lines carry no id – the index is the identity and the slice never reorders.
				<div key={i} className={rowClass(line)}>
					{line === "" ? " " : line}
				</div>
			))}
			{lines.length > shown.length && (
				<div className="pr-patch-more">
					… {lines.length - shown.length} more rows
				</div>
			)}
		</div>
	);
}

function rowClass(line: string): string {
	if (line.startsWith("@@")) return "pr-patch-row hunk";
	if (line.startsWith("+")) return "pr-patch-row add";
	if (line.startsWith("-")) return "pr-patch-row del";
	return "pr-patch-row ctx";
}

/** ‹ files X–Y · page N › – Z is unknown (no total from the API), so next
 *  stays enabled only while the last page was full, and a full page's
 *  "/≥N+1" hedges that a next page MIGHT exist. Each page is fetched on
 *  demand; nothing is prefetched. */
function PrPager({
	page,
	count,
	onPage,
}: {
	page: number;
	count: number;
	onPage: (page: number) => void;
}) {
	const full = count === FILES_PER_PAGE;
	const from = (page - 1) * FILES_PER_PAGE + 1;
	const to = from + count - 1;
	return (
		<div className="pr-pager">
			<button
				type="button"
				className="iconbtn subtle"
				disabled={page === 1}
				aria-label="Previous page"
				onClick={() => onPage(page - 1)}
			>
				‹
			</button>
			<span className="label-meta">
				{count === 0 ? "no files" : `files ${from}–${to}`} · page {page}
				{full ? `/≥${page + 1}` : ""}
			</span>
			<button
				type="button"
				className="iconbtn subtle"
				disabled={!full}
				aria-label="Next page"
				onClick={() => onPage(page + 1)}
			>
				›
			</button>
		</div>
	);
}
