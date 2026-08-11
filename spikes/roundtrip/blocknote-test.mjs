// BlockNote markdown round-trip fidelity test.
// md -> tryParseMarkdownToBlocks -> blocksToMarkdownLossy, then per-feature scoring.
// ponytail: plain checks against the output string, no test framework.
import { ServerBlockNoteEditor } from "@blocknote/server-util";
import { readFileSync } from "node:fs";

const raw = readFileSync(new URL("./corpus.md", import.meta.url), "utf8");
const fm = raw.match(/^---\n[\s\S]*?\n---\n/);
const body = fm ? raw.slice(fm[0].length) : raw;

const editor = ServerBlockNoteEditor.create();
const blocks = await editor.tryParseMarkdownToBlocks(body);
const out = await editor.blocksToMarkdownLossy(blocks);
// Re-attach frontmatter (the storage layer would do this).
const rejoined = fm ? fm[0] + out : out;

// What happens if frontmatter is NOT stripped:
const noStripBlocks = await editor.tryParseMarkdownToBlocks(raw);
const noStripOut = await editor.blocksToMarkdownLossy(noStripBlocks);
const fmSurvivesUnstripped = /^---\n[\s\S]*?\n---/.test(noStripOut.trim());

const has = (s) => out.includes(s);
const results = [];
// name, status (PASS|NORMALIZED|FAIL), note
const R = (name, status, note = "") => results.push({ name, status, note });

R("h1-h3 headings", has("# Heading One") && has("## Heading Two") && has("### Heading Three") ? "PASS" : "FAIL");
R("bold", has("**bold**") ? "PASS" : "FAIL");
R("italic", has("*italic*") ? "PASS" : "FAIL");
R("strike", has("~~strike~~") ? "PASS" : "FAIL");
R("inline code", has("`inline code`") ? "PASS" : "FAIL");
R("link", has("[link to example](https://example.com)") ? "PASS" : "FAIL");
R("nested bullet list (3 lvl)",
  has("* Bullet level one") && has("  * Bullet level two") && has("    * Bullet level three") ? "NORMALIZED" : "FAIL",
  "marker - -> *");
R("nested numbered list (3 lvl)",
  has("1. Numbered one") && has("   1. Numbered two-one") && has("      1. Numbered two-two-one") ? "PASS" : "FAIL");
R("task list",
  has("* [ ] Unchecked task") && has("* [x] Checked task") ? "NORMALIZED" : "FAIL",
  "marker - -> *, checkbox state kept");
R("fenced code + lang", has("```js") && has("```python") ? "PASS" : "FAIL");
R("table content", has("| a1") && has("| b1") && has("| c1") ? "PASS" : "FAIL");
R("table alignment", /:-+|-+:|:-+:/.test(out) ? "PASS" : "FAIL", "alignment markers dropped -> all default");
R("blockquote", has("> A quoted line.") ? "PASS" : "FAIL");
R("horizontal rule", has("---") ? "PASS" : (has("***") ? "NORMALIZED" : "FAIL"), "--- -> ***");
R("image", has("![alt text](https://example.com/image.png)") ? "PASS" : "FAIL");
R("frontmatter (stripped+reattached)", /^---\ntitle: Round-trip Corpus/.test(rejoined) ? "PASS" : "FAIL", "requires manual strip/reattach");
R("frontmatter (NOT stripped)", fmSurvivesUnstripped ? "PASS" : "FAIL", "fence mangled into thematic break + heading");
R("span mid-paragraph", has('data-c="abc123"') ? "PASS" : "FAIL", "tag stripped, text kept");
R("span inside bold", has('data-c="bold01"') ? "PASS" : "FAIL", "tag stripped, text kept");
R("span in list item", has('data-c="list01"') ? "PASS" : "FAIL", "tag stripped, text kept");

const pad = (s, n) => s + " ".repeat(Math.max(0, n - s.length));
console.log("=== BlockNote round-trip report ===");
for (const r of results) console.log(`${pad(r.status, 11)} ${pad(r.name, 34)} ${r.note}`);

const fails = results.filter((r) => r.status === "FAIL");
console.log(`\n${results.length} checks: ${results.filter(r=>r.status==="PASS").length} PASS, ${results.filter(r=>r.status==="NORMALIZED").length} NORMALIZED, ${fails.length} FAIL`);
console.log(`spans survive with attributes: ${has('data-c=') ? "YES" : "NO"}`);
process.exit(fails.length ? 1 : 0);
