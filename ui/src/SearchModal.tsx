import { FilePlus, GitBranch, Search, Waypoints } from "lucide-react";
import {
	type KeyboardEvent as ReactKeyboardEvent,
	type ReactNode,
	useEffect,
	useRef,
	useState,
} from "react";
import {
	type DocMeta,
	type DocResponse,
	getDoc,
	type SearchHit,
	searchDocs,
} from "./api";
import { TRUST_WORD, trustClass } from "./display";
import { highlightSegments, plainExcerpt } from "./highlight";

/** One line with the query's matches as <mark> (title or snippet). Each
 *  segment's key is its end offset in the text – its position-identity. */
function Highlighted({ text, q }: { text: string; q: string }) {
	let end = 0;
	return (
		<>
			{highlightSegments(text, q).map((part) => {
				end += part.text.length;
				return part.hit ? (
					<mark key={end}>{part.text}</mark>
				) : (
					<span key={end}>{part.text}</span>
				);
			})}
		</>
	);
}

/** A palette action: shown when the query matches its name. */
interface PaletteAction {
	name: string;
	icon: ReactNode;
	run: () => void;
}

/** The folder part of a docsRoot-relative path ("" at the root). */
const folderOf = (path: string) =>
	path.includes("/") ? `${path.slice(0, path.lastIndexOf("/"))}/` : "";

/**
 * The Ctrl+K search palette (#14, ui v1): results left, a live preview of
 * the selected doc right, and an Actions group. Debounced as-you-type
 * against /api/search, a keyboard listbox (↑/↓ wrap, ↵ open, ⇧↵ preview
 * beside, esc), and opens that go through App's guarded callback (the
 * navigation queue): the palette just calls `onOpen(path)` and closes; a
 * dirty buffer is App's save-or-discard banner, never a silent drop. The
 * preview is plain text only – a body is never rendered as HTML here.
 */
