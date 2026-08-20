import { useEffect, useState } from "react";
import {
	abortMerge,
	type ConflictPart,
	concludeMerge,
	getMergeState,
	type MergeState,
	resolveMergeFile,
	type SidecarMergeSummary,
} from "./api";
import { assembleContent, sidecarSummaryLine } from "./resolve";

/**
 * Resolution mode (M4-4 b3): the main-pane takeover while a stood merge is
 * resolved. Owns the merge-state fetch and re-fetches after every stage —
 * staged files drop out of the live unmerged set, so `remaining` stays the
 * server's word. Doc files resolve hunk-by-hunk (ours/theirs pick + an edit
 * textarea prefilled with the chosen side, assembled preview, Stage);
 * sidecars take one structural choice off the b2 summary. Finish concludes
 * (the merge commit), Abort confirms then undoes — both hand back to App
 * for the full refresh. Writes elsewhere are the server guard's problem.
 */
export function ResolutionView({ onDone }: { onDone: () => void }) {
	const [state, setState] = useState<MergeState | null>(null);
	// Paths staged in this session — they leave the unmerged set, but the
	// card list keeps them as done rows so the merge visibly shrinks.
	const [staged, setStaged] = useState<string[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const refresh = () => {
		getMergeState()
			.then((s) => {
				// A merge concluded elsewhere (terminal) reads as done — exit.
				if (!s.inMerge) {
					onDone();
					return;
				}
				setState(s);
			})
			.catch((e: unknown) =>
				setError(e instanceof Error ? e.message : String(e)),
			);
	};
	// biome-ignore lint/correctness/useExhaustiveDependencies: mount-only — every later refresh is explicit (after a stage/conclude/abort)
	useEffect(() => {
		refresh();
	}, []);

	async function run(busyFn: () => Promise<void>) {
		setBusy(true);
		setError(null);
		try {
			await busyFn();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	}

	const stageDoc = (path: string, content: string) =>
		run(async () => {
			await resolveMergeFile(path, { content });
			setStaged((s) => [...s, path]);
			refresh();
		});

	const stageSidecar = (path: string, choice: "merged" | "ours" | "theirs") =>
		run(async () => {
			await resolveMergeFile(path, { choice });
			setStaged((s) => [...s, path]);
			refresh();
		});

	const finish = () =>
		run(async () => {
			await concludeMerge();
			onDone();
		});

	const abort = () => {
		if (
			!window.confirm(
				"Abort this merge? Nothing merges — you stay on the draft branch.",
			)
		)
			return;
		void run(async () => {
			await abortMerge();
			onDone();
		});
	};

	if (!state?.inMerge) {
		return (
			<div className="resolve-pane">
				<p className="label-meta">
					{state ? "The merge is no longer standing." : "Loading merge…"}
				</p>
			</div>
		);
	}
	const files = state.files;
	const total = files.length + staged.length;

	return (
		<div className="resolve-pane">
			<header className="resolve-head">
				<div>
					<h1 className="resolve-title">
						Resolving merge of <span>{state.branch ?? "unknown branch"}</span>
					</h1>
					<p className="label-meta">
						{files.length} of {total} {total === 1 ? "file" : "files"} left
					</p>
				</div>
				<div className="doc-actions">
					<button
						type="button"
						className="iconbtn subtle"
						disabled={busy}
						onClick={abort}
					>
						Abort
					</button>
					<button
						type="button"
						className="iconbtn primary"
						disabled={busy || files.length > 0}
						title={
							files.length > 0
								? "stage every conflicting file first"
								: undefined
						}
						onClick={() => void finish()}
					>
						Finish
					</button>
				</div>
			</header>
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
			{staged.map((path) => (
				<section key={path} className="resolve-file done">
					<header className="resolve-file-head">
						<span className="resolve-path">{path}</span>
						<span className="resolve-staged">staged</span>
					</header>
				</section>
			))}
			{files.map((f) =>
				f.kind === "doc" ? (
					<DocCard key={f.path} file={f} disabled={busy} onStage={stageDoc} />
				) : f.kind === "sidecar" ? (
					<SidecarCard
						key={f.path}
						file={f}
						disabled={busy}
						onChoice={stageSidecar}
					/>
				) : (
					<OtherCard key={f.path} file={f} />
				),
			)}
		</div>
	);
}

/** One hunk's working state: the picked side, an edited text (null = the
 *  side verbatim; "" = deliberately emptied), and the edit box's openness. */
interface HunkState {
	side: "ours" | "theirs";
	edit: string | null;
	open: boolean;
}

/** A conflicted doc: a hunk card per ours/theirs part (pick a side, or edit
 *  the chosen side's text in a textarea), the live assembled preview, and
 *  Stage — which PUTs exactly the previewed text. Ours is main (HEAD),
 *  theirs is the draft being merged in. */
function DocCard({
	file,
	disabled,
	onStage,
}: {
	file: { path: string; kind: "doc"; parts: ConflictPart[] };
	disabled: boolean;
	onStage: (path: string, content: string) => void;
}) {
	const hunks = file.parts.filter(
		(p): p is { ours: string; theirs: string } => "ours" in p,
	);
	const [slots, setSlots] = useState<HunkState[]>(() =>
		hunks.map(() => ({ side: "ours", edit: null, open: false })),
	);
	const sideText = (i: number, side: "ours" | "theirs") =>
		side === "ours" ? hunks[i].ours : hunks[i].theirs;
	const shown = (i: number) => slots[i].edit ?? sideText(i, slots[i].side);
	const assembled = assembleContent(
		file.parts,
		slots.map((_, i) => shown(i)),
	);

	const pick = (i: number, side: "ours" | "theirs") =>
		setSlots((ss) =>
			ss.map((s, j) => (j === i ? { side, edit: null, open: false } : s)),
		);
	const toggleEdit = (i: number) =>
		setSlots((ss) =>
			ss.map((s, j) =>
				j === i
					? s.open
						? { ...s, open: false }
						: { ...s, open: true, edit: shown(i) }
					: s,
			),
		);
	const setEdit = (i: number, text: string) =>
		setSlots((ss) => ss.map((s, j) => (j === i ? { ...s, edit: text } : s)));

	return (
		<section className="resolve-file">
			<header className="resolve-file-head">
				<span className="resolve-path">{file.path}</span>
				<button
					type="button"
					className="iconbtn primary"
					disabled={disabled}
					onClick={() => onStage(file.path, assembled)}
				>
					Stage
				</button>
			</header>
			{hunks.length === 0 && (
				<p className="label-meta">
					no conflicting hunks — stage writes the file as-is
				</p>
			)}
			{hunks.map((_, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: a hunk has no id — the index IS its identity, and the slots below stay index-aligned for the card's lifetime (hunks never reorder)
				<div key={i} className="hunk">
					<div className="hunk-actions">
						<button
							type="button"
							className={`hunk-side${slots[i].side === "ours" ? " picked" : ""}`}
							disabled={disabled}
							onClick={() => pick(i, "ours")}
						>
							ours (main)
						</button>
						<button
							type="button"
							className={`hunk-side${slots[i].side === "theirs" ? " picked" : ""}`}
							disabled={disabled}
							onClick={() => pick(i, "theirs")}
						>
							theirs (draft)
						</button>
						<button
							type="button"
							className="iconbtn subtle"
							disabled={disabled}
							onClick={() => toggleEdit(i)}
						>
							{slots[i].open ? "Done editing" : "Edit"}
						</button>
					</div>
					{slots[i].open ? (
						<textarea
							className="hunk-textarea"
							value={shown(i)}
							onChange={(e) => setEdit(i, e.target.value)}
							rows={Math.min(12, Math.max(3, shown(i).split("\n").length))}
							aria-label={`Edited text for conflict ${i + 1}`}
						/>
					) : (
						<pre className="hunk-text">
							<code>{shown(i)}</code>
						</pre>
					)}
				</div>
			))}
			<div className="resolve-preview">
				<p className="label-meta">assembled preview</p>
				<pre>
					<code>{assembled}</code>
				</pre>
			</div>
		</section>
	);
}

/** A conflicted sidecar: the b2 summary line + three one-click structural
 *  choices — no per-reply editor (the merged union is the whole point). */
function SidecarCard({
	file,
	disabled,
	onChoice,
}: {
	file: { path: string; kind: "sidecar"; summary: SidecarMergeSummary };
	disabled: boolean;
	onChoice: (path: string, choice: "merged" | "ours" | "theirs") => void;
}) {
	const s = file.summary;
	return (
		<section className="resolve-file">
			<header className="resolve-file-head">
				<span className="resolve-path">{file.path}</span>
				<span className="label-meta">comments</span>
			</header>
			<p className="resolve-summary">{sidecarSummaryLine(s)}</p>
			<div className="hunk-actions">
				<button
					type="button"
					className="hunk-side picked"
					disabled={disabled}
					onClick={() => onChoice(file.path, "merged")}
				>
					take merged
				</button>
				<button
					type="button"
					className="hunk-side"
					disabled={disabled}
					onClick={() => onChoice(file.path, "ours")}
				>
					take ours
				</button>
				<button
					type="button"
					className="hunk-side"
					disabled={disabled}
					onClick={() => onChoice(file.path, "theirs")}
				>
					take theirs
				</button>
			</div>
		</section>
	);
}

/** The kind a stood merge can't carry (unreachable through mergeToMain — the
 *  classification refuses to stand on "other" files); said plainly if it
 *  ever shows up anyway. */
function OtherCard({ file }: { file: { path: string; kind: "other" } }) {
	return (
		<section className="resolve-file">
			<header className="resolve-file-head">
				<span className="resolve-path">{file.path}</span>
			</header>
			<p className="label-meta">
				this file can't be resolved in the UI — finish the merge in your
				terminal
			</p>
		</section>
	);
}
