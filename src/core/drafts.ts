/**
 * Draft naming (M4-2 spec): `drafts/<slug>` where slug = basename minus .md,
 * lowercased, every non-[a-z0-9] char → "-", edges trimmed. Collisions with
 * existing branch names append -2, -3, …
 */
export function nextDraftName(existing: string[], docPath: string): string {
	const slug = (docPath.split("/").pop() ?? "")
		.replace(/\.md$/i, "")
		.toLowerCase()
		.replace(/[^a-z0-9]/g, "-")
		.replace(/^-+|-+$/g, "");
	if (!existing.includes(`drafts/${slug}`)) return `drafts/${slug}`;
	let n = 2;
	while (existing.includes(`drafts/${slug}-${n}`)) n++;
	return `drafts/${slug}-${n}`;
}
