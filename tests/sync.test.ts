import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, test } from "vitest";
import {
	GitError,
	githubPushUrl,
	pushRefs,
	scrubSecret,
	sync,
} from "../src/core/index.js";

// sync = pullRebase then a mirror push (--all, #27), against a bare origin
// and real clones. Per-user pushes ride pushRefs (explicit URL + token env).
// core.autocrlf is pinned false so byte-exact file assertions hold on Windows.

const dirs: string[] = [];

afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function run(cwd: string, args: string[]): void {
	execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
}

/**
 * Clone with autocrlf disabled for the invocation – with the global
 * autocrlf=true on this machine the initial checkout would be CRLF against an
 * LF index, and every later pull/rebase would die on phantom "unstaged
 * changes". The repo-local config below covers later checkouts.
 */
function cloneInto(src: string, dst: string): void {
	execFileSync("git", ["-c", "core.autocrlf=false", "clone", "-q", src, "."], {
		cwd: dst,
		stdio: ["ignore", "pipe", "pipe"],
	});
}

/** Fresh dir with an identity; autocrlf off keeps checkouts byte-stable. */
function repo(prefix: string): string {
	const root = mkdtempSync(join(tmpdir(), prefix));
	run(root, ["init", "-q", "-b", "main"]);
	run(root, ["config", "user.name", "Sync Test"]);
	run(root, ["config", "user.email", "sync@example.com"]);
	run(root, ["config", "core.autocrlf", "false"]);
	return root;
}

/**
 * A bare origin plus two clones sharing one seed commit. Clone A has pushed
 * the seed (so both track origin/main); nothing else has happened yet.
 */
function originAndClones(): { origin: string; a: string; b: string } {
	const origin = mkdtempSync(join(tmpdir(), "fragmt-origin-"));
	run(origin, ["init", "-q", "--bare", "-b", "main"]);
	dirs.push(origin);

	const a = mkdtempSync(join(tmpdir(), "fragmt-clone-a-"));
	cloneInto(origin, a);
	run(a, ["config", "user.name", "A"]);
	run(a, ["config", "user.email", "a@example.com"]);
	run(a, ["config", "core.autocrlf", "false"]);
	writeFileSync(join(a, "f.md"), "seed\n");
	run(a, ["add", "-A"]);
	run(a, ["commit", "-q", "-m", "seed"]);
	run(a, ["push", "-q", "-u", "origin", "main"]);

	const b = mkdtempSync(join(tmpdir(), "fragmt-clone-b-"));
	cloneInto(origin, b);
	run(b, ["config", "user.name", "B"]);
	run(b, ["config", "user.email", "b@example.com"]);
	run(b, ["config", "core.autocrlf", "false"]);

	dirs.push(a, b);
	return { origin, a, b };
}

function commitFile(root: string, name: string, body: string, message: string) {
	writeFileSync(join(root, name), body);
	run(root, ["add", "-A"]);
	run(root, ["commit", "-q", "-m", message]);
}

/**
 * A bare origin plus one work repo: main pushed (tracking set) and a second
 * branch `topic` with its own commit. Base for the pushRefs/sync mirror tests.
 */
function bareAndWork(): { origin: string; work: string } {
	const origin = mkdtempSync(join(tmpdir(), "fragmt-origin-"));
	run(origin, ["init", "-q", "--bare", "-b", "main"]);
	dirs.push(origin);

	const work = repo("fragmt-work-");
	run(work, ["remote", "add", "origin", origin]);
	commitFile(work, "f.md", "seed\n", "seed");
	run(work, ["push", "-q", "-u", "origin", "main"]);
	run(work, ["checkout", "-q", "-b", "topic"]);
	commitFile(work, "t.md", "topic\n", "topic work");
	run(work, ["checkout", "-q", "main"]);
	dirs.push(work);
	return { origin, work };
}

const branches = (root: string) =>
	execFileSync(
		"git",
		["for-each-ref", "refs/heads", "--format=%(refname:short)"],
		{ cwd: root, encoding: "utf8" },
	)
		.trim()
		.split("\n")
		.filter(Boolean);

const head = (root: string) =>
	execFileSync("git", ["rev-parse", "HEAD"], {
		cwd: root,
		encoding: "utf8",
	}).trim();

const status = (root: string) =>
	execFileSync("git", ["status", "--porcelain"], {
		cwd: root,
		encoding: "utf8",
	}).trim();

/** Both rebase state dirs must be gone – no rebase left in progress. */
const rebaseInProgress = (root: string) =>
	existsSync(join(root, ".git", "rebase-merge")) ||
	existsSync(join(root, ".git", "rebase-apply"));

