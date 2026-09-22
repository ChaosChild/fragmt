import { GitBranch, Plus, Trash2 } from "lucide-react";
import {
	type FormEvent,
	type MouseEvent as ReactMouseEvent,
	type ReactNode,
	type Ref,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { getBranches, getPRs, openPR } from "./api";
import { popoverPosition } from "./popover-position";

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
	| { kind: "delete"; name: string }
	/** #27 (b3): the row's PR chip – App opens the slideout on that PR. */
	| { kind: "view-pr"; number: number }
	/** #27 (b3): the open-PR popover's success – same slideout target. */
	| { kind: "open-pr-created"; number: number };

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
 * otherwise clip/misplace it. Positioned from the anchor's rect plus the
 * popover's own measured size (useLayoutEffect, before paint; re-measures on
 * any re-render while open, which is idempotent while the anchor stands still).
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
	const inner = useRef<HTMLDivElement | null>(null);
	useLayoutEffect(() => {
		const el = inner.current;
		if (!el || !anchor) return;
		const p = popoverPosition(
			anchor.getBoundingClientRect(),
			{ width: el.offsetWidth, height: el.offsetHeight },
			{ width: window.innerWidth, height: window.innerHeight },
		);
		el.style.top = `${p.top}px`;
		el.style.left = `${p.left}px`;
	});
	if (!anchor) return null;
	const r = anchor.getBoundingClientRect();
	return createPortal(
		<div
			className="menu-popover"
			ref={(n) => {
				inner.current = n;
				if (typeof popRef === "function") popRef(n);
				else if (popRef) popRef.current = n;
			}}
			style={{ top: r.bottom + 6, left: r.left }}
		>
			{children}
		</div>,
		document.body,
	);
}

/**
 * The signed-in user chip (#20, auth batch): avatar + login, opens the
 * one-item sign-out menu. Lives at the end of the doc head (owner round –
 * moved out of the sidebar head's brand row). canWrite=false adds the warn
 * read-only pill so a read collaborator reads the coming 403s before
 * hitting one.
 */
export function UserChip({
	login,
	canWrite,
	onSignOut,
}: {
	login: string;
	canWrite: boolean;
	onSignOut: () => void;
}) {
	const menu = useMenu();
	return (
		<span className="menu-wrap user-chip-wrap">
			{!canWrite && <span className="readonly-pill">read-only</span>}
			<button
				type="button"
				className="user-chip"
				title={`${login} – sign out`}
				aria-label={`Signed in as ${login}. Sign out`}
				aria-expanded={menu.open}
				onClick={menu.toggle}
			>
				<img
					className="chip-avatar"
					src={`https://avatars.githubusercontent.com/${encodeURIComponent(login)}?s=64`}
					alt=""
					width={18}
					height={18}
					onError={(e) => {
						e.currentTarget.style.visibility = "hidden";
					}}
				/>
				<span className="chip-login">{login}</span>
			</button>
			<MenuPopover anchor={menu.anchor} popRef={menu.popRef}>
				<button
					type="button"
					className="menu-item"
					onClick={() => {
						menu.close();
						onSignOut();
					}}
				>
					Sign out
				</button>
			</MenuPopover>
		</span>
	);
}

/**
 * The sidebar-head branch control: reads as metadata ("on main"), opens a
 * small menu to switch, create, or delete a branch. Performing the action
 * (and the unsaved-changes guard on switches) is App's business.
 * #27 (b3): when prsEnabled, opening also fetches GET /api/prs in parallel –
 * each non-current row gains a PR chip (`PR #n` to view, dashed `open PR` to
 * create, in-menu popover) and the trash gates on the merged list (D7).
 */