export function SearchModal({
	open,
	onClose,
	onOpen,
	docMetas = {},
	branch = null,
	onSync,
	onNewDoc,
	onOpenGraph,
}: {
	open: boolean;
	onClose: () => void;
	/** App's guarded open (guardAction); {slideout:true} = the preview. */
	onOpen: (path: string, opts?: { slideout?: boolean }) => void;
	/** meta.docs – each hit's trust mark. */
	docMetas?: Record<string, DocMeta>;
	/** The branch being searched – the footer says so. */
	branch?: string | null;
	/** The actions run through the same paths as their buttons; absent =
	 *  not offered (the graph on non-OKF repos). */
	onSync?: () => void;
	onNewDoc?: () => void;
	onOpenGraph?: () => void;
}) {
	const [q, setQ] = useState("");
	const [results, setResults] = useState<SearchHit[] | null>(null);
	const [active, setActive] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLDivElement>(null);
	// Focus give-back (#14): the element that owned the keyboard before the
	// dialog opened (usually the editor) – captured at open, refocused on close.
	const restoreRef = useRef<HTMLElement | null>(null);
	// Monotonic fetch sequence – a response lands only if it is still the
	// newest; a newer keystroke's request supersedes anything in flight.
	const seqRef = useRef(0);
	// The preview: fetched docs cached for the palette's lifetime; the path
	// the preview should show right now (a late response for another path is
	// dropped on arrival).
	const cacheRef = useRef(new Map<string, DocResponse>());
	const wantRef = useRef<string | null>(null);
	const [preview, setPreview] = useState<DocResponse | null>(null);

	// Open resets the dialog and takes focus (the modal owns the keyboard –
	// the editor underneath never sees a key); close hands focus back.
	useEffect(() => {
		if (!open) return;
		restoreRef.current =
			document.activeElement instanceof HTMLElement
				? document.activeElement
				: null;
		setQ("");
		setResults(null);
		setActive(0);
		setPreview(null);
		cacheRef.current = new Map();
		inputRef.current?.focus();
		return () => {
			restoreRef.current?.focus();
		};
	}, [open]);

	// Debounced as-you-type: 250ms after the last keystroke with ≥2 trimmed
	// chars fetches; anything shorter empties the list (the server's own rule
	// mirrored client-side). Stale responses never land (seqRef).
	useEffect(() => {
		const query = q.trim();
		if (!open || query.length < 2) {
			seqRef.current++;
			setResults(null);
			return;
		}
		const timer = setTimeout(() => {
			const seq = ++seqRef.current;
			searchDocs(query)
				.then((hits) => {
					if (seqRef.current !== seq) return;
					setResults(hits);
					setActive(0);
				})
				.catch(() => {
					if (seqRef.current !== seq) return;
					setResults([]);
				});
		}, 250);
		return () => clearTimeout(timer);
	}, [q, open]);

	// null = no query to show (the trimmed-<2 word); [] = "No matches".
	const hits = q.trim().length >= 2 ? results : null;
	const needle = q.trim().toLowerCase();
	const offered: PaletteAction[] = [];
	if (onSync)
		offered.push({
			name: "Sync now",
			icon: <GitBranch aria-hidden="true" />,
			run: onSync,
		});
	if (onNewDoc)
		offered.push({
			name: "New document",
			icon: <FilePlus aria-hidden="true" />,
			run: onNewDoc,
		});
	if (onOpenGraph)
		offered.push({
			name: "Open reference graph",
			icon: <Waypoints aria-hidden="true" />,
			run: onOpenGraph,
		});
	const actions =
		needle.length >= 2
			? offered.filter((a) => a.name.toLowerCase().includes(needle))
			: [];
	const docCount = hits?.length ?? 0;
	const total = docCount + actions.length;
	const hit = active < docCount ? hits?.[active] : undefined;
	const action = active >= docCount ? actions[active - docCount] : undefined;

	// The selected doc's preview: 120ms after the selection settles, from the
	// cache or one getDoc. A response for a path no longer selected is ignored.
	const hitPath = hit?.path ?? null;
	useEffect(() => {
		wantRef.current = hitPath;
		if (!hitPath) {
			setPreview(null);
			return;
		}
		const cached = cacheRef.current.get(hitPath);
		if (cached) {
			setPreview(cached);
			return;
		}
		const timer = setTimeout(() => {
			getDoc(hitPath)
				.then((d) => {
					cacheRef.current.set(hitPath, d);
					if (wantRef.current === hitPath) setPreview(d);
				})
				.catch(() => {
					if (wantRef.current === hitPath) setPreview(null);
				});
		}, 120);
		return () => clearTimeout(timer);
	}, [hitPath]);

	// Keyboard selection follows inside the scrollable list (SlashMenu's
	// block:"nearest" – the minimum scroll, so the overlay never drags
	// anything along). Runs after render: the row's DOM exists by then, and
	// again when a fresh list lands (the kept scrollTop must go home).
	useEffect(() => {
		if (total === 0) return;
		listRef.current
			?.querySelectorAll('[role="option"]')
			[active]?.scrollIntoView({ block: "nearest" });
	}, [active, total]);

	function move(dir: 1 | -1) {
		if (total === 0) return;
		setActive((a) => (a + dir + total) % total);
	}

	function runAction(a: PaletteAction) {
		onClose();
		a.run();
	}

	const onInputKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
		if (e.key === "ArrowDown") {
			e.preventDefault();
			move(1);
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			move(-1);
		} else if (e.key === "Enter") {
			if (action) {
				e.preventDefault();
				runAction(action);
				return;
			}
			if (!hit) return;
			e.preventDefault();
			onClose();
			onOpen(hit.path, e.shiftKey ? { slideout: true } : undefined);
		} else if (e.key === "Escape") {
			e.preventDefault();
			onClose();
		}
	};

	if (!open) return null;
	const previewType =
		typeof preview?.frontmatter.type === "string"
			? preview.frontmatter.type
			: "";
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: the backdrop is click-to-close by design – Esc in the input is the keyboard leg.
		// biome-ignore lint/a11y/useKeyWithClickEvents: same dialog contract: the mouse leg closes on backdrop click, the keyboard leg is the input's Esc.
		<div
			className="search-overlay"
			onClick={(e) => {
				if (e.target === e.currentTarget) onClose();
			}}
		>
			<div
				className="search-modal"
				role="dialog"
				aria-modal="true"
				aria-label="Search documents"
			>
				<div className="search-input-row">
					<Search aria-hidden="true" />
					<input
						ref={inputRef}
						type="text"
						placeholder="Search docs, or type an action…"
						aria-label="Search documents"
						role="combobox"
						aria-expanded={hits !== null}
						aria-controls="search-results"
						aria-activedescendant={
							total > 0 ? `search-hit-${active}` : undefined
						}
						aria-autocomplete="list"
						autoComplete="off"
						value={q}
						onChange={(e) => setQ(e.target.value)}
						onKeyDown={onInputKey}
					/>
					<kbd>esc</kbd>
				</div>
				<div className="search-body">
					{/* The listbox is a role-carrying div (SlashMenu's menu shape)
					    with tabIndex -1: not a tab stop – the input above owns the
					    keyboard and points at rows via aria-activedescendant, the
					    WAI-ARIA combobox pattern. */}
					<div
						className="search-results"
						id="search-results"
						role="listbox"
						aria-label="Search results"
						tabIndex={-1}
						ref={listRef}
					>
						{hits && hits.length > 0 && (
							<p className="gh" aria-hidden="true">
								Documents · {hits.length}
							</p>
						)}
						{hits?.map((h, i) => {
							const mark = trustClass(docMetas[h.path]?.okf);
							return (
								// biome-ignore lint/a11y/useKeyWithClickEvents: the row's keyboard lives in the input (↑/↓/↵ via aria-activedescendant) – the option itself is the mouse leg.
								<div
									key={h.path}
									id={`search-hit-${i}`}
									role="option"
									aria-selected={i === active}
									tabIndex={-1}
									className={i === active ? "sr-row active" : "sr-row"}
									onMouseEnter={() => setActive(i)}
									onMouseDown={(e) => e.preventDefault()}
									onClick={(e) => {
										onClose();
										onOpen(h.path, e.shiftKey ? { slideout: true } : undefined);
									}}
								>
									<span className="sr-title">
										{mark && (
											<span
												className={`tr ${mark}`}
												role="img"
												aria-label={TRUST_WORD[mark]}
											/>
										)}
										<span className="sr-t">
											<Highlighted text={h.title} q={q} />
										</span>
										<span className="sr-folder">{folderOf(h.path)}</span>
									</span>
									<span className="sr-snippet">
										<Highlighted text={h.snippet} q={q} />
									</span>
								</div>
							);
						})}
						{hits && hits.length === 0 && (
							<p className="search-empty">No matches for “{q.trim()}”.</p>
						)}
						{actions.length > 0 && (
							<p className="gh" aria-hidden="true">
								Actions
							</p>
						)}
						{actions.map((a, i) => (
							// biome-ignore lint/a11y/useKeyWithClickEvents: as the doc rows – the input owns the keyboard.
							<div
								key={a.name}
								id={`search-hit-${docCount + i}`}
								role="option"
								aria-selected={docCount + i === active}
								tabIndex={-1}
								className={
									docCount + i === active ? "act-row active" : "act-row"
								}
								onMouseEnter={() => setActive(docCount + i)}
								onMouseDown={(e) => e.preventDefault()}
								onClick={() => runAction(a)}
							>
								{a.icon}
								{a.name}
								<kbd>↵</kbd>
							</div>
						))}
					</div>
					<div className="search-preview" aria-live="polite">
						{hit && preview?.path === hit.path ? (
							<>
								<div className="kicker">
									{previewType && <span className="type">{previewType}</span>}
									{previewType && <span className="rule" />}
									<span>{hit.path}</span>
								</div>
								<h2>{hit.title}</h2>
								{plainExcerpt(preview.markdown).map((p, i) => (
									// biome-ignore lint/suspicious/noArrayIndexKey: a fixed excerpt, re-derived per doc
									<p key={i}>
										<Highlighted text={p} q={q} />
									</p>
								))}
							</>
						) : (
							<p className="search-preview-empty">
								{hit
									? "Loading the preview…"
									: "The selected document previews here."}
							</p>
						)}
					</div>
				</div>
				<p className="search-foot">
					<span>
						<kbd>↑</kbd>
						<kbd>↓</kbd> move
					</span>
					<span>
						<kbd>↵</kbd> open
					</span>
					<span>
						<kbd>⇧ ↵</kbd> preview beside
					</span>
					<span>
						<kbd>esc</kbd> close
					</span>
					<span className="search-scope">
						Searches titles and bodies{branch ? ` on ${branch}` : ""}
					</span>
				</p>
			</div>
		</div>
	);
}
