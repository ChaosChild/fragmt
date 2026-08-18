import { ChevronRight } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { TreeNode } from "./api";
import { type FileOp, RowMenu } from "./Menus";

function countDocs(node: TreeNode): number {
	let n = 0;
	for (const c of node.children ?? []) {
		n += c.type === "doc" ? 1 : countDocs(c);
	}
	return n;
}

interface NodesProps {
	nodes: TreeNode[];
	selected: string | null;
	onSelect: (path: string) => void;
	onFileOp: (op: FileOp) => void;
	collapsed: Set<string>;
	toggle: (path: string) => void;
}

function renderNodes({
	nodes,
	selected,
	onSelect,
	onFileOp,
	collapsed,
	toggle,
}: NodesProps): ReactNode[] {
	return nodes.map((node) => {
		if (node.type === "dir") {
			const isCollapsed = collapsed.has(node.path);
			return (
				<li className="folder-group" key={node.path}>
					<div className="tree-row">
						<button
							type="button"
							className="folder-row"
							aria-expanded={!isCollapsed}
							onClick={() => toggle(node.path)}
						>
							<span className="disclosure">
								<ChevronRight aria-hidden="true" />
							</span>
							{node.name}
							<span className="count">{countDocs(node)}</span>
						</button>
						<RowMenu
							kind="folder"
							path={node.path}
							name={node.name}
							onFileOp={onFileOp}
						/>
					</div>
					{!isCollapsed && (
						<ul className="folder-children">
							{renderNodes({
								nodes: node.children ?? [],
								selected,
								onSelect,
								onFileOp,
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
				<div className="tree-row">
					<button
						type="button"
						className={`doc-card${node.path === selected ? " active" : ""}`}
						onClick={() => onSelect(node.path)}
					>
						<span className="dc-top">
							<span className="dc-title">{node.name}</span>
						</span>
					</button>
					<RowMenu
						kind="doc"
						path={node.path}
						name={node.name}
						onFileOp={onFileOp}
					/>
				</div>
			</li>
		);
	});
}

export function Sidebar({
	tree,
	selected,
	onSelect,
	onFileOp,
}: {
	tree: TreeNode | null;
	selected: string | null;
	onSelect: (path: string) => void;
	onFileOp: (op: FileOp) => void;
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
				onFileOp,
				collapsed,
				toggle,
			})}
		</ul>
	);
}
