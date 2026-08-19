import { GitBranch, Move, Plus, Trash2 } from "lucide-react";
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

/** Every file operation the sidebar menus can request (App performs it). */
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

/** Docs must end in .md (core rule) — keep free-form input forgiving. */
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
 */
function useMenu() {
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
			if (e.key === "Escape") close();
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
 * Fixed glass popover portalled to document.body — the sidebar's
 * backdrop-filter is a containing block for fixed descendants and would
 * otherwise clip/misplace it.
 */
function MenuPopover({
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
					// (never offered on the current branch — the server refuses it).
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
 * The "+" button (M4-2 item 11): a two-choice popover — New document (the
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

/**
 * Per-row file actions (docs and folders), inline in the card corner left
 * of the version chip (dogfood revision of item 1 — the outside kebab
 * left a dead column beside the card and squashed its text): two small
 * icons — rename/move opens the new-path form, delete asks once — each a
 * focusable ≥32px button revealed on row hover/focus (§5: never
 * hover-only).
 */
export function RowActions({
	kind,
	path,
	name,
	onFileOp,
}: {
	kind: "doc" | "folder";
	path: string;
	name: string;
	onFileOp: (op: FileOp) => void;
}) {
	const move = useMenu();
	const del = useMenu();
	const [to, setTo] = useState(path);
	const inputId = `move-${path.replaceAll("/", "-")}`;
	const inputRef = useRef<HTMLInputElement>(null);
	// Prefill the form with the current path when the popover opens, and
	// land focus in it (M2-2 image-form pattern).
	useEffect(() => {
		if (move.open) {
			setTo(path);
			inputRef.current?.focus();
		}
	}, [move.open, path]);

	return (
		<>
			<span className="menu-wrap" ref={move.wrapRef}>
				<button
					type="button"
					className="tool-btn"
					title="Rename / move"
					aria-label={`Rename or move ${name}`}
					aria-expanded={move.open}
					onClick={move.toggle}
				>
					<Move aria-hidden="true" />
				</button>
				<MenuPopover anchor={move.anchor} popRef={move.popRef}>
					<form
						className="popover-form"
						onSubmit={(e) => {
							e.preventDefault();
							if (!to.trim()) return;
							const dest = kind === "doc" ? toDocPath(to) : toPath(to);
							move.close();
							onFileOp(
								kind === "doc"
									? { kind: "move-doc", from: path, to: dest }
									: { kind: "move-folder", from: path, to: dest },
							);
						}}
					>
						<label htmlFor={inputId}>New path</label>
						<input
							id={inputId}
							ref={inputRef}
							value={to}
							onChange={(e) => setTo(e.target.value)}
						/>
						<div className="popover-actions">
							<button
								type="button"
								className="iconbtn subtle"
								onClick={move.close}
							>
								Cancel
							</button>
							<button type="submit" className="iconbtn primary">
								Move
							</button>
						</div>
					</form>
				</MenuPopover>
			</span>
			<span className="menu-wrap" ref={del.wrapRef}>
				<button
					type="button"
					className="tool-btn"
					title="Delete"
					aria-label={`Delete ${name}`}
					aria-expanded={del.open}
					onClick={del.toggle}
				>
					<Trash2 aria-hidden="true" />
				</button>
				<MenuPopover anchor={del.anchor} popRef={del.popRef}>
					<form
						className="popover-form"
						onSubmit={(e) => {
							e.preventDefault();
							del.close();
							onFileOp(
								kind === "doc"
									? { kind: "delete-doc", path }
									: { kind: "delete-folder", path },
							);
						}}
					>
						<p className="menu-note">
							Delete <strong>{name}</strong>
							{kind === "folder" ? " and everything in it" : ""}? The removal is
							committed.
						</p>
						<div className="popover-actions">
							<button
								type="button"
								className="iconbtn subtle"
								onClick={del.close}
							>
								Cancel
							</button>
							<button type="submit" className="iconbtn danger">
								Delete
							</button>
						</div>
					</form>
				</MenuPopover>
			</span>
		</>
	);
}
