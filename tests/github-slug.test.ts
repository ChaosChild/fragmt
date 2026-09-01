import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { githubSlug, parseGithubSlug } from "../src/core/git.js";

// #20 batch 1: the origin remote's github.com slug – the pure parser first,
// then the one-git-read wrapper against tmp repos (git.test.ts pattern).

test("parseGithubSlug: https with and without .git", () => {
	expect(parseGithubSlug("https://github.com/acme/docs.git")).toEqual({
		owner: "acme",
		repo: "docs",
	});
	expect(parseGithubSlug("https://github.com/acme/docs")).toEqual({
		owner: "acme",
		repo: "docs",
	});
});

test("parseGithubSlug: ssh and git:// forms", () => {
	expect(parseGithubSlug("git@github.com:acme/docs.git")).toEqual({
		owner: "acme",
		repo: "docs",
	});
	expect(parseGithubSlug("git://github.com/acme/docs.git")).toEqual({
		owner: "acme",
		repo: "docs",
	});
});

test("parseGithubSlug: anything non-github is undefined", () => {
	expect(parseGithubSlug("https://gitlab.com/acme/docs.git")).toBeUndefined();
	expect(parseGithubSlug("git@gitlab.com:acme/docs.git")).toBeUndefined();
	expect(parseGithubSlug("/srv/git/docs")).toBeUndefined();
	expect(parseGithubSlug("")).toBeUndefined();
});

/** Throwaway repo with an optional origin (no commits needed for remotes). */
function gitRepo(origin?: string): string {
	const root = mkdtempSync(join(tmpdir(), "fragmt-slug-"));
	const git = (args: string[]) => execFileSync("git", args, { cwd: root });
	git(["init", "-q", "-b", "main"]);
	if (origin) git(["remote", "add", "origin", origin]);
	repos.push(root);
	return root;
}

const repos: string[] = [];

afterEach(() => {
	for (const r of repos.splice(0)) rmSync(r, { recursive: true, force: true });
});

test("githubSlug: reads the origin remote", async () => {
	expect(await githubSlug(gitRepo("git@github.com:acme/docs.git"))).toEqual({
		owner: "acme",
		repo: "docs",
	});
});

test("githubSlug: missing origin or a non-github origin → undefined", async () => {
	expect(await githubSlug(gitRepo())).toBeUndefined();
	expect(
		await githubSlug(gitRepo("https://gitlab.com/acme/docs.git")),
	).toBeUndefined();
});
