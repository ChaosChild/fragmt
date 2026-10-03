import {
	ArrowLeft,
	Check,
	ChevronDown,
	ChevronRight,
	FileText,
	GitMerge,
	GitPullRequest,
	SquareArrowOutUpRight,
	TriangleAlert,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import {
	getPR,
	getPrDoc,
	mergePR,
	type PrCommit,
	type PrDocSide,
	type PrFile,
	type PrSummary,
	pushPR,
} from "./api";
import { CommandBar } from "./CommandBar";
import { ageOf } from "./PRList";
import {
	type BlockDiff,
	diffBlocks,
	diffFrontmatter,
	diffWords,
} from "./prose-diff";

/** The server's fixed per_page (#27 b2) – a full page is the pager's only
 *  "a next page might exist" signal (GitHub answers no total). */
const FILES_PER_PAGE = 20;
// ponytail: 500 rendered patch rows per file – an agent-generated dump can
// carry thousands; raise (or virtualize) if real reviews ever hit the ceiling.
const MAX_PATCH_ROWS = 500;
/** Unchanged stretches longer than this fold to one "N unchanged" row. */
const FOLD_SAME = 3;

const isMd = (f: PrFile) => /\.md$/i.test(f.filename);

/**
 * The PR review (#27 b4, ui v1 phase 9): it takes over the stage like the
 * graph. Command bar – back to the list, #n, Open on GitHub, Merge into
 * main (same gating and conflict link-out as before). Left: the files of
 * this page, the status checks, the commits. Main: a sheet with the PR head
 * and the selected file as a Rendered diff (frontmatter by key, blocks,
 * words – plain text only) or the Source patch rows. Merge and Push
 * commits attempt and surface the server's answer (permissions are
 * enforced server-side, never guessed); a landed merge reports onMerged.
 */
export function PRReview({
	n,
	onBack,
	onMerged,
}: {
	n: number;
	onBack: () => void;
	/** Fired once a merge lands (owner round): App switches to main, guarded. */
	onMerged?: () => void;
}) {
	const [pr, setPr] = useState<PrSummary | null>(null);
	const [files, setFiles] = useState<PrFile[]>([]);
	const [commits, setCommits] = useState<PrCommit[]>([]);
	const [localUpToDate, setLocalUpToDate] = useState<boolean | null>(null);
	const [page, setPage] = useState(1);
	const [selected, setSelected] = useState<string | null>(null);
	const [tab, setTab] = useState<"rendered" | "source">("rendered");
	// D6: a merge answered {conflicted:true} – the Merge button swaps for
	// the resolve-on-GitHub state.
	const [conflicted, setConflicted] = useState(false);
	const [note, setNote] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	// The explicit re-fetch trigger: a merged/pushed action refreshes the
	// detail through the same effect.
	const [refresh, setRefresh] = useState(0);

	// biome-ignore lint/correctness/useExhaustiveDependencies: refresh is a deliberate trigger (merge/push success), not a value the effect reads.
	useEffect(() => {
		let cancelled = false;
		setError(null);
		getPR(n, page)
			.then((r) => {
				if (cancelled) return;
				setPr(r.pr);
				setFiles(r.files);
				setCommits(r.commits ?? []);
				setLocalUpToDate(r.localUpToDate ?? null);
				// Keep the selection when it is on this page; else the first doc.
				setSelected((s) =>
					s && r.files.some((f) => f.filename === s)
						? s
						: ((r.files.find(isMd) ?? r.files[0])?.filename ?? null),
				);
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
			if ("merged" in r) {
				setRefresh((x) => x + 1);
				onMerged?.();
			} else setConflicted(true);
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
	const state = pr?.merged_at
		? "Merged"
		: pr?.state === "closed"
			? "Closed"
			: pr?.draft
				? "Draft"
				: "Open";
	const file = files.find((f) => f.filename === selected) ?? null;
	// Rendered needs a doc; anything else reads in Source.
	const effectiveTab = file && isMd(file) ? tab : "source";

	return (
		<div className="pr-review docview">
			<CommandBar
				start={
					<div className="crumb-line">
						<button type="button" className="btn" onClick={onBack}>
							<ArrowLeft aria-hidden="true" />
							Pull requests
						</button>
						<span className="sep">/</span>
						<b className="mono">#{n}</b>
					</div>
				}
			>
				{pr && (
					<a
						className="btn"
						href={pr.html_url}
						target="_blank"
						rel="noreferrer"
						title="Open on GitHub"
					>
						<SquareArrowOutUpRight aria-hidden="true" />
						Open on GitHub
					</a>
				)}
				{pr?.state === "open" && (
					<button
						type="button"
						className="btn line"
						disabled={busy}
						onClick={push}
					>
						Push commits
					</button>
				)}
				{showMerge && (
					<button
						type="button"
						className="btn primary"
						disabled={busy}
						onClick={merge}
					>
						<GitMerge aria-hidden="true" />
						Merge into main
					</button>
				)}
			</CommandBar>
			<div className="desk">
				{error && (
					<p className="pr-error review-error" role="alert">
						{error}
					</p>
				)}
				{!pr && !error && (
					<p className="pr-note review-note">Loading pull request…</p>
				)}
				{pr && (
					<div className="review">
						<aside className="rv-side" aria-label="Pull request details">
							<div>
								<h4>Files · {files.length}</h4>
								{files.map((f) => (
									<button
										key={f.filename}
										type="button"
										className="file"
										aria-pressed={f.filename === selected}
										title={f.filename}
										onClick={() => setSelected(f.filename)}
									>
										<FileText aria-hidden="true" />
										<span className="fn">{f.filename}</span>
										<span className="sp" />
										<span className="ins">+{f.additions}</span>{" "}
										<span className="del">−{f.deletions}</span>
									</button>
								))}
							</div>
							<div>
								<h4>Status</h4>
								{conflicted || pr.mergeable === false ? (
									<p className="check warn">
										<TriangleAlert aria-hidden="true" />
										<span>
											This pull request has conflicts that must be resolved on
											GitHub{" "}
											<a href={pr.html_url} target="_blank" rel="noreferrer">
												Resolve on GitHub ↗
											</a>
										</span>
									</p>
								) : pr.mergeable === true ? (
									<p className="check">
										<Check aria-hidden="true" />
										No conflicts with main
									</p>
								) : (
									pr.state === "open" && (
										<p className="check muted">
											GitHub is checking mergeability…
										</p>
									)
								)}
								{localUpToDate === true && (
									<p className="check">
										<Check aria-hidden="true" />
										Branch is up to date with GitHub
									</p>
								)}
								{localUpToDate === false && (
									<p className="check warn">
										<TriangleAlert aria-hidden="true" />
										Local branch is behind GitHub
									</p>
								)}
								{note && <p className="pr-note">{note}</p>}
							</div>
							{commits.length > 0 && (
								<div>
									<h4>Commits · {commits.length}</h4>
									{commits.map((c) => (
										<p key={c.sha} className="commit" title={c.author}>
											{c.message}{" "}
											<span className="mono">· {c.sha.slice(0, 7)}</span>
										</p>
									))}
								</div>
							)}
						</aside>
						<article className="sheet rv-sheet">
							<div className="rv-head">
								<span className="num">#{pr.number}</span>
								<div>
									<h1 className="pr-title" title={pr.title}>
										{pr.title}
									</h1>
									<div className="sub">
										<span
											className={`chip ${state === "Open" ? "green" : state === "Merged" ? "accent" : ""}`}
										>
											<GitPullRequest aria-hidden="true" />
											{state}
										</span>
										<span className="flow">
											{pr.head.ref} <i>→</i> {pr.base.ref}
										</span>
										<span>
											· {pr.user.login} opened {ageOf(pr.created_at)} ·{" "}
											{pr.changed_files}{" "}
											{pr.changed_files === 1 ? "file" : "files"}
										</span>
									</div>
								</div>
							</div>
							<div className="rv-bar">
								{file && (
									<div className="kicker">
										<span className="type">{file.status}</span>
										<span className="rule" />
										<span>{file.filename}</span>
									</div>
								)}
								<div className="sp" />
								<fieldset className="seg" aria-label="Diff view">
									<button
										type="button"
										aria-pressed={effectiveTab === "rendered"}
										disabled={!file || !isMd(file)}
										onClick={() => setTab("rendered")}
									>
										Rendered
									</button>
									<button
										type="button"
										aria-pressed={effectiveTab === "source"}
										onClick={() => setTab("source")}
									>
										Source
									</button>
								</fieldset>
							</div>
							{effectiveTab === "rendered" && file ? (
								<RenderedDiff
									key={`${file.filename}@${refresh}`}
									n={n}
									file={file}
									onTooLarge={() => setTab("source")}
								/>
							) : (
								<>
									{files.map((f) => (
										<PrFileBlock key={f.filename} file={f} />
									))}
									<PrPager page={page} count={files.length} onPage={setPage} />
								</>
							)}
						</article>
					</div>
				)}
			</div>
		</div>
	);
}

/** A frontmatter value as one line of text – never interpreted. */
function fmText(v: unknown): string {
	if (v === undefined) return "";
	if (typeof v === "string") return v;
	return JSON.stringify(v);
}

/** Plain text with backtick spans as <code> – nothing else is interpreted
 *  (the accepted limit: bold and links read as their source here). */
function InlineCode({ text }: { text: string }) {
	const parts = text.split(/(`[^`\n]+`)/);
	return (
		<>
			{parts.map((p, i) =>
				p.startsWith("`") && p.endsWith("`") && p.length > 2 ? (
					// biome-ignore lint/suspicious/noArrayIndexKey: a fixed split of one string
					<code key={i}>{p.slice(1, -1)}</code>
				) : (
					p
				),
			)}
		</>
	);
}

/** One block's text in the rendered view: fences and tables keep their
 *  layout (pre); a heading reads as a heading (its #s dropped); lists and
 *  quotes keep their line breaks; the rest reads as a paragraph. Plain
 *  text throughout – nothing but backtick code is interpreted. */
function BlockText({ block, text }: { block: BlockDiff; text: string }) {
	if (block.kind === "fence" || block.kind === "table")
		return <pre>{text}</pre>;
	if (block.kind === "heading")
		return (
			<p className="rd-h">
				<InlineCode text={text.replace(/^\s*#{1,6}\s+/, "")} />
			</p>
		);
	// Lists and quotes keep one line per item; a hard-wrapped continuation
	// line joins its item.
	const lined = block.kind === "list" || block.kind === "quote";
	return (
		<p className={lined ? "keep-lines" : undefined}>
			<InlineCode
				text={lined ? text.replace(/\n(?!\s*([-*+>]|\d+[.)])\s)/g, " ") : text}
			/>
		</p>
	);
}

/** A run of folded blocks: "N … – Show". */
function Fold({
	label,
	icon,
	children,
}: {
	label: ReactNode;
	icon?: ReactNode;
	children: ReactNode;
}) {
	const [open, setOpen] = useState(false);
	return (
		<>
			<div className="reflow">
				{icon}
				<span>{label}</span>
				<button
					type="button"
					aria-expanded={open}
					onClick={() => setOpen((v) => !v)}
				>
					{open ? "Hide" : "Show"}
				</button>
			</div>
			{open && children}
		</>
	);
}

/** The Rendered tab for one doc: changed frontmatter keys, then the body
 *  as aligned blocks with word-level changes – React text nodes only. */
function RenderedDiff({
	n,
	file,
	onTooLarge,
}: {
	n: number;
	file: PrFile;
	onTooLarge: () => void;
}) {
	const [sides, setSides] = useState<{
		base: PrDocSide | null;
		head: PrDocSide | null;
	} | null>(null);
	const [error, setError] = useState<string | null>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: onTooLarge is the parent's tab setter – the fetch keys on the file alone.
	useEffect(() => {
		let cancelled = false;
		getPrDoc(n, file.filename)
			.then((r) => {
				if (cancelled) return;
				if ("tooLarge" in r) onTooLarge();
				else setSides(r);
			})
			.catch((e: unknown) => {
				if (!cancelled) setError(e instanceof Error ? e.message : String(e));
			});
		return () => {
			cancelled = true;
		};
	}, [n, file.filename]);

	if (error)
		return (
			<p className="pr-error" role="alert">
				{error}
			</p>
		);
	if (!sides) return <p className="pr-note">Loading the rendered diff…</p>;

	const fm = diffFrontmatter(
		sides.base?.frontmatter ?? null,
		sides.head?.frontmatter ?? null,
	).filter((c) => c.kind !== "same");
	const blocks = diffBlocks(sides.base?.body ?? "", sides.head?.body ?? "");

	// Group runs: reflows always fold; unchanged runs fold past FOLD_SAME.
	const out: ReactNode[] = [];
	for (let i = 0; i < blocks.length; ) {
		const b = blocks[i];
		let j = i;
		while (j < blocks.length && blocks[j].type === b.type) j++;
		const run = blocks.slice(i, j);
		const key = `${b.type}:${i}`;
		if (b.type === "reflow") {
			out.push(
				<Fold
					key={key}
					icon={<Check aria-hidden="true" />}
					label={
						<>
							<b>
								{run.length} {run.length === 1 ? "paragraph" : "paragraphs"}{" "}
								reflowed
							</b>{" "}
							– line breaks only, no words changed.
						</>
					}
				>
					{run.map((r, k) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: position within a fixed run
						<BlockText key={k} block={r} text={r.b ?? ""} />
					))}
				</Fold>,
			);
		} else if (b.type === "same" && run.length > FOLD_SAME) {
			out.push(
				<Fold
					key={key}
					label={`${run.length} unchanged ${run.length === 1 ? "paragraph" : "paragraphs"}`}
				>
					{run.map((r, k) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: position within a fixed run
						<BlockText key={k} block={r} text={r.b ?? ""} />
					))}
				</Fold>,
			);
		} else {
			run.forEach((r, k) => {
				const rk = `${key}:${k}`;
				if (r.type === "same")
					out.push(
						<div key={rk} className="blk same">
							<BlockText block={r} text={r.b ?? ""} />
						</div>,
					);
				else if (r.type === "changed")
					out.push(
						<p
							key={rk}
							className={`chg${r.kind === "list" || r.kind === "quote" ? " keep-lines" : ""}${r.kind === "heading" ? " rd-h" : ""}`}
						>
							{diffWords(r.a ?? "", r.b ?? "").map((w, wi) =>
								w.type === "same" ? (
									// biome-ignore lint/suspicious/noArrayIndexKey: a fixed word diff
									<span key={wi}>{w.text}</span>
								) : w.type === "ins" ? (
									// biome-ignore lint/suspicious/noArrayIndexKey: a fixed word diff
									<ins key={wi}>{w.text}</ins>
								) : (
									// biome-ignore lint/suspicious/noArrayIndexKey: a fixed word diff
									<del key={wi}>{w.text}</del>
								),
							)}
						</p>,
					);
				else
					out.push(
						<div key={rk} className={`blk ${r.type}`}>
							<BlockText
								block={r}
								text={(r.type === "added" ? r.b : r.a) ?? ""}
							/>
						</div>,
					);
			});
		}
		i = j;
	}

	return (
		<div className="rendered">
			{fm.length > 0 && (
				<div className="fm">
					{fm.map((c) => (
						<div key={c.key} className="fm-row">
							<div className="k">{c.key}</div>
							<div>
								{c.kind !== "added" && <s>{fmText(c.before)}</s>}
								{c.kind !== "removed" && <u>{fmText(c.after)}</u>}
							</div>
						</div>
					))}
				</div>
			)}
			<div className="rd">
				{out.length > 0 ? out : <p className="pr-note">No body changes.</p>}
			</div>
		</div>
	);
}

/** One file card: mono filename (truncated, full in the title attr), the
 *  colored +/− counts, then the patch rows – or the quiet no-patch note
 *  (binary or too large for GitHub to send). The head toggles the body
 *  (GitHub-style) so a long review can be scanned collapsed. */
function PrFileBlock({ file }: { file: PrFile }) {
	const [open, setOpen] = useState(true);
	return (
		<section className={`pr-file${open ? "" : " collapsed"}`}>
			<button
				type="button"
				className="pr-file-head"
				aria-expanded={open}
				onClick={() => setOpen((v) => !v)}
			>
				{open ? (
					<ChevronDown aria-hidden="true" />
				) : (
					<ChevronRight aria-hidden="true" />
				)}
				<span className="pr-file-name" title={file.filename}>
					{file.filename}
				</span>
				<span className="pr-file-stats">
					<span className="pr-add">+{file.additions}</span>{" "}
					<span className="pr-del">−{file.deletions}</span>
				</span>
			</button>
			{open &&
				(file.patch ? (
					<PatchRows patch={file.patch} />
				) : (
					<p className="pr-note">no patch</p>
				))}
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
