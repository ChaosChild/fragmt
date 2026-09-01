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
		/^(\d+\+)?([a-z0-9-]+)@users\.noreply\.github\.com$/i.exec(email)?.[2] ||
		undefined
	);
}
