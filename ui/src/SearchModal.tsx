import { Search } from "lucide-react";
import {
	type KeyboardEvent as ReactKeyboardEvent,
	useEffect,
	useRef,
	useState,
} from "react";
import { type SearchHit, searchDocs } from "./api";
import { highlightSegments } from "./highlight";

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

/**
 * The Ctrl+K search dialog (#14): a Spotlight-style centered modal –
 * debounced as-you-type against /api/search, a keyboard listbox (↑/↓/↵/esc),
 * and opens that go through App's guarded callback (the navigation queue):
 * the modal just calls `onOpen(path)` and closes; a dirty buffer is App's
 * save-or-discard banner, never a silent drop. The ⇧ variant (#15 b4)
 * passes {slideout:true} – the result opens in the slideout preview, a
 * read that skips the queue by design.
 */
export function SearchModal({
	open,
	onClose,
	onOpen,
}: {
	open: boolean;
	onClose: () => void;
	/** App's guarded open (guardAction); {slideout:true} = the preview. */
	onOpen: (path: string, opts?: { slideout?: boolean }) => void;
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

	// Keyboard selection follows inside the scrollable list (SlashMenu's
	// block:"nearest" – the minimum scroll, so the overlay never drags
	// anything along). Runs after render: the row's DOM exists by then, and
	// again when a fresh list lands (the kept scrollTop must go home).
	useEffect(() => {
		if (!results?.length) return;
		listRef.current
			?.querySelectorAll('[role="option"]')
			[active]?.scrollIntoView({ block: "nearest" });
	}, [active, results]);

	// null = no query to show (the trimmed-<2 word); [] = "No matches".
	const hits = q.trim().length >= 2 ? results : null;
	const hit = hits?.[active];

	function move(dir: 1 | -1) {
		if (!hits?.length) return;
		setActive((a) => (a + dir + hits.length) % hits.length);
	}

	const onInputKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
		if (e.key === "ArrowDown") {
			e.preventDefault();
			move(1);
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			move(-1);
		} else if (e.key === "Enter") {
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
						placeholder="Search documents…"
						aria-label="Search documents"
						role="combobox"
						aria-expanded={hits !== null}
						aria-controls="search-results"
						aria-activedescendant={hit ? `search-hit-${active}` : undefined}
						aria-autocomplete="list"
						autoComplete="off"
						value={q}
						onChange={(e) => setQ(e.target.value)}
						onKeyDown={onInputKey}
					/>
					<kbd>esc</kbd>
				</div>
				{hits && hits.length > 0 && (
					// The listbox is a role-carrying div (SlashMenu's menu shape)
					// with tabIndex -1: not a tab stop – the input above owns the
					// keyboard and points at rows via aria-activedescendant, the
					// WAI-ARIA combobox pattern.
					<div
						className="search-results"
						id="search-results"
						role="listbox"
						aria-label="Search results"
						tabIndex={-1}
						ref={listRef}
					>
						{hits.map((h, i) => (
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
									<Highlighted text={h.title} q={q} />
								</span>
								<span className="sr-snippet">
									<Highlighted text={h.snippet} q={q} />
								</span>
							</div>
						))}
					</div>
				)}
				{hits && hits.length === 0 && (
					<p className="search-empty">No matches for “{q.trim()}”.</p>
				)}
				<p className="search-foot">
					<span>
						<kbd>↑↓</kbd> navigate
					</span>
					<span className="sep">·</span>
					<span>
						<kbd>↵</kbd> open
					</span>
					<span className="sep">·</span>
					<span>
						<kbd>⇧↵</kbd> slideout
					</span>
					<span className="sep">·</span>
					<span>
						<kbd>esc</kbd> close
					</span>
				</p>
			</div>
		</div>
	);
}
