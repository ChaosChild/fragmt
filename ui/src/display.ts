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

/**
 * Core's isReservedBase twin (index.md/log.md, §3.1): reserved files hold no
 * concept frontmatter, so the OKF affordances – metadata editor, Verify,
 * Save as Verified, badge chips – never apply to them. Kept in sync with
 * src/core/okf.ts by hand (the server never imports ui).
 */
export function isReservedDoc(path: string): boolean {
	const base = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
	return base === "index.md" || base === "log.md";
}

/** The mirror type's named keys – everything else in a doc payload is a
 *  §4.1 extension key (operator round C). */
const KNOWN_FRONTMATTER = new Set([
	"title",
	"type",
	"description",
	"tags",
	"status",
	"generated",
	"verified",
	"stale_after",
	"references",
	"referenced-by",
]);

export interface ExtensionRows {
	/** Editable scalar keys, payload order – `value` is the input's string
	 *  form (number/boolean via String, null as ""). */
	editable: { key: string; value: string }[];
	/** String-array (and, defensively, any other) values – read-only rows,
	 *  JSON.stringify'd for display. */
	readOnly: { key: string; value: string }[];
}

/**
 * Partition a doc payload's §4.1 extension keys (operator round C) for the
 * metadata editor's rows: scalars (string | number | boolean | null)
 * become editable `name: value` rows; string arrays and anything else the
 * server might pass render READ-ONLY – hand-editing complex YAML is
 * raw-file territory.
 * ponytail: no structured list editor for array-valued extension keys –
 * they display read-only; a chip editor can ride these rows if ever
 * wanted.
 */
export function extensionRows(fm: Record<string, unknown>): ExtensionRows {
	const rows: ExtensionRows = { editable: [], readOnly: [] };
	for (const [key, value] of Object.entries(fm)) {
		if (KNOWN_FRONTMATTER.has(key)) continue;
		if (
			value === null ||
			typeof value === "string" ||
			typeof value === "number" ||
			typeof value === "boolean"
		) {
			rows.editable.push({ key, value: value === null ? "" : String(value) });
		} else {
			rows.readOnly.push({ key, value: JSON.stringify(value) ?? "" });
		}
	}
	return rows;
}

/** One rendered `key: value` row of the metadata view block (operator
 *  round D). */
export interface MetaRow {
	key: string;
	value: string;
}

/** The metadata view block's rows (operator round D), one per key: the
 *  curated five (present keys only), the §4.1 extension keys
 *  (extensionRows' partition, values stringified), and the managed/derived
 *  family read-only with friendly formatting – generated → "actor · date",
 *  verified → "N events · latest by <actor> <date>",
 *  references/referenced-by → the path list. `fmt` renders the dates
 *  (tests inject a fixed one); absent keys render no row, the payload's
 *  omit-when-empty rule. */
export function metaViewRows(
	fm: Record<string, unknown>,
	fmt: (iso: string) => string = (iso) => new Date(iso).toLocaleString(),
): MetaRow[] {
	const rows: MetaRow[] = [];
	const scalar = (key: string) => {
		const v = fm[key];
		if (typeof v === "string" && v.trim() !== "") rows.push({ key, value: v });
	};
	scalar("type");
	scalar("description");
	const tags = Array.isArray(fm.tags)
		? fm.tags.filter((t): t is string => typeof t === "string" && t !== "")
		: [];
	if (tags.length > 0) rows.push({ key: "tags", value: tags.join(", ") });
	scalar("status");
	if (typeof fm.stale_after === "string" && fm.stale_after !== "")
		rows.push({ key: "stale_after", value: fmt(fm.stale_after) });
	const ext = extensionRows(fm);
	for (const r of [...ext.editable, ...ext.readOnly]) rows.push(r);
	const gen = fm.generated;
	if (typeof gen === "object" && gen !== null) {
		const by = (gen as { by?: unknown }).by;
		const at = (gen as { at?: unknown }).at;
		if (typeof by === "string")
			rows.push({
				key: "generated",
				value: typeof at === "string" && at !== "" ? `${by} · ${fmt(at)}` : by,
			});
	}
	const events = Array.isArray(fm.verified)
		? fm.verified.filter(
				(e): e is { by: string; at?: string } =>
					typeof e === "object" &&
					e !== null &&
					typeof (e as { by?: unknown }).by === "string",
			)
		: [];
	if (events.length > 0) {
		const latest = events[events.length - 1];
		const when =
			typeof latest.at === "string" && latest.at !== ""
				? ` ${fmt(latest.at)}`
				: "";
		rows.push({
			key: "verified",
			value: `${events.length} event${events.length === 1 ? "" : "s"} · latest by ${latest.by}${when}`,
		});
	}
	for (const key of ["references", "referenced-by"] as const) {
		const list = Array.isArray(fm[key])
			? fm[key].filter((p): p is string => typeof p === "string" && p !== "")
			: [];
		if (list.length > 0) rows.push({ key, value: list.join(", ") });
	}
	return rows;
}