export function BranchMenu({
	current,
	prsEnabled,
	onAction,
}: {
	current: string | null;
	prsEnabled: boolean;
	onAction: (action: BranchAction) => void;
}) {
	const menu = useMenu();
	const [branches, setBranches] = useState<string[] | null>(null);
	const [merged, setMerged] = useState<string[] | null>(null);
	const [failed, setFailed] = useState(false);
	const [name, setName] = useState("");
	// branch → its open PR (the only field the chips read); null = unfetched
	// or failed – no chips either way, the menu still works.
	const [byBranch, setByBranch] = useState<Record<
		string,
		{ number: number }
	> | null>(null);
	// The open-PR popover's branch (the NewDocButton mode swap) + its form.
	const [openPrFor, setOpenPrFor] = useState<string | null>(null);
	const [prBody, setPrBody] = useState("");
	const [prError, setPrError] = useState<string | null>(null);

	useEffect(() => {
		if (!menu.open) {
			setOpenPrFor(null);
			setPrError(null);
			return;
		}
		getBranches()
			.then((r) => {
				setBranches(r.branches);
				setMerged(r.merged);
				setFailed(false);
			})
			.catch(() => setFailed(true));
		if (prsEnabled)
			getPRs()
				.then((r) => setByBranch(r.byBranch ?? {}))
				.catch(() => setByBranch(null));
	}, [menu.open, prsEnabled]);

	function submit(e: FormEvent) {
		e.preventDefault();
		const n = name.trim();
		if (!n) return;
		setName("");
		menu.close();
		onAction({ kind: "create", name: n });
	}

	// Branch + optional description only – the title derives server-side.
	// A failure keeps the form open with the server's error inline.
	async function submitOpenPr(e: FormEvent) {
		e.preventDefault();
		const b = openPrFor;
		if (!b) return;
		try {
			const pr = await openPR(b, prBody.trim() || undefined);
			menu.close();
			setOpenPrFor(null);
			setPrBody("");
			onAction({ kind: "open-pr-created", number: pr.number });
		} catch (e2) {
			setPrError(e2 instanceof Error ? e2.message : String(e2));
		}
	}

	const prBy = (b: string) => byBranch?.[b] ?? null;
	const isMerged = (b: string) => merged?.includes(b) ?? false;

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
				{openPrFor !== null ? (
					<form className="popover-form" onSubmit={submitOpenPr}>
						<p className="menu-note">
							<strong>Open pull request</strong>
							<br />
							{openPrFor}
						</p>
						<label htmlFor="pr-desc">Description (optional)</label>
						<textarea
							id="pr-desc"
							value={prBody}
							onChange={(e) => setPrBody(e.target.value)}
						/>
						{prError && (
							<p className="rename-error" role="alert">
								{prError}
							</p>
						)}
						<div className="popover-actions">
							<button type="submit" className="iconbtn primary">
								Open PR
							</button>
						</div>
					</form>
				) : (
					<>
						{(branches ?? []).map((b) => {
							const pr = prBy(b);
							return (
								// One row, three targets: the name switches, the PR chip
								// views/creates (non-current rows only), the trash deletes
								// (never offered on the current branch – the server refuses
								// it; gated on merged, D7 – no force-delete from here).
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
									{b !== current && pr && (
										<button
											type="button"
											className="pr-chip"
											title={`View pull request #${pr.number}`}
											onClick={() => {
												menu.close();
												onAction({ kind: "view-pr", number: pr.number });
											}}
										>
											PR #{pr.number}
										</button>
									)}
									{b !== current && !pr && byBranch !== null && (
										<button
											type="button"
											className="pr-chip open"
											title="Open a pull request for this branch"
											onClick={() => setOpenPrFor(b)}
										>
											open PR
										</button>
									)}
									{b !== current && (
										<button
											type="button"
											className="tool-btn"
											disabled={!isMerged(b)}
											title={isMerged(b) ? "Delete branch" : "Not merged yet"}
											aria-label={`Delete branch ${b}`}
											aria-disabled={!isMerged(b) || undefined}
											onClick={() => {
												if (!isMerged(b)) return;
												menu.close();
												onAction({ kind: "delete", name: b });
											}}
										>
											<Trash2 aria-hidden="true" />
										</button>
									)}
								</span>
							);
						})}
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
					</>
				)}
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
