import type { AtDoc } from "./editor/at";

/** Path → display title through the shared doc set (paths stay the
 *  identity); a path meta hasn't seen yet falls back to itself. */
function titleFor(docs: AtDoc[], path: string): string {
	return docs.find((d) => d.path === path)?.title ?? path;
}

/**
 * The slideout's third mode (#33, D1): the open doc's derived graph –
 * outgoing `references` and incoming `referenced-by`, straight from the doc
 * payload's curated frontmatter. A row click opens the target in the
 * slideout's PREVIEW split (App's openPreviewDoc, the #15 machinery): the
 * main pane keeps the current doc, so the reference reads beside it – true
 * side-by-side, the default. Promoting the target to the main pane stays
 * available through the preview head's own open-in-main button. Preview
 * opens skip the dirty-guard queue by design (read-only, the buffer
 * untouched – openFromSearch's slideout branch). Empty lists render a calm
 * line, never a warning.
 */
export function ReferencesPane({
	references,
	referencedBy,
	docs,
	onPreview,
}: {
	references: string[];
	referencedBy: string[];
	/** The tree's docs – row labels resolve through the display-name model. */
	docs: AtDoc[];
	/** Open the path in the slideout's preview split (App's openPreviewDoc). */
	onPreview: (path: string) => void;
}) {
	const section = (heading: string, paths: string[], empty: string) => (
		<section className="refs-section">
			<h3 className="refs-heading">{heading}</h3>
			{paths.length === 0 ? (
				<p className="refs-empty">{empty}</p>
			) : (
				<ul className="refs-list">
					{paths.map((p) => (
						<li key={p}>
							<button
								type="button"
								className="refs-row"
								title={p}
								onClick={() => onPreview(p)}
							>
								{titleFor(docs, p)}
							</button>
						</li>
					))}
				</ul>
			)}
		</section>
	);
	return (
		<div className="refs-pane">
			{section(
				"References",
				references,
				"No outgoing references yet – body links land here on save.",
			)}
			{section("Referenced by", referencedBy, "Nothing links here yet.")}
		</div>
	);
}
