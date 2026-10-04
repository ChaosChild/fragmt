import {
	Check,
	Eye,
	MessagesSquare,
	PencilLine,
	TriangleAlert,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
	abortMerge,
	type ConflictPart,
	concludeMerge,
	getMergeState,
	type MergeSide,
	type MergeState,
	resolveMergeFile,
} from "./api";
import { CommandBar } from "./CommandBar";
import { askConfirm } from "./ConfirmDialog";
import { diffWords } from "./prose-diff";
import { assembleContent, hunkPlace, sidecarSummaryLine } from "./resolve";
import { shortDate } from "./Sidebar";

/** How one conflict was settled: a side verbatim, or the user's own text. */
type Pick =
	| { kind: "ours" }
	| { kind: "theirs" }
	| { kind: "own"; text: string };

type Hunk = { ours: string; theirs: string };
const hunksOf = (parts: ConflictPart[]) =>
	parts.filter((p): p is Hunk => "ours" in p);

const PICK_LINE = {
	ours: "Kept main's version",
	theirs: "Kept the draft's version",
	own: "Wrote my own",
} as const;

/**
 * Resolution mode (M4-4 b3, ui v1 phase 11): the stage while a stood merge
 * is resolved. Every conflict is a sheet with both versions side by side
 * (the words that differ marked – plain text only), Keep main / Keep draft
 * / Write my own; a settled conflict folds to one line with Change.
 * Conclude stages each doc's assembled text and lets the comment sidecars
 * merge on their own (the union), then concludes – the server's merge
 * routes are unchanged. Abort confirms, then undoes. Both hand back to App
 * for the full refresh.
 */
