import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The managed block's fences (v1 – a future copy bump moves the version). */
export const AGENTS_BEGIN = "<!-- fragmt:begin v1 -->";
export const AGENTS_END = "<!-- fragmt:end -->";

/** The agent rules (M4-4 b5, approved copy): protected main, tool-owned
 *  sidecars, always --author, state via `fragmt agent status`. */
export const AGENTS_BODY = `## fragmt – docs environment for this repo
These docs are maintained through fragmt (git-native drafting).
Rules for agents:
- NEVER edit docs on main directly – main is protected. Run \`fragmt agent draft <doc>\` first; merge when done.
- NEVER hand-edit \`.docs/comments/*.json\` sidecars – use \`fragmt agent comment\`.
- ALWAYS pass \`--author "Your Name <you@example.invalid>"\` so your work is attributable.
- State check: \`fragmt agent status\`. Doc bodies are plain markdown – read them directly.
- New anchored comment threads are a UI act (they need a text selection); reply and resolve via the CLI.
`;

/**
 * The outer repo's redirect block (#16): same fences as the standard block,
 * so re-running the nested-init (or a later copy bump) replaces in place.
 */
export function AGENTS_OUTER_BODY(folder: string): string {
	return `## fragmt – docs live in the nested repo at ${folder}/
Do NOT edit docs in this repo. \`cd ${folder}\` and follow the AGENTS.md there; fragmt commands run from that root.
`;
}

/**
 * Shared marker-splice (b5 discipline): write/refresh a managed block in an
 * AGENTS.md. No file → create it holding only the block; file without the
 * markers → append the block after a blank line; markers present → replace
 * exactly between them. NOTHING outside the markers is ever touched – the
 * rest of the file belongs to the repo.
 */
function spliceBlock(file: string, body: string): void {
	const block = `${AGENTS_BEGIN}\n${body}${AGENTS_END}`;
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

/**
 * Write/refresh the standard managed block in the repo root's AGENTS.md (a
 * re-run of `fragmt init` refreshes to the current copy).
 */
export function writeAgentsBlock(repoRoot: string): void {
	spliceBlock(join(repoRoot, "AGENTS.md"), AGENTS_BODY);
}

/**
 * Write/refresh the outer repo's redirect block (#16): the nested-init's
 * second call – replaces the standard block the plain init left there.
 */
export function writeOuterAgentsBlock(outerRoot: string, folder: string): void {
	spliceBlock(join(outerRoot, "AGENTS.md"), AGENTS_OUTER_BODY(folder));
}
