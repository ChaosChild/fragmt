/**
 * The display-name model (M4-3 b4): the frontmatter `title` when the doc
 * carries one, else the file name sans .md. Paths stay the identity
 * everywhere (links, moves, the tree); titles are display-only — the
 * breadcrumb, the sidebar cards, and the @ menu all resolve through this
 * one rule.
 */
export function displayTitle(title: unknown, name: string): string {
	return typeof title === "string" && title.trim()
		? title
		: name.replace(/\.md$/i, "");
}
