import { useEffect, useState } from "react";
import { type DocResponse, getDoc, getTree, type TreeNode } from "./api";
import { DocView } from "./DocView";
import { Sidebar } from "./Sidebar";
import { ThemeToggle } from "./ThemeToggle";

function firstDoc(node: TreeNode): string | null {
	for (const child of node.children ?? []) {
		if (child.type === "doc") return child.path;
		const found = firstDoc(child);
		if (found) return found;
	}
	return null;
}

export function App() {
	const [tree, setTree] = useState<TreeNode | null>(null);
	const [selected, setSelected] = useState<string | null>(null);
	const [doc, setDoc] = useState<DocResponse | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		getTree()
			.then(setTree)
			.catch((e: unknown) =>
				setError(e instanceof Error ? e.message : String(e)),
			);
	}, []);

	// Auto-select the first doc once the tree lands.
	useEffect(() => {
		if (tree && !selected) {
			const found = firstDoc(tree);
			if (found) setSelected(found);
		}
	}, [tree, selected]);

	// Load the selected doc.
	useEffect(() => {
		if (!selected) {
			setDoc(null);
			return;
		}
		setDoc(null);
		getDoc(selected)
			.then(setDoc)
			.catch((e: unknown) =>
				setError(e instanceof Error ? e.message : String(e)),
			);
	}, [selected]);

	// Refetch after a discarded/stale buffer (the 409 reload path).
	const reloadSelected = () => {
		if (!selected) return;
		getDoc(selected)
			.then(setDoc)
			.catch((e: unknown) =>
				setError(e instanceof Error ? e.message : String(e)),
			);
	};

	return (
		<>
			<div className="ambient" aria-hidden="true" />
			<div className="layout">
				<aside className="sidebar" aria-label="Documents">
					<div className="side-head">
						<span className="brand">fragmt</span>
						<div className="side-head-spacer" />
						<ThemeToggle />
					</div>
					<Sidebar tree={tree} selected={selected} onSelect={setSelected} />
					{error && (
						<p className="label-meta" style={{ padding: "0 16px 16px" }}>
							{error}
						</p>
					)}
				</aside>
				<main className="main">
					<DocView
						doc={doc}
						selected={selected}
						onSaved={setDoc}
						onReload={reloadSelected}
					/>
				</main>
			</div>
		</>
	);
}