// 20s timeouts: every test here spawns real git clones/fetches, and under the
// full suite's parallel load on Windows the spawns alone can breach the 5s
// default (flake seen on main before M4-3).
test("clean sync: A pushes via sync, B pulls via sync and sees the file", {
	timeout: 20_000,
}, async () => {
	const { origin, a, b } = originAndClones();
	commitFile(a, "new.md", "# from A\n", "A adds new.md");

	expect(await sync(a)).toEqual({ conflict: false });
	expect(await sync(b)).toEqual({ conflict: false });

	expect(readFileSync(join(b, "new.md"), "utf8")).toBe("# from A\n");
	expect(status(b)).toBe("");
	// The push really landed on the origin.
	const originHead = execFileSync(
		"git",
		["show-ref", "--hash", "refs/heads/main"],
		{ cwd: origin, encoding: "utf8" },
	).trim();
	expect(originHead).toBe(head(b));
});

test("conflict: B's divergent commit aborts the rebase and leaves B untouched", {
	timeout: 20_000,
}, async () => {
	const { a, b } = originAndClones();
	commitFile(a, "f.md", "A edit\n", "A edits f");
	expect(await sync(a)).toEqual({ conflict: false });

	commitFile(b, "f.md", "B edit\n", "B edits f");
	const preHead = head(b);

	const result = await sync(b);
	expect(result.conflict).toBe(true);
	expect(result.message).toContain("f.md");

	// Rebase aborted: HEAD, file bytes, and status all back to B's pre-sync
	// state; no rebase dir remains.
	expect(head(b)).toBe(preHead);
	expect(readFileSync(join(b, "f.md"), "utf8")).toBe("B edit\n");
	expect(status(b)).toBe("");
	expect(rebaseInProgress(b)).toBe(false);
	// Origin still holds A's side – B never force-pushed over it.
	const originMain = execFileSync("git", ["rev-parse", "origin/main"], {
		cwd: a,
		encoding: "utf8",
	}).trim();
	expect(originMain).toBe(head(a));
});

test("a repo with no remote syncs as a no-op success", {
	timeout: 20_000,
}, async () => {
	const root = repo("fragmt-local-");
	dirs.push(root);
	commitFile(root, "solo.md", "# solo\n", "solo");
	const preHead = head(root);

	expect(await sync(root)).toEqual({ conflict: false });
	expect(head(root)).toBe(preHead);
	expect(status(root)).toBe("");
});

test("a remote without upstream tracking: pull no-ops, sync still succeeds", {
	timeout: 20_000,
}, async () => {
	const { b } = originAndClones();
	run(b, ["branch", "--unset-upstream"]);
	const preHead = head(b);

	// No tracking → the rebase pull is skipped; the mirror push finds b's
	// branches already at origin's tips, so nothing moves.
	expect(await sync(b)).toEqual({ conflict: false });
	expect(head(b)).toBe(preHead);
	expect(status(b)).toBe("");
});

test("githubPushUrl: https, owner, repo, .git suffix", () => {
	expect(githubPushUrl({ owner: "acme", repo: "fragmt" })).toBe(
		"https://github.com/acme/fragmt.git",
	);
});

test("scrubSecret: every GitError field loses the credential", () => {
	const secret = Buffer.from("x-access-token:faketoken").toString("base64");
	const e = new GitError(
		`git push failed: ${secret}`,
		128,
		`fatal: ${secret}`,
		`remote: ${secret}`,
	);
	const clean = scrubSecret(e, secret);
	expect(clean.message).toBe("git push failed: <redacted>");
	expect(clean.stderr).toBe("fatal: <redacted>");
	expect(clean.stdout).toBe("remote: <redacted>");
	expect(clean.exitCode).toBe(128);
	expect(`${clean.message}${clean.stderr}${clean.stdout}`).not.toContain(
		secret,
	);
});

test("pushRefs: refspec + explicit URL mechanics over file:// (extraheader inert there)", {
	timeout: 20_000,
}, async () => {
	const { origin, work } = bareAndWork();
	await pushRefs(
		work,
		pathToFileURL(origin).href,
		["topic:refs/heads/topic"],
		"faketoken",
	);
	expect(branches(origin)).toContain("topic");
});

test("pushRefs with --all mirrors every branch", {
	timeout: 20_000,
}, async () => {
	const { origin, work } = bareAndWork();
	await pushRefs(work, pathToFileURL(origin).href, ["--all"], "faketoken");
	expect(branches(origin)).toEqual(["main", "topic"]);
});

test("sync() mirrors every branch to origin (no `as`)", {
	timeout: 20_000,
}, async () => {
	const { origin, work } = bareAndWork();
	expect(await sync(work)).toEqual({ conflict: false });
	expect(branches(origin)).toEqual(["main", "topic"]);
});
