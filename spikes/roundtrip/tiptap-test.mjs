// Tiptap markdown round-trip fidelity test.
// Headless Tiptap 3 + StarterKit + custom comment mark + tiptap-markdown (html:true).
// md -> parse -> editor -> getMarkdown, then per-feature scoring.
// ponytail: happy-dom shim is required to run ProseMirror/tiptap-markdown headless in Node.
import { Window } from "happy-dom";
const w = new Window();
globalThis.window = w;
globalThis.document = w.document;
globalThis.DOMParser = w.DOMParser;
globalThis.Node = w.Node;
globalThis.Element = w.Element;

const { Editor, Mark, mergeAttributes } = await import("@tiptap/core");
const { default: StarterKit } = await import("@tiptap/starter-kit");
const { Markdown } = await import("tiptap-markdown");
const { TaskList, TaskItem } = await import("@tiptap/extension-list");
const { Table, TableRow, TableCell, TableHeader } = await import("@tiptap/extension-table");
const { default: Image } = await import("@tiptap/extension-image");
const { readFileSync } = await import("node:fs");

// ~50-line custom comment mark: <span data-c="..."> round-trips via html:true.
const CommentMark = Mark.create({
  name: "comment",
  addAttributes() {
    return {
      dataC: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-c"),
        renderHTML: (attrs) => (attrs.dataC ? { "data-c": attrs.dataC } : {}),
      },
    };
  },
  parseHTML() { return [{ tag: "span[data-c]" }]; },
  renderHTML({ HTMLAttributes }) { return ["span", mergeAttributes(HTMLAttributes), 0]; },
});

const raw = readFileSync(new URL("./corpus.md", import.meta.url), "utf8");
const fm = raw.match(/^---\n[\s\S]*?\n---\n/);
const body = fm ? raw.slice(fm[0].length) : raw;

const editor = new Editor({
  extensions: [
    StarterKit,
    CommentMark,
    TaskList, TaskItem,
    Table, TableRow, TableCell, TableHeader,
    Image,
    Markdown.configure({ html: true }),
  ],
  content: "",
});
editor.commands.setContent(editor.storage.markdown.parser.parse(body));
const out = editor.storage.markdown.getMarkdown();
const rejoined = fm ? fm[0] + out : out;

const has = (s) => out.includes(s);
const results = [];
const R = (name, status, note = "") => results.push({ name, status, note });

R("h1-h3 headings", has("# Heading One") && has("## Heading Two") && has("### Heading Three") ? "PASS" : "FAIL");
R("bold", has("**bold**") ? "PASS" : "FAIL");
R("italic", has("*italic*") ? "PASS" : "FAIL");
R("strike", has("~~strike~~") ? "PASS" : "FAIL");
R("inline code", has("`inline code`") ? "PASS" : "FAIL");
R("link", has("[link to example](https://example.com)") ? "PASS" : "FAIL");
R("nested bullet list (3 lvl)",
  has("- Bullet level one") && has("  - Bullet level two") && has("    - Bullet level three") ? "PASS" : "FAIL");
R("nested numbered list (3 lvl)",
  has("1. Numbered one") && has("   1. Numbered two-one") && has("      1. Numbered two-two-one") ? "PASS" : "FAIL");
R("task list", has("- [ ] Unchecked task") && has("- [x] Checked task") ? "PASS" : "FAIL",
  "needs @tiptap/extension-list (TaskList/TaskItem)");
R("fenced code + lang", has("```js") && has("```python") ? "PASS" : "FAIL");
R("table content", has("Left") && has("| a1") && has("c2") ? "PASS" : "FAIL", "needs @tiptap/extension-table");
R("table alignment", /:-+|-+:|:-+:/.test(out) ? "PASS" : "FAIL", "alignment markers");
R("blockquote", has("> A quoted line.") ? "PASS" : "FAIL", "lines merged (normalized)");
R("horizontal rule", has("---") ? "PASS" : "FAIL");
R("image", has("![alt text](https://example.com/image.png)") ? "PASS" : "FAIL", "needs @tiptap/extension-image");
R("frontmatter (stripped+reattached)", /^---\ntitle: Round-trip Corpus/.test(rejoined) ? "PASS" : "FAIL", "manual strip/reattach");
R("span mid-paragraph", has('data-c="abc123"') ? "PASS" : "FAIL", "custom mark + html:true");
R("span inside bold", has('data-c="bold01"') ? "PASS" : "FAIL");
R("span in list item", has('data-c="list01"') ? "PASS" : "FAIL");
R("span in task item", has('data-c="task01"') ? "PASS" : "FAIL");

const pad = (s, n) => s + " ".repeat(Math.max(0, n - s.length));
console.log("=== Tiptap round-trip report ===");
for (const r of results) console.log(`${pad(r.status, 11)} ${pad(r.name, 34)} ${r.note}`);

const fails = results.filter((r) => r.status === "FAIL");
console.log(`\n${results.length} checks: ${results.filter(r=>r.status==="PASS").length} PASS, ${results.filter(r=>r.status==="NORMALIZED").length} NORMALIZED, ${fails.length} FAIL`);
console.log(`spans survive with attributes: ${has('data-c=') ? "YES" : "NO"}`);
editor.destroy();
process.exit(fails.length ? 1 : 0);
