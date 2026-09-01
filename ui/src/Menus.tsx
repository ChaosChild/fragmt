import { GitBranch, Plus, Trash2 } from "lucide-react";
import {
	type FormEvent,
	type MouseEvent as ReactMouseEvent,
	type ReactNode,
	type Ref,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { getBranches } from "./api";

/** Every file operation the sidebar menus / doc head can request (App performs it). */
export type FileOp =
	| { kind: "create-doc"; path: string }
	| { kind: "create-folder"; path: string }
	| { kind: "move-doc"; from: string; to: string }
	| { kind: "delete-doc"; path: string }
	| { kind: "move-folder"; from: string; to: string }
	| { kind: "delete-folder"; path: string };

export type BranchAction =
	| { kind: "switch"; name: string }
	| { kind: "create"; name: string }
	| { kind: "delete"; name: string };

/** Docs must end in .md (core rule) – keep free-form input forgiving. */
function toDocPath(input: string): string {
	const t = input.trim().replace(/^\/+/, "");
	return t.toLowerCase().endsWith(".md") ? t : `${t}.md`;
}

function toPath(input: string): string {
	return input.trim().replace(/^\/+/, "");
}

/**
 * Open/closed state for a small anchored popover. Tracks the anchor button
 * (for placement) and closes on outside pointerdown or Escape (DESIGN §8).
 * Shared by the sidebar menus and the doc head's move picker (M4-3 b4).
 */
export function useMenu() {
	const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
	const wrapRef = useRef<HTMLSpanElement>(null);
	const popRef = useRef<HTMLDivElement>(null);
	const close = useCallback(() => setAnchor(null), []);
	useEffect(() => {
		if (!anchor) return;
		const onDown = (e: PointerEvent) => {
			const t = e.target as Node;
			if (!wrapRef.current?.contains(t) && !popRef.current?.contains(t))
				close();
		};
		const onKey = (e: KeyboardEvent) => {
			// Consumed, and marked so (#15 b5): an open popover always wins
			// the Escape chain – the window fallback (and any future
			// ordering) can see this Escape never reaches the slideout leg.
			if (e.key === "Escape") {
				e.preventDefault();
				close();
			}
		};
		// The popover is placed once; scrolling the list under it would
		// detach it from its row, so any scroll just dismisses.
		const onScroll = () => close();
		document.addEventListener("pointerdown", onDown);
		document.addEventListener("keydown", onKey);
		document.addEventListener("scroll", onScroll, true);
		return () => {
			document.removeEventListener("pointerdown", onDown);
			document.removeEventListener("keydown", onKey);
			document.removeEventListener("scroll", onScroll, true);
		};
	}, [anchor, close]);
	const toggle = (e: ReactMouseEvent<HTMLButtonElement>) => {
		const el = e.currentTarget; // currentTarget is null after dispatch
		setAnchor((a) => (a ? null : el));
	};
	return { open: anchor !== null, anchor, wrapRef, popRef, toggle, close };
}

/**
 * Fixed glass popover portalled to document.body – the sidebar's
 * backdrop-filter is a containing block for fixed descendants and would
 * otherwise clip/misplace it.
 */
export function MenuPopover({
	anchor,
	popRef,
	children,
}: {
	anchor: HTMLButtonElement | null;
	popRef: Ref<HTMLDivElement>;
	children: ReactNode;
}) {
	if (!anchor) return null;
	const r = anchor.getBoundingClientRect();
	return createPortal(
		<div
			className="menu-popover"
			ref={popRef}
			style={{
				top: Math.min(r.bottom + 6, window.innerHeight - 230),
				left: Math.max(8, Math.min(r.left, window.innerWidth - 280)),
			}}
		>
			{children}
		</div>,
		document.body,
	);
}

/**
 * The sidebar-head branch control: reads as metadata ("on main"), opens a
 * small menu to switch, create, or delete a branch. Performing the action
 * (and the unsaved-changes guard on switches) is App's business.
 */
export function BranchMenu({
	current,
	onAction,
}: {
	current: string | null;
	onAction: (action: BranchAction) => void;
}) {
	const menu = useMenu();
	const [branches, setBranches] = useState<string[] | null>(null);
	const [failed, setFailed] = useState(false);
	const [name, setName] = useState("");

	useEffect(() => {
		if (!menu.open) return;
		getBranches()
			.then((r) => {
				setBranches(r.branches);
				setFailed(false);
			})
			.catch(() => setFailed(true));
	}, [menu.open]);

	function submit(e: FormEvent) {
		e.preventDefault();
		const n = name.trim();
		if (!n) return;
		setName("");
		menu.close();
		onAction({ kind: "create", name: n });
	}

	return (
		<span className="menu-wrap" ref={menu.wrapRef}>
			<button
				type="button"
				className="branch-dd"
				title={current ?? "Switch branch"}
				aria-label={`Branch: ${current ?? "unknown"}. Switch branch`}
				aria-expanded={menu.open}
				onClick={menu.toggle}
			>
				<GitBranch aria-hidden="true" />
				<span className="branch-name">on {current ?? "…"}</span>
			</button>
			<MenuPopover anchor={menu.anchor} popRef={menu.popRef}>
				{failed && <p className="menu-empty">branches unavailable</p>}
				{(branches ?? []).map((b) => (
					// One row, two targets: the name switches, the trash deletes
					// (never offered on the current branch – the server refuses it).
					<span key={b} className="menu-row">
						<button
							type="button"
							className="menu-item"
							aria-current={b === current ? "true" : undefined}
							onClick={() => {
								menu.close();
								if (b !== current) onAction({ kind: "switch", name: b });
							}}
						>
							{b}
						</button>
						{b !== current && (
							<button
								type="button"
								className="tool-btn"
								title="Delete branch"
								aria-label={`Delete branch ${b}`}
								onClick={() => {
									menu.close();
									onAction({ kind: "delete", name: b });
								}}
							>
								<Trash2 aria-hidden="true" />
							</button>
						)}
					</span>
				))}
				<form className="popover-form" onSubmit={submit}>
					<label htmlFor="branch-name">New branch</label>
					<input
						id="branch-name"
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="drafts/title"
					/>
					<div className="popover-actions">
						<button type="submit" className="iconbtn primary">
							Create
						</button>
					</div>
				</form>
			</MenuPopover>
		</span>
	);
}

/**
 * The "+" button (M4-2 item 11): a two-choice popover – New document (the
 * existing path form) or New folder (same form, the create-folder op; the
 * folder appears in the tree, nothing gets selected).
 */
export function NewDocButton({ onFileOp }: { onFileOp: (op: FileOp) => void }) {
	const menu = useMenu();
	const [mode, setMode] = useState<"choice" | "doc" | "folder">("choice");
	const [path, setPath] = useState("");
	const pathRef = useRef<HTMLInputElement>(null);
	// Land focus in the form when one opens; reset to the choice menu on close.
	useEffect(() => {
		if (menu.open) {
			if (mode !== "choice") pathRef.current?.focus();
			return;
		}
		setMode("choice");
	}, [menu.open, mode]);

	function submit(e: FormEvent) {
		e.preventDefault();
		if (!path.trim()) return;
		const isDoc = mode === "doc";
		const p = isDoc ? toDocPath(path) : toPath(path);
		setPath("");
		menu.close();
		onFileOp(
			isDoc
				? { kind: "create-doc", path: p }
				: { kind: "create-folder", path: p },
		);
	}

	return (
		<span className="menu-wrap" ref={menu.wrapRef}>
			<button
				type="button"
				className="tool-btn"
				title="New document or folder"
				aria-label="New document or folder"
				aria-expanded={menu.open}
				onClick={menu.toggle}
			>
				<Plus aria-hidden="true" />
			</button>
			<MenuPopover anchor={menu.anchor} popRef={menu.popRef}>
				{mode === "choice" && (
					<>
						<button
							type="button"
							className="menu-item"
							onClick={() => setMode("doc")}
						>
							New document
						</button>
						<button
							type="button"
							className="menu-item"
							onClick={() => setMode("folder")}
						>
							New folder
						</button>
					</>
				)}
				{mode !== "choice" && (
					<form className="popover-form" onSubmit={submit}>
						<label htmlFor="new-path">
							{mode === "doc" ? "New document" : "New folder"}
						</label>
						<input
							id="new-path"
							ref={pathRef}
							value={path}
							onChange={(e) => setPath(e.target.value)}
							placeholder={
								mode === "doc" ? "notes/new-doc.md" : "notes/new-folder"
							}
						/>
						<div className="popover-actions">
							<button type="submit" className="iconbtn primary">
								Create
							</button>
						</div>
					</form>
				)}
			</MenuPopover>
		</span>
	);
}
