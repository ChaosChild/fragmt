import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { DocResponse } from "./api";

export function DocView({
	doc,
	selected,
}: {
	doc: DocResponse | null;
	selected: string | null;
}) {
	if (!selected) {
		return (
			<div className="doc-pane">
				<p className="label-meta">Select a document.</p>
			</div>
		);
	}
	const segs = selected.split("/");
	const file = segs[segs.length - 1];
	const dir = segs.slice(0, -1).join(" / ");
	return (
		<div className="doc-pane">
			<div className="doc-bar">
				<nav className="breadcrumb" aria-label="Breadcrumb">
					{dir ? `${dir} / ` : ""}
					<span>{file}</span>
				</nav>
			</div>
			<article className="markdown">
				{doc ? (
					<ReactMarkdown remarkPlugins={[remarkGfm]}>
						{doc.markdown}
					</ReactMarkdown>
				) : null}
			</article>
		</div>
	);
}
