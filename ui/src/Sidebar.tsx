import { type ReactNode, useState } from "react";
import type { TreeNode } from "./api";

function countDocs(node: TreeNode): number {
	let n = 0;
	for (const c of node.children ?? []) {
		n += c.type === "doc" ? 1 : countDocs(c);
	}
	return n;
}

const Chevron = (
	<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
		<path d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z" />
	</svg>
);

interface NodesProps {
	nodes: TreeNode[];
	selected: string | null;
	onSelect: (path: string) => void;
	collapsed: Set<string>;
	toggle: (path: string) => void;
}

function renderNodes({
	nodes,
	selected,
	onSelect,
	collapsed,
	toggle,
}: NodesProps): ReactNode[] {
	return nodes.map((node) => {
		if (node.type === "dir") {
			const isCollapsed = collapsed.has(node.path);
			return (
				<li className="folder-group" key={node.path}>
					<button
						type="button"
						className="folder-row"
						aria-expanded={!isCollapsed}
						onClick={() => toggle(node.path)}
					>
						<span className="disclosure">{Chevron}</span>
						{node.name}
						<span className="count">{countDocs(node)}</span>
					</button>
					{!isCollapsed && (
						<ul className="folder-children">
							{renderNodes({
								nodes: node.children ?? [],
								selected,
								onSelect,
								collapsed,
								toggle,
							})}
						</ul>
					)}
				</li>
			);
		}
		return (
			<li key={node.path}>
				<button
					type="button"
					className={`doc-card${node.path === selected ? " active" : ""}`}
					onClick={() => onSelect(node.path)}
				>
					<span className="dc-top">
						<span className="dc-title">{node.name}</span>
					</span>
				</button>
			</li>
		);
	});
}

export function Sidebar({
	tree,
	selected,
	onSelect,
}: {
	tree: TreeNode | null;
	selected: string | null;
	onSelect: (path: string) => void;
}) {
	const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
	const toggle = (path: string) =>
		setCollapsed((prev) => {
			const next = new Set(prev);
			if (next.has(path)) next.delete(path);
			else next.add(path);
			return next;
		});

	if (!tree) return null;
	return (
		<ul className="doc-list">
			{renderNodes({
				nodes: tree.children ?? [],
				selected,
				onSelect,
				collapsed,
				toggle,
			})}
		</ul>
	);
}
