import {
	FileText,
	GitPullRequest,
	PanelLeft,
	Search,
	Waypoints,
} from "lucide-react";
import type { ReactNode } from "react";
import { useAuth } from "./AuthGate";
import { UserChip } from "./Menus";
import { ThemeToggle } from "./ThemeToggle";

/** Which main view the rail marks current (aria-current + the accent bar). */
export type RailView = "docs" | "graph" | "prs";

function RailButton({
	label,
	tip,
	current,
	onClick,
	children,
}: {
	label: string;
	tip: ReactNode;
	current?: boolean;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			className="rbtn"
			aria-label={label}
			title={label}
			aria-current={current ? "true" : undefined}
			onClick={onClick}
		>
			{children}
			<span className="tip" aria-hidden="true">
				{tip}
			</span>
		</button>
	);
}

/**
 * The instrument rail (ui v1): the app-level views and the global toggles,
 * always present – the navigator collapses, the rail never does. The PR and
 * graph entries keep their gates and accessible names from the head rows
 * they replaced (tests click them by name).
 */
export function Rail({
	view,
	onDocuments,
	onSearch,
	onPrs,
	prOpenCount,
	onGraph,
	navCollapsed,
	onToggleNav,
}: {
	view: RailView;
	onDocuments: () => void;
	onSearch: () => void;
	/** Absent = the PR surface is unavailable (auth off or no GitHub origin). */
	onPrs?: () => void;
	/** Open PRs known from the boot fetch – the dot shows when > 0. */
	prOpenCount: number;
	/** Absent = not an OKF repo (the graph's gate). */
	onGraph?: () => void;
	navCollapsed: boolean;
	onToggleNav: () => void;
}) {
	const auth = useAuth();
	return (
		<nav className="rail" aria-label="App">
			<div className="mark" role="img" aria-label="fragmt">
				f
			</div>
			<RailButton
				label="Documents"
				tip="Documents"
				current={view === "docs"}
				onClick={onDocuments}
			>
				<FileText aria-hidden="true" />
			</RailButton>
			<RailButton
				label="Search (Ctrl+K)"
				tip={
					<>
						Search <span className="mono">Ctrl K</span>
					</>
				}
				onClick={onSearch}
			>
				<Search aria-hidden="true" />
			</RailButton>
			{onPrs && (
				<RailButton
					label="Pull requests"
					tip={
						prOpenCount > 0
							? `Pull requests · ${prOpenCount} open`
							: "Pull requests"
					}
					current={view === "prs"}
					onClick={onPrs}
				>
					<GitPullRequest aria-hidden="true" />
					{prOpenCount > 0 && <span className="dot" />}
				</RailButton>
			)}
			{onGraph && (
				<RailButton
					label="Reference graph"
					tip="Reference graph"
					current={view === "graph"}
					onClick={onGraph}
				>
					<Waypoints aria-hidden="true" />
				</RailButton>
			)}
			<div className="rail-sp" />
			<RailButton
				label={navCollapsed ? "Show navigator" : "Hide navigator"}
				tip={
					<>
						{navCollapsed ? "Show navigator" : "Hide navigator"}{" "}
						<span className="mono">Ctrl \</span>
					</>
				}
				onClick={onToggleNav}
			>
				<PanelLeft aria-hidden="true" />
			</RailButton>
			<ThemeToggle />
			{auth && (
				<UserChip
					login={auth.login}
					canWrite={auth.canWrite}
					onSignOut={auth.signOut}
				/>
			)}
		</nav>
	);
}
