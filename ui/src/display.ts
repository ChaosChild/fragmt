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
