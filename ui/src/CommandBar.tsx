import type { ReactNode } from "react";

/**
 * The stage's command bar (ui v1): what you're looking at on the left,
 * what you can do with it on the right. Presentational – each main view
 * (doc, PR review, graph, merge resolution) renders its own.
 */
export function CommandBar({
	start,
	children,
}: {
	start: ReactNode;
	/** The actions, right-aligned. */
	children?: ReactNode;
}) {
	return (
		<header className="cmd">
			<div className="cmd-start">{start}</div>
			<div className="cmd-sp" />
			{children}
		</header>
	);
}
