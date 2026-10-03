import { GitBranch } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { OkfFinding } from "./api";

/** "pulled N min ago" – whole minutes, "just now" under one. */
function pulledAgo(at: number, now: number): string {
	const min = Math.floor((now - at) / 60_000);
	return min < 1 ? "pulled just now" : `pulled ${min} min ago`;
}

/**
 * The status bar (ui v1): the one fixed home of the sync indicator
 * (DESIGN.md §7) plus the branch, the open doc's word count and the OKF
 * conformance line. The findings list that used to be the sidebar banner
 * opens from here.
 */
export function StatusBar({
	led,
	ledLabel,
	lastSyncAt,
	branch,
	words,
	okfFindings,
}: {
	led: string;
	ledLabel: string;
	/** Epoch ms of the last clean sync; null until the first one. */
	lastSyncAt: number | null;
	branch: string | null;
	/** The open doc's words; null with no doc open. */
	words: number | null;
	/** null = not an OKF repo (the segment hides); [] = valid. */
	okfFindings: OkfFinding[] | null;
}) {
	// Re-render the relative time; 30s keeps "N min" at most half a minute
	// behind without a per-second timer.
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const id = setInterval(() => setNow(Date.now()), 30_000);
		return () => clearInterval(id);
	}, []);
	const [findingsOpen, setFindingsOpen] = useState(false);
	const panelRef = useRef<HTMLDivElement>(null);
	// The panel closes on an outside press or Escape, like the menus.
	useEffect(() => {
		if (!findingsOpen) return;
		const onDown = (e: PointerEvent) => {
			if (!panelRef.current?.contains(e.target as Node)) setFindingsOpen(false);
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				setFindingsOpen(false);
			}
		};
		document.addEventListener("pointerdown", onDown);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("pointerdown", onDown);
			document.removeEventListener("keydown", onKey);
		};
	}, [findingsOpen]);

	const findingDocs = new Set(okfFindings?.map((f) => f.path)).size;
	return (
		<footer className="status">
			<span className="s" role="status">
				<span className={`led ${led}`} aria-hidden="true" />
				{ledLabel}
				{lastSyncAt !== null &&
					` · ${pulledAgo(lastSyncAt, Math.max(now, lastSyncAt))}`}
			</span>
			{branch && (
				<span className="s">
					<GitBranch aria-hidden="true" />
					<span className="mono">{branch}</span>
				</span>
			)}
			<span className="sp" />
			{words !== null && (
				<span className="s">
					{words.toLocaleString("en-US")} {words === 1 ? "word" : "words"}
				</span>
			)}
			{okfFindings !== null &&
				(okfFindings.length === 0 ? (
					<span className="s">
						<span className="tr h" aria-hidden="true" />
						OKF v0.2 · valid
					</span>
				) : (
					<div className="okf-status" ref={panelRef}>
						<button
							type="button"
							className="s okf-status-btn"
							aria-expanded={findingsOpen}
							title={`${findingDocs} ${findingDocs === 1 ? "doc" : "docs"} non-conformant`}
							onClick={() => setFindingsOpen((o) => !o)}
						>
							<span className="tr s" aria-hidden="true" />
							OKF · {okfFindings.length}{" "}
							{okfFindings.length === 1 ? "finding" : "findings"}
						</button>
						{findingsOpen && (
							<div className="okf-panel">
								<p className="okf-panel-head">
									{findingDocs} {findingDocs === 1 ? "doc" : "docs"}{" "}
									non-conformant
								</p>
								<ul className="okf-findings">
									{okfFindings.map((f) => (
										// The full clause sentence rides the row as its title.
										<li key={`${f.path}:${f.clause}`} title={f.detail}>
											<span className="okf-path">{f.path}</span>
											<span className="okf-clause">{f.clause}</span>
										</li>
									))}
								</ul>
							</div>
						)}
					</div>
				))}
		</footer>
	);
}
