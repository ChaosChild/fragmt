/**
 * The CLI side of the avatar model (rung B): which commit authors have no
 * avatar path. Core cannot import ui, so the noreply regex below deliberately
 * duplicates ui/src/display.ts avatarUser()'s regex – keep the two in sync.
 */
const GITHUB_NOREPLY = /^(\d+\+)?([a-z0-9-]+)@users\.noreply\.github\.com$/i;

/**
 * Bucket unique emails: `mapped` (a config authors entry), `noreply` (either
 * GitHub noreply shape – `123456+login@` or `login@`, both resolve a login
 * keylessly), `unresolvable` (a plain git email with no map entry – the UI
 * falls back to initials, the CLI prints authorsNotice).
 */
export function classifyAuthorEmails(
	emails: string[],
	authors: Record<string, string>,
): { mapped: string[]; noreply: string[]; unresolvable: string[] } {
	const mapped: string[] = [];
	const noreply: string[] = [];
	const unresolvable: string[] = [];
	for (const email of new Set(emails)) {
		if (authors[email]) mapped.push(email);
		// Mirrors ui/src/display.ts avatarUser()'s regex – keep the two in sync.
		else if (GITHUB_NOREPLY.test(email)) noreply.push(email);
		else unresolvable.push(email);
	}
	return { mapped, noreply, unresolvable };
}

/**
 * The notice for unresolvable authors (printed by init and local serve):
 * null when there is nothing to say, else the count, the email list capped
 * at 3 visible + "+N more", and the config snippet fixing the first one.
 */
export function authorsNotice(unresolvable: string[]): string | null {
	if (unresolvable.length === 0) return null;
	const visible = unresolvable.slice(0, 3).join(", ");
	const more = unresolvable.length - 3;
	const list = more > 0 ? `${visible} +${more} more` : visible;
	return (
		`⚠ ${unresolvable.length} commit author(s) have no avatar path:\n` +
		`  ${list}\n` +
		`  add to .fragmt.json:  "authors": { "${unresolvable[0]}": "login" }\n`
	);
}
