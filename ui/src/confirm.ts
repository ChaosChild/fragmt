/** What a confirmation asks: a title, one line of consequence, the action. */
export interface ConfirmOptions {
	title: string;
	body?: string;
	/** The confirming button's label – the action's verb ("Delete"). */
	confirmLabel: string;
	/** Destructive – the confirm button wears the danger colour. */
	danger?: boolean;
}

export type ConfirmRequest = ConfirmOptions & {
	resolve: (ok: boolean) => void;
};
type Show = (req: ConfirmRequest) => void;

// Its own module (not ConfirmDialog.tsx) so a hot update of the dialog
// never re-creates this registry under callers still holding the old one.
let show: Show | null = null;

/** ConfirmHost registers on mount; the returned function unregisters – only
 *  if it is still the current host (a remount registers before the old
 *  host's cleanup runs). */
export function registerConfirmHost(fn: Show): () => void {
	show = fn;
	return () => {
		if (show === fn) show = null;
	};
}

/**
 * The house replacement for window.confirm: resolves true on confirm, false
 * on Cancel / Escape / backdrop. Never silent: with no <ConfirmHost />
 * mounted it warns and falls back to the browser's confirm (false where
 * there is none) – a delete never just does nothing.
 */
export function askConfirm(opts: ConfirmOptions): Promise<boolean> {
	return new Promise((resolve) => {
		if (show) return show({ ...opts, resolve });
		console.warn("askConfirm: no ConfirmHost mounted – using window.confirm");
		const text = opts.body ? `${opts.title}\n\n${opts.body}` : opts.title;
		resolve(
			typeof window !== "undefined" && typeof window.confirm === "function"
				? window.confirm(text)
				: false,
		);
	});
}
