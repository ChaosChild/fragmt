import { expect, test } from "vitest";
import { rewriteMovedLinks } from "../src/core/link-rewrite.js";

// Move-time link rewriting (owner round): pure, so every style is pinned
// without a repo. `moves` maps old → new docsRoot-relative paths.

const moves = new Map([["guides/sync.md", "ops/sync-guide.md"]]);

test("a referrer's links to the moved doc follow it, in the author's style", () => {
	const body = [
		"Relative [s](../guides/sync.md), dotted [s](./../guides/sync.md),",
		"absolute [s](/guides/sync.md), with a fragment [s](../guides/sync.md#push).",
	].join("\n");
	expect(rewriteMovedLinks(body, "concepts/a.md", "concepts/a.md", moves)).toBe(
		[
			"Relative [s](../ops/sync-guide.md), dotted [s](../ops/sync-guide.md),",
			"absolute [s](/ops/sync-guide.md), with a fragment [s](../ops/sync-guide.md#push).",
		].join("\n"),
	);
});

test("same-folder relative links keep a leading ./ when the author used one", () => {
	const m = new Map([["guides/old.md", "guides/new.md"]]);
	expect(
		rewriteMovedLinks(
			"[a](./old.md) [b](old.md)",
			"guides/x.md",
			"guides/x.md",
			m,
		),
	).toBe("[a](./new.md) [b](new.md)");
});

test("the moved doc's own relative links re-aim from its new folder; absolute ones stay", () => {
	const body =
		"See [arch](../concepts/arch.md), [abs](/concepts/arch.md), [self](sync.md#top).";
	expect(
		rewriteMovedLinks(
			body,
			"guides/sync.md",
			"ops/deep/sync-guide.md",
			new Map([["guides/sync.md", "ops/deep/sync-guide.md"]]),
		),
	).toBe(
		"See [arch](../../concepts/arch.md), [abs](/concepts/arch.md), [self](sync-guide.md#top).",
	);
});

test("untouched: unrelated links, externals, anchors, images, fenced code, escapes", () => {
	const body = [
		"[other](../concepts/b.md) [web](https://x.dev/guides/sync.md) [here](#sync)",
		"![img](../guides/sync.md)",
		"```",
		"[code](../guides/sync.md)",
		"```",
		"[out](../../../guides/sync.md)",
	].join("\n");
	expect(rewriteMovedLinks(body, "concepts/a.md", "concepts/a.md", moves)).toBe(
		body,
	);
});

test("a folder move: links into it and its docs' links out both follow", () => {
	const m = new Map([
		["ref/api/a.md", "docs/api/a.md"],
		["ref/api/b.md", "docs/api/b.md"],
	]);
	// Inside the moved folder: sibling link unchanged, outward link re-aimed.
	expect(
		rewriteMovedLinks(
			"[b](b.md) [top](../../top.md)",
			"ref/api/a.md",
			"docs/api/a.md",
			m,
		),
	).toBe("[b](b.md) [top](../../top.md)");
	expect(
		rewriteMovedLinks(
			"[up](../guide.md)",
			"ref/api/a.md",
			"x/a.md",
			new Map([["ref/api/a.md", "x/a.md"]]),
		),
	).toBe("[up](../ref/guide.md)");
	// Outside: the link into the folder follows.
	expect(rewriteMovedLinks("[a](ref/api/a.md)", "top.md", "top.md", m)).toBe(
		"[a](docs/api/a.md)",
	);
});

test("root-level docs: a link from the root into a folder and back", () => {
	const m = new Map([["a.md", "sub/a.md"]]);
	expect(rewriteMovedLinks("[a](a.md)", "b.md", "b.md", m)).toBe(
		"[a](sub/a.md)",
	);
	expect(rewriteMovedLinks("[b](b.md)", "a.md", "sub/a.md", m)).toBe(
		"[b](../b.md)",
	);
});