export function ResolutionView({ onDone }: { onDone: () => void }) {
	const [state, setState] = useState<MergeState | null>(null);
	// path → one pick per hunk (null = still open)
	const [picks, setPicks] = useState<Record<string, (Pick | null)[]>>({});
	// "path#i" of the conflict whose own-text editor is open
	const [editing, setEditing] = useState<string | null>(null);
	const [draft, setDraft] = useState("");
	const [preview, setPreview] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const concluding = useRef(false);

	// biome-ignore lint/correctness/useExhaustiveDependencies: mount-only – the resolution is local until Conclude.
	useEffect(() => {
		getMergeState()
			.then((s) => {
				// A merge concluded elsewhere (terminal) reads as done – exit.
				if (!s.inMerge) {
					onDone();
					return;
				}
				setState(s);
				const init: Record<string, (Pick | null)[]> = {};
				for (const f of s.files)
					if (f.kind === "doc") init[f.path] = hunksOf(f.parts).map(() => null);
				setPicks(init);
			})
			.catch((e: unknown) =>
				setError(e instanceof Error ? e.message : String(e)),
			);
	}, []);

	async function run(fn: () => Promise<void>) {
		setBusy(true);
		setError(null);
		try {
			await fn();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	}

	if (!state?.inMerge) {
		return (
			<div className="docview">
				<CommandBar start={<b>Resolving merge</b>} />
				<p className="rz-note">
					{error ??
						(state ? "The merge is no longer standing." : "Loading merge…")}
				</p>
			</div>
		);
	}

	const docs = state.files.filter(
		(f): f is Extract<typeof f, { kind: "doc" }> => f.kind === "doc",
	);
	const sidecars = state.files.filter(
		(f): f is Extract<typeof f, { kind: "sidecar" }> => f.kind === "sidecar",
	);
	const others = state.files.filter((f) => f.kind === "other");
	const total = docs.reduce((n, f) => n + hunksOf(f.parts).length, 0);
	const resolved = Object.values(picks).reduce(
		(n, ps) => n + ps.filter(Boolean).length,
		0,
	);
	const theirsRef = state.branch ?? "the draft";
	const oursRef = docs[0]?.sides?.ours.ref ?? "main";
	const ready = resolved === total && others.length === 0;

	const textOf = (h: Hunk, p: Pick | null) =>
		p === null ? h.ours : p.kind === "own" ? p.text : h[p.kind];
	const assembled = (f: (typeof docs)[number]) =>
		assembleContent(
			f.parts,
			hunksOf(f.parts).map((h, i) => textOf(h, picks[f.path]?.[i] ?? null)),
		);
	const setPick = (path: string, i: number, p: Pick | null) =>
		setPicks((all) => ({
			...all,
			[path]: (all[path] ?? []).map((x, j) => (j === i ? p : x)),
		}));

	// Idempotent: the live unmerged set decides what still needs staging, so
	// a retry after a partial failure (or a second click before `busy`
	// re-renders) never re-stages a staged file; the ref blocks re-entry.
	const conclude = () => {
		if (concluding.current) return;
		concluding.current = true;
		void run(async () => {
			const live = await getMergeState();
			const open = new Set(live.inMerge ? live.files.map((f) => f.path) : []);
			for (const f of docs)
				if (open.has(f.path))
					await resolveMergeFile(f.path, { content: assembled(f) });
			for (const f of sidecars)
				if (open.has(f.path))
					await resolveMergeFile(f.path, { choice: "merged" });
			await concludeMerge();
			onDone();
		}).finally(() => {
			concluding.current = false;
		});
	};

	const abort = async () => {
		if (
			!(await askConfirm({
				title: "Abort this merge?",
				body: "Nothing merges – you stay on the draft branch, and your picks here are dropped.",
				confirmLabel: "Abort merge",
				danger: true,
			}))
		)
			return;
		void run(async () => {
			await abortMerge();
			onDone();
		});
	};

	return (
		<div className="docview resolution">
			<CommandBar
				start={
					<div className="crumb-line">
						<b>Resolving merge</b>
						<span className="sep"> · </span>
						<span className="mono">
							{theirsRef} → {oursRef}
						</span>
					</div>
				}
			>
				<button
					type="button"
					className="btn line"
					disabled={busy}
					onClick={abort}
				>
					Abort merge
				</button>
			</CommandBar>
			<div className="desk">
				<div className="rz">
					<header className="rz-head">
						<div>
							<h1>
								{total === 0
									? "Every conflict is resolved"
									: `${total} ${total === 1 ? "place" : "places"} where both branches changed the same words`}
							</h1>
							<p>
								For each one, keep main's version, keep the draft's, or write
								your own. Nothing is committed until you conclude.
							</p>
						</div>
						<span className="sp" />
						<span className={`chip${ready ? " green" : " amber"}`}>
							{resolved} of {total} resolved
						</span>
					</header>
					<div className="rz-prog" aria-hidden="true">
						<i
							style={{ width: `${total ? (resolved / total) * 100 : 100}%` }}
						/>
					</div>
					{error && (
						<div className="conflict-banner" role="alert">
							<div>
								<strong>Resolution failed</strong>
								{error}
							</div>
							<button
								type="button"
								className="iconbtn subtle dismiss"
								onClick={() => setError(null)}
							>
								Dismiss
							</button>
						</div>
					)}
					{docs.map((f) => (
						<section key={f.path} className="rz-file" aria-label={f.path}>
							<div className="kicker">
								<span className="type">Doc</span>
								<span className="rule" />
								<span>{f.path}</span>
							</div>
							{hunksOf(f.parts).map((h, i) => {
								const p = picks[f.path]?.[i] ?? null;
								const place = hunkPlace(f.parts, i);
								const key = `${f.path}#${i}`;
								const words = diffWords(h.ours, h.theirs);
								return (
									<article
										// biome-ignore lint/suspicious/noArrayIndexKey: hunks have no id – their order is fixed for the merge's life
										key={i}
										className={`rz-hunk${p ? " done" : ""}`}
									>
										<header className="rz-hunk-h">
											<b>{place.heading ?? "Top of the document"}</b>
											<span className="mono">line {place.line}</span>
											<span className="sp" />
											{p ? (
												<>
													<span className="rz-picked">
														<Check aria-hidden="true" />
														{PICK_LINE[p.kind]}
													</span>
													<button
														type="button"
														className="btn"
														onClick={() => setPick(f.path, i, null)}
													>
														Change
													</button>
												</>
											) : (
												editing !== key && (
													<button
														type="button"
														className="btn"
														onClick={() => {
															setEditing(key);
															setDraft(h.theirs);
														}}
													>
														<PencilLine aria-hidden="true" />
														Write my own
													</button>
												)
											)}
										</header>
										{!p && editing === key && (
											<div className="rz-own">
												<textarea
													value={draft}
													onChange={(e) => setDraft(e.target.value)}
													rows={Math.min(
														12,
														Math.max(3, draft.split("\n").length),
													)}
													aria-label={`Your text for the conflict at line ${place.line}`}
												/>
												<div className="rz-own-act">
													<button
														type="button"
														className="btn"
														onClick={() => setEditing(null)}
													>
														Cancel
													</button>
													<button
														type="button"
														className="btn primary"
														onClick={() => {
															setPick(f.path, i, { kind: "own", text: draft });
															setEditing(null);
														}}
													>
														Use this text
													</button>
												</div>
											</div>
										)}
										{!p && editing !== key && (
											<div className="rz-sides">
												<Side
													side={f.sides?.ours}
													label={f.sides?.ours.ref ?? "main"}
													words={words.filter((w) => w.type !== "ins")}
													mark="del"
													action={
														<button
															type="button"
															className="btn line"
															onClick={() =>
																setPick(f.path, i, { kind: "ours" })
															}
														>
															Keep main
														</button>
													}
												/>
												<Side
													side={f.sides?.theirs}
													label={f.sides?.theirs.ref ?? "draft"}
													words={words.filter((w) => w.type !== "del")}
													mark="ins"
													action={
														<button
															type="button"
															className="btn primary"
															onClick={() =>
																setPick(f.path, i, { kind: "theirs" })
															}
														>
															Keep draft
														</button>
													}
												/>
											</div>
										)}
									</article>
								);
							})}
						</section>
					))}
					{others.map((f) => (
						<p key={f.path} className="notice">
							<TriangleAlert aria-hidden="true" />
							<span>
								<b>{f.path}</b> can't be resolved here – finish this merge in
								your terminal.
							</span>
						</p>
					))}
					{preview &&
						docs.map((f) => (
							<section key={`pv:${f.path}`} className="rz-preview">
								<p className="kicker">
									<span className="type">Result</span>
									<span className="rule" />
									<span>{f.path}</span>
								</p>
								<pre>{assembled(f)}</pre>
							</section>
						))}
					<footer className="rz-foot">
						{sidecars.length > 0 && (
							<span
								className="rz-sidecar"
								title={sidecars
									.map((s) => sidecarSummaryLine(s.summary))
									.join("\n")}
							>
								<MessagesSquare aria-hidden="true" />
								Comment threads merge on their own – no action needed.
							</span>
						)}
						<span className="sp" />
						<button
							type="button"
							className="btn"
							aria-pressed={preview}
							onClick={() => setPreview((v) => !v)}
						>
							<Eye aria-hidden="true" />
							{preview ? "Hide result" : "Preview result"}
						</button>
						<button
							type="button"
							className="btn line"
							disabled={busy}
							onClick={abort}
						>
							Abort merge
						</button>
						<button
							type="button"
							className="btn primary"
							disabled={busy || !ready}
							title={ready ? undefined : "Resolve every conflict first"}
							onClick={conclude}
						>
							Conclude merge
						</button>
					</footer>
				</div>
			</div>
		</div>
	);
}

/** One side of a conflict: its branch, who last touched the file there,
 *  and its text with the words that differ from the other side marked. */
function Side({
	side,
	label,
	words,
	mark,
	action,
}: {
	side?: MergeSide;
	label: string;
	words: { type: "same" | "ins" | "del"; text: string }[];
	mark: "ins" | "del";
	action: ReactNode;
}) {
	return (
		<div className="rz-side">
			<div className="lab">
				<span className="mono">{label}</span>
				<span className="sp" />
				{side?.author && (
					<span>
						{side.author}
						{side.date ? ` · ${shortDate(side.date)}` : ""}
					</span>
				)}
			</div>
			<p>
				{words.map((w, i) =>
					w.type === mark ? (
						// biome-ignore lint/suspicious/noArrayIndexKey: a fixed word diff
						<mark key={i}>{w.text}</mark>
					) : (
						// biome-ignore lint/suspicious/noArrayIndexKey: a fixed word diff
						<span key={i}>{w.text}</span>
					),
				)}
			</p>
			<div className="rz-act">{action}</div>
		</div>
	);
}
