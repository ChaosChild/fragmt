import { GitBranch, GitMerge, GitPullRequest, X } from "lucide-react";
import { useEffect, useState } from "react";
import { getPRs, type PrSummary } from "./api";
import { OpenPRButton } from "./Menus";

type Tab = "open" | "merged" | "closed";

/** "today" / "yesterday" / "N days ago" / a date – the list's quiet age. */
export function ageOf(iso: string | undefined): string {
	if (!iso) return "";
	const t = Date.parse(iso);
	if (Number.isNaN(t)) return "";
	const days = Math.floor(
		(new Date().setHours(0, 0, 0, 0) - new Date(t).setHours(0, 0, 0, 0)) /
			86_400_000,
	);
	if (days <= 0) return "today";
	if (days === 1) return "yesterday";
	if (days < 14) return `${days} days ago`;
	return new Date(t).toLocaleDateString([], { month: "short", day: "numeric" });
}

/**
 * The PR list (ui v1, phase 9): a sheet that slides over the doc from the
 * right, the doc dimmed behind it. Open / Merged / Closed with counts (the
 * closed list is GitHub's newest 50, split by merged_at), one row per PR,
 * and – when the current branch is a draft without a PR – the call to
 * open one. A row opens the full-stage review (App guards that hand-off).
 */
export function PRList({
	repoLabel,
	branch,
	mainName,
	branchHasPr,
	onOpen,
	onCreated,
	onClose,
}: {
	/** "owner/repo" for the kicker; null hides it. */
	repoLabel: string | null;
	branch: string | null;
	mainName: string | null;
	/** The current branch already has an open PR (App's byBranch). */
	branchHasPr: boolean;
	onOpen: (n: number) => void;
	/** A PR was opened from the call-to-action card. */
	onCreated: (n: number) => void;
	onClose: () => void;
}) {
	const [tab, setTab] = useState<Tab>("open");
	const [open, setOpenPrs] = useState<PrSummary[] | null>(null);
	const [closed, setClosed] = useState<PrSummary[] | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		getPRs()
			.then((r) => {
				if (!cancelled) setOpenPrs(r.prs ?? []);
			})
			.catch((e: unknown) => {
				if (!cancelled) setError(e instanceof Error ? e.message : String(e));
			});
		// The Merged/Closed counts need the closed list too – one more call
		// per open of the drawer; a failure just leaves those tabs empty.
		getPRs("closed")
			.then((r) => {
				if (!cancelled) setClosed(r.prs ?? []);
			})
			.catch(() => {
				if (!cancelled) setClosed([]);
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const merged = (closed ?? []).filter((p) => p.merged_at);
	const closedOnly = (closed ?? []).filter((p) => !p.merged_at);
	const lists: Record<Tab, PrSummary[] | null> = {
		open,
		merged: closed && merged,
		closed: closed && closedOnly,
	};
	const shown = lists[tab];
	const offMain = branch !== null && branch !== (mainName ?? "main");

	return (
		<aside className="drawer pr-drawer" aria-label="Pull requests">
			<div className="dh">
				<div className="kicker">
					<span className="type">Pull requests</span>
					{repoLabel && <span className="rule" />}
					{repoLabel && <span>{repoLabel}</span>}
				</div>
				<button
					type="button"
					className="btn icon"
					aria-label="Close pull requests"
					title="Close pull requests"
					onClick={onClose}
				>
					<X aria-hidden="true" />
				</button>
			</div>
			<div className="db">
				<fieldset className="seg" aria-label="Filter pull requests">
					{(
						[
							["open", "Open", open],
							["merged", "Merged", closed && merged],
							["closed", "Closed", closed && closedOnly],
						] as const
					).map(([key, label, list]) => (
						<button
							key={key}
							type="button"
							aria-pressed={tab === key}
							onClick={() => setTab(key)}
						>
							{label}
							<span className="n">{list ? list.length : "…"}</span>
						</button>
					))}
				</fieldset>
				{error && (
					<p className="pr-error" role="alert">
						{error}
					</p>
				)}
				{!error &&
					(shown === null ? (
						<p className="pr-note">Loading pull requests…</p>
					) : shown.length === 0 ? (
						<p className="pr-note">
							{tab === "open"
								? "No open pull requests."
								: tab === "merged"
									? "No merged pull requests."
									: "No closed pull requests."}
						</p>
					) : (
						<ul className="prl">
							{shown.map((p) => {
								const state = p.merged_at
									? "merged"
									: p.state === "closed"
										? "closed"
										: "open";
								return (
									<li key={p.number}>
										<button
											type="button"
											className={`pr ${state}`}
											title={p.title}
											onClick={() => onOpen(p.number)}
										>
											{state === "merged" ? (
												<GitMerge className="ic" aria-hidden="true" />
											) : (
												<GitPullRequest className="ic" aria-hidden="true" />
											)}
											<span className="pt">{p.title}</span>
											<span className="ps">
												{p.additions !== undefined && (
													<span className="ins">+{p.additions}</span>
												)}{" "}
												{p.deletions !== undefined && (
													<span className="del">−{p.deletions}</span>
												)}
											</span>
											<span className="pm">
												<span className="mono">#{p.number}</span>
												<span className="flow">
													{p.head.ref} <i>→</i> {p.base.ref}
												</span>
												<span>
													· {p.user.login}
													{p.created_at ? ` · ${ageOf(p.created_at)}` : ""}
												</span>
											</span>
										</button>
									</li>
								);
							})}
						</ul>
					))}
				{offMain && !branchHasPr && branch && (
					<div className="cta">
						<GitBranch aria-hidden="true" />
						<p>
							<b>{branch}</b> has no pull request yet.
						</p>
						<OpenPRButton
							branch={branch}
							base={mainName}
							onCreated={onCreated}
						/>
					</div>
				)}
			</div>
		</aside>
	);
}
