import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The managed block's fences (v1 — a future copy bump moves the version). */
export const AGENTS_BEGIN = "<!-- fragmt:begin v1 -->";
export const AGENTS_END = "<!-- fragmt:end -->";

/** The agent rules (M4-4 b5, approved copy): protected main, tool-owned
 *  sidecars, always --author, state via `fragmt agent status`. */
export const AGENTS_BODY = `## fragmt — docs environment for this repo
These docs are maintained through fragmt (git-native drafting).
Rules for agents:
- NEVER edit docs on main directly — main is protected. Run \`fragmt agent draft <doc>\` first; merge when done.
- NEVER hand-edit \`.docs/comments/*.json\` sidecars — use \`fragmt agent comment\`.
- ALWAYS pass \`--author "Your Name <you@example.invalid>"\` so your work is attributable.
- State check: \`fragmt agent status\`. Doc bodies are plain markdown — read them directly.
- New anchored comment threads are a UI act (they need a text selection); reply and resolve via the CLI.
`;

/**
 * Write/refresh the managed block in the repo root's AGENTS.md: no file →
 * create it holding only the block; file without the markers → append the
 * block after a blank line; markers present → replace exactly between them
 * (a re-run of `fragmt init` refreshes to the current copy). NOTHING
 * outside the markers is ever touched — the rest of the file belongs to
 * the repo.
 */
export function writeAgentsBlock(repoRoot: string): void {
	const file = join(repoRoot, "AGENTS.md");
	const block = `${AGENTS_BEGIN}\n${AGENTS_BODY}${AGENTS_END}`;
	if (!existsSync(file)) {
		writeFileSync(file, `${block}\n`);
		return;
	}
	const text = readFileSync(file, "utf8");
	const begin = text.indexOf(AGENTS_BEGIN);
	const end = text.indexOf(AGENTS_END);
	if (begin >= 0 && end > begin) {
		writeFileSync(
			file,
			text.slice(0, begin) + block + text.slice(end + AGENTS_END.length),
		);
		return;
	}
	const base = text.endsWith("\n") ? text : `${text}\n`;
	writeFileSync(file, `${base}\n${block}\n`);
}
