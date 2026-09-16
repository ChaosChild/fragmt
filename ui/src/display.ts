/**
 * The display-name model (M4-3 b4): the frontmatter `title` when the doc
 * carries one, else the file name sans .md. Paths stay the identity
 * everywhere (links, moves, the tree); titles are display-only – the
 * breadcrumb, the sidebar cards, and the @ menu all resolve through this
 * one rule.
 */
export function displayTitle(title: unknown, name: string): string {
	return typeof title === "string" && title.trim()
		? title
		: name.replace(/\.md$/i, "");
}

/**
 * The agent chip's predicate (M4-4 b5): the config `agents` list is
 * name-keyed – a comment author literally in the list gets the chip.
 */
export function isAgent(author: string, agents: string[]): boolean {
	return agents.includes(author);
}

/**
 * The avatar's email → user resolution (extracted from DocView's Avatar, so
 * tests can lock the contract): the config authors map first, then the
 * keyless GitHub noreply heuristic – `123456+user@` or `user@` either way
 * yields the username. Anything else (a plain git email with no map entry)
 * is undefined – the caller falls back to initials.
 */
export function avatarUser(
	email: string,
	authors: Record<string, string>,
): string | undefined {
	return (
		authors[email] ||
		// Mirrors src/core/authors.ts' noreply regex (core cannot import ui) – keep the two in sync.
		/^(\d+\+)?([a-z0-9-]+)@users\.noreply\.github\.com$/i.exec(email)?.[2] ||
		undefined
	);
}

/**
 * The metadata editor's stale_after conversion (#33): a datetime-local
 * value ("YYYY-MM-DDTHH:mm", browser-local) → ISO UTC ("…Z"); "" or an
 * unparseable value → "" (the caller sends null, clearing the key).
 */
export function toIsoUtc(local: string): string {
	if (local === "") return "";
	const ms = Date.parse(local);
	return Number.isNaN(ms) ? "" : new Date(ms).toISOString();
}

/**
 * The editor's stale_after SEED (#33): ISO → the datetime-local form
 * (browser-local, 16 chars). Unparseable/absent → "" – an unset field; a
 * value with seconds or millis loses them (the input's minute precision),
 * which is why the save diffs form values, never round-tripped ISO.
 */
export function isoToLocal(iso: string | null | undefined): string {
	if (!iso) return "";
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "";
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * §5.5 staleness for the badge chips: `now ≥ stale_after`, client clock
 * (shortDate's clock, same trade). A missing or malformed value reads
 * fresh – core's isStale rule, mirrored for the UI's derived chips.
 */
export function isStaleIso(
	iso: string | null | undefined,
	now = Date.now(),
): boolean {
	if (!iso) return false;
	const at = Date.parse(iso);
	return !Number.isNaN(at) && now >= at;
}
