# Security Review: fragmt

**Date:** 2026-09-22  
**Target:** fragmt (Git-native documentation environment)  
**Version Reviewed:** 0.10.0  
**Repository:** `ChaosChild/fragmt`  
**Review Type:** Static Source Code & Architecture Security Analysis  

---

## Executive Summary

A comprehensive security analysis of the `fragmt` codebase was performed across core libraries (`src/core/`), CLI commands (`src/cli/`), the HTTP API server (`src/server/`), and the web UI editor (`ui/src/`).

`fragmt` operates under two distinct deployment modes:
1. **Single-User / Local Mode (`fragmt serve`):** Binds to `127.0.0.1` with no authentication, relying on local machine trust and local git configuration.
2. **Multi-User Hosted Mode (`fragmt serve --auth --port <n>`):** Binds to `0.0.0.0` (all interfaces), authenticates users via GitHub OAuth (authorization-code web flow), and gates access using GitHub repository collaborator permissions evaluated with the signed-in user's token.

While the codebase maintains good hygiene around subprocess execution (using `node:child_process.execFile` without a shell) and constant-time comparison for OAuth state tokens, multiple significant vulnerabilities and architectural weaknesses were identified. The primary risks stem from path containment assumptions when `docsRoot` is the repository root (`.`), missing security controls in the authentication/session layer, absence of CSRF protection, and concurrency conflicts on a shared git worktree.

---

## Summary of Findings

| ID | Title | File & Line(s) | Severity | Category |
|---|---|---|---|---|
| **SEC-01** | Arbitrary File Read of Git & Repository Secrets via `/api/raw/*` | `src/server/index.ts:651-675`, `src/core/docs.ts:66-83` | **High** | Path Traversal / Information Disclosure |
| **SEC-02** | Arbitrary Directory Deletion and Renaming via `/api/folders/*` | `src/server/index.ts:589-625`, `src/core/files.ts:310-395` | **High** | Improper Access Control / Data Loss |
| **SEC-03** | Missing `Secure` Flag on Session Cookies in Production HTTPS | `src/server/auth.ts:304-312` | **Medium** | Insecure Session Management |
| **SEC-04** | Authorization Bypass on Non-GitHub Remote Repositories (`failClosed` Logic Flaw) | `src/server/auth.ts:126-128`, `src/server/auth.ts:174-175` | **Medium** | Broken Access Control |
| **SEC-05** | Lack of CSRF Protections on Mutating API Endpoints | `src/server/index.ts:127-142`, `src/server/auth.ts:307-310` | **Medium** | Cross-Site Request Forgery (CSRF) |
| **SEC-06** | Unsanitized External URL Execution (Untrusted Scheme Injection via `window.open`) | `ui/src/editor/links.ts:79-81`, `ui/src/EditorPane.tsx:349-352` | **Medium** | Cross-Site Scripting (XSS) / Protocol Injection |
| **SEC-07** | Denial of Service & Memory Exhaustion via Synchronous Bundle Export | `src/core/zip.ts:125-151`, `src/server/index.ts:814-826` | **Medium** | Denial of Service (Resource Exhaustion) |
| **SEC-08** | Excessive GitHub OAuth Scope Request (`repo` Scope) | `src/server/auth.ts:219` | **Medium** | Principle of Least Privilege Violation |
| **SEC-09** | Concurrency Race Conditions and Shared Worktree Interference | `src/server/index.ts:718-731`, `src/core/git.ts:90-95` | **Medium** | Concurrency / Data Integrity |
| **SEC-10** | Missing HTTP Security Headers (Clickjacking & MIME-Sniffing Risks) | `src/server/index.ts:127-163` | **Low** | Security Misconfiguration |
| **SEC-11** | Host Header Poisoning in OAuth Callback URL Generation | `src/server/auth.ts:208-210`, `src/server/auth.ts:248` | **Low** | Insecure Configuration / Spoofing |
| **SEC-12** | Information Disclosure of Contributor Email Addresses via `/api/meta` | `src/server/auth.ts:65`, `src/server/index.ts:767-775` | **Low** | Information Disclosure |
| **SEC-13** | Unvalidated Git Revision Parameter in `restoreDoc` | `src/server/index.ts:970-988`, `src/core/drafts.ts:450-466` | **Low** | Input Validation |
| **SEC-14** | Unsafe Branch Mirroring via `/api/sync` (`pushRefs --all`) | `src/core/sync.ts:119-129`, `src/server/index.ts:990-1005` | **Medium** | Broken Access Control / Data Exposure |
| **SEC-15** | Unchecked Force Branch Deletion Flag in `/api/branches/:name` | `src/server/index.ts:743-747`, `src/core/git.ts:122-126` | **Low** | Improper Access Control / Data Loss |

---

## Detailed Findings

### SEC-01: Arbitrary File Read of Git & Repository Secrets via `/api/raw/*`
- **File:** `src/server/index.ts` (Lines 651–675) & `src/core/docs.ts` (Lines 66–83)
- **Severity:** High
- **Category:** Path Traversal / Information Disclosure
- **Why It Matters:**
  The `resolveDocPath` function validates that requested paths reside within `docsRoot`. When `docsRoot` is configured as `.` (the repository root, which is standard when initializing a docs repository at repo root as in `.fragmt.json`), `docsAbs` equals `repoRoot`.
  
  For `kind: "raw"`, `resolveDocPath` enforces no file extension restrictions:
  ```ts
  // src/core/docs.ts:71-82
  const docsAbs = resolve(repoRoot, docsRoot);
  const target = resolve(docsAbs, docPath);
  const rel = relative(docsAbs, target);
  const firstSegment = rel.split(sep)[0];
  if (rel === "" || firstSegment === ".." || isAbsolute(rel)) {
      throw new DocPathError(`invalid doc path: ${docPath}`);
  }
  if (kind === "doc" && !target.toLowerCase().endsWith(".md")) {
      throw new DocPathError(`invalid doc path: ${docPath}`);
  }
  return target;
  ```
  Consequently, any file within `repoRoot` can be requested through `GET /api/raw/*`. An authenticated user in `--auth` mode (or any network client in single-user mode) can retrieve:
  - `.git/config` (exposing remote URLs, private credentials, or push URLs)
  - `.git/HEAD`, `.git/FETCH_HEAD`, and raw `.git/objects/` (permitting offline reconstruction of full repository history, commit histories, and uncommitted or deleted files)
  - `.env` (exposing `GH_CLIENT_ID`, `GH_CLIENT_SECRET`, or deployment secrets)
  - `.fragmt.json`, `package.json`, and backend source code files

- **Recommendation:**
  In `resolveDocPath` (or specifically within `/api/raw/*`), enforce a strict blocklist for hidden directories/files (paths or segments starting with `.`, such as `.git`, `.env`), and restrict raw asset serving to a dedicated subfolder or allowlisted static file extensions.

---

### SEC-02: Arbitrary Directory Deletion and Renaming via `/api/folders/*`
- **File:** `src/server/index.ts` (Lines 589–625) & `src/core/files.ts` (Lines 310–395)
- **Severity:** High
- **Category:** Improper Access Control / Data Loss
- **Why It Matters:**
  The folder deletion and renaming endpoints (`DELETE /api/folders/*` and `PATCH /api/folders/*`) resolve the requested path using `resolveDocPath(..., kind="folder")`. Because `kind="folder"` does not require a `.md` extension, and when `docsRoot` is `.`, any directory in the repository can be targeted.
  
  In `src/core/files.ts:384`:
  ```ts
  rmSync(abs, { recursive: true });
  ```
  A user with write access (or anyone if auth is disabled or bypassed) can issue:
  - `DELETE /api/folders/.git` to completely destroy the repository's git database.
  - `DELETE /api/folders/src` to delete the application's source code.
  - `DELETE /api/folders/node_modules` to eliminate dependencies, crashing the server.
  - `PATCH /api/folders/*` to move or rename internal directories.

- **Recommendation:**
  Prevent folder operations on protected repository directories (e.g., `.git`, `src`, `node_modules`, `dist`, `.docs`, `.github`). When `docsRoot` is `.`, operations should only permit folders containing documentation.

---

### SEC-03: Missing `Secure` Flag on Session Cookies in Production HTTPS
- **File:** `src/server/auth.ts` (Lines 304–312)
- **Severity:** Medium
- **Category:** Insecure Session Management
- **Why It Matters:**
  In `src/server/auth.ts`, the session cookie `fragmt_session` is configured with `httpOnly: true` and `sameSite: "Lax"`, but the `secure` flag is explicitly omitted:
  ```ts
  // Secure is deliberately NOT set: serve --auth runs on plain http on the
  // LAN and behind reverse proxies that terminate TLS (HOSTING doc); set it
  // when serving https directly instead.
  setCookie(c, SESSION_COOKIE, id, {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      maxAge: SESSION_TTL_SEC,
  });
  ```
  The documentation (`docs/HOSTING.md`) recommends reverse proxies terminating TLS (nginx, Caddy). Because the cookie lacks the `Secure` attribute, browsers will transmit `fragmt_session` over unencrypted HTTP (for instance, if a user accesses the site via `http://` prior to redirect, or on local/LAN networks).
  
  An eavesdropper on the network can capture the session token, hijack the user's active session, and issue requests on behalf of the user—including invoking PR creation, branch merging, doc mutations, and utilizing the user's embedded GitHub OAuth token.

- **Recommendation:**
  Dynamically set `secure: true` based on `c.req.header("x-forwarded-proto") === "https"` or `new URL(c.req.url).protocol === "https:"`, or support a configurable `COOKIE_SECURE=true` environment setting.

---

### SEC-04: Authorization Bypass on Non-GitHub Remote Repositories (`failClosed` Logic Flaw)
- **File:** `src/server/auth.ts` (Lines 126–128 & Lines 174–175)
- **Severity:** Medium
- **Category:** Broken Access Control
- **Why It Matters:**
  When `fragmt serve --auth` is executed, the permission gate checks GitHub collaborator status. If the repository's origin remote is not `github.com` (e.g. self-hosted GitLab, local repo, or custom remote), `resolveSlug()` returns `undefined`, setting `failClosed = true` and `perm = "none"`:
  ```ts
  // src/server/auth.ts:174-175
  const reading = c.req.method === "GET" || c.req.method === "HEAD";
  if (reading && (failClosed || perm === "read")) return next();
  ```
  If `failClosed` is `true`, ANY authenticated GitHub user is granted full read access to all endpoints. A user who is completely unrelated to the repository can sign in with any random GitHub account and read private documents, metadata, and raw files. This completely undermines the collaborator permission model when remote origins differ or are not configured.

- **Recommendation:**
  When `resolveSlug()` fails or origin is not `github.com`, the gate should fail truly closed: refuse all non-public API access with 403 unless explicit local access rules are defined.

---

### SEC-05: Lack of CSRF Protections on Mutating API Endpoints
- **File:** `src/server/index.ts` (Lines 127–142) & `src/server/auth.ts` (Lines 307–310)
- **Severity:** Medium
- **Category:** Cross-Site Request Forgery (CSRF)
- **Why It Matters:**
  The server relies exclusively on cookie authentication (`fragmt_session`) without anti-CSRF tokens, Double Submit Cookies, or verifying the `Origin`/`Referer` header on state-changing requests (`POST`, `PUT`, `PATCH`, `DELETE`).
  
  While `SameSite=Lax` restricts cross-site cookies on standard subresource requests, it permits cookies on top-level GET navigations. Furthermore, in setups hosted across subdomains or in intranet environments, lack of explicit CSRF protection allows cross-site requests to execute unauthorized operations (e.g., branch creation, doc deletion, comment posting) if cookie-sending conditions are satisfied.

- **Recommendation:**
  Implement CSRF verification middleware on all state-changing endpoints (checking `Origin`/`Referer` against allowed hostnames or requiring a custom header such as `X-Fragmt-Request: 1` on all JSON API calls).

---

### SEC-06: Unsanitized External URL Execution (Untrusted Scheme Injection via `window.open`)
- **File:** `ui/src/editor/links.ts` (Lines 79–81) & `ui/src/EditorPane.tsx` (Lines 349–352)
- **Severity:** Medium
- **Category:** Cross-Site Scripting (XSS) / Protocol Injection
- **Why It Matters:**
  In `ui/src/editor/links.ts`, any link starting with a scheme pattern is classified as `external`:
  ```ts
  const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
  // ...
  if (SCHEME.test(trimmed) || trimmed.startsWith("//")) {
      return { kind: "external" };
  }
  ```
  In `ui/src/EditorPane.tsx:351`:
  ```ts
  case "external":
      e.preventDefault();
      window.open(href, "_blank", "noopener,noreferrer");
      break;
  ```
  `SCHEME` matches any URI scheme, including `javascript:`, `data:`, and `vbscript:`. While modern browsers restrict certain actions in `window.open` with `_blank`, `data:text/html,...` or application protocol handlers (e.g., custom URI handlers) can still be triggered. If an attacker contributes markdown content with malicious link targets, clicking these links can execute arbitrary scripts or trigger unwanted client-side behaviors.

- **Recommendation:**
  Explicitly allowlist external link schemes in `resolveLinkTarget` (e.g., `http:`, `https:`, `mailto:`, `tel:`). Refuse or classify dangerous schemes (`javascript:`, `data:`) as invalid.

---

### SEC-07: Denial of Service & Memory Exhaustion via Synchronous Bundle Export
- **File:** `src/core/zip.ts` (Lines 125–151) & `src/server/index.ts` (Lines 814–826)
- **Severity:** Medium
- **Category:** Denial of Service (Resource Exhaustion)
- **Why It Matters:**
  `bundleZip` performs a synchronous recursive file walk of `docsRoot` and reads every file completely into memory via `readFileSync`:
  ```ts
  // src/core/zip.ts:149
  return { name, data: readFileSync(target) };
  ```
  While `.git` is ignored, directories like `node_modules` or `dist` are NOT ignored if `docsRoot` is `.`. In a standard project root, `node_modules` can contain tens of thousands of files totaling hundreds of megabytes.
  
  Calling `GET /api/export/bundle` will block the Node.js event loop for seconds/minutes and exceed V8 heap memory limits, crashing the server process (Out-Of-Memory DoS). Any user with read permissions can trigger this crash.

- **Recommendation:**
  Ensure `bundleZip` ignores `node_modules`, `dist`, dotfiles, and matches the directory ignore filters implemented in `src/core/tree.ts:80-84`. Stream zip entries instead of buffering the entire repository into memory.

---

### SEC-08: Excessive GitHub OAuth Scope Request (`repo` Scope)
- **File:** `src/server/auth.ts` (Line 219)
- **Severity:** Medium
- **Category:** Principle of Least Privilege Violation
- **Why It Matters:**
  `src/server/auth.ts:219` requests the classic OAuth scope `repo user:email`:
  ```ts
  authorize.searchParams.set("scope", "repo user:email");
  ```
  The `repo` scope grants full read and write access to **all** private and public repositories that the authenticated user has access to across GitHub.
  
  If the fragmt server host is compromised or if an in-memory session token is leaked, an attacker gains read/write capabilities across the victim's entire GitHub profile and organization repositories.

- **Recommendation:**
  Evaluate transitioning to GitHub Apps (fine-grained permissions limited to a specific repository) rather than classic OAuth Apps with account-wide `repo` scope.

---

### SEC-09: Concurrency Race Conditions and Shared Worktree Interference
- **File:** `src/server/index.ts` (Lines 718–731) & `src/core/git.ts` (Lines 90–95)
- **Severity:** Medium
- **Category:** Concurrency / Data Integrity
- **Why It Matters:**
  In `--auth` multi-user mode, the server operates on a single local working tree. The endpoint `POST /api/checkout` directly runs `git checkout <branch>`:
  ```ts
  // src/server/index.ts:726
  await checkoutBranch(ctx.repoRoot, body.name);
  ```
  If User A is editing a doc on `main`, and User B switches to `draft-feature`, the local files in the working directory are physically switched for all users. Concurrent operations (saving docs, committing comments, syncing remotes) can fail due to `.git/index.lock` contention or produce corrupted commits containing unintended staged files from other branches.

- **Recommendation:**
  Implement git worktrees per active session/branch as outlined in `docs/ARCHITECTURE.md §3` for multi-user hosting, or serialize/isolate branch operations to prevent multi-user collisions.

---

### SEC-10: Missing HTTP Security Headers (Clickjacking & MIME-Sniffing Risks)
- **File:** `src/server/index.ts` (Lines 127–163)
- **Severity:** Low
- **Category:** Security Misconfiguration
- **Why It Matters:**
  The server does not send standard security headers:
  - `X-Frame-Options` or `Content-Security-Policy: frame-ancestors 'none'` (permits embedding the fragmt UI in malicious `<iframe>` tags, enabling clickjacking attacks against authenticated users)
  - `X-Content-Type-Options: nosniff` (browser MIME-sniffing risks on raw files)
  - `Strict-Transport-Security` (HSTS)
  - `Content-Security-Policy`

- **Recommendation:**
  Add a global security headers middleware (or integrate standard middleware like `@hono/node-server` or `hono/secure-headers`) to set `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, and a restrictive CSP.

---

### SEC-11: Host Header Poisoning in OAuth Callback URL Generation
- **File:** `src/server/auth.ts` (Lines 208–210 & Line 248)
- **Severity:** Low
- **Category:** Insecure Configuration / Spoofing
- **Why It Matters:**
  During OAuth authorization and code exchange, the callback URL is dynamically constructed from `c.req.url`:
  ```ts
  authorize.searchParams.set(
      "redirect_uri",
      `${new URL(c.req.url).origin}/api/auth/callback`,
  );
  ```
  `c.req.url` derives from the incoming HTTP `Host` header. While GitHub enforces exact callback URL matching against registered URLs in the GitHub Developer settings, dynamic origin deduction can lead to redirect manipulation or cache poisoning if a reverse proxy passes unvalidated `Host` headers.

- **Recommendation:**
  Derive the callback URL from an explicit configuration or environment variable (e.g., `APP_URL` or `HOST_URL`) rather than trusting the client `Host` header.

---

### SEC-12: Information Disclosure of Contributor Email Addresses via `/api/meta`
- **File:** `src/server/auth.ts` (Line 65) & `src/server/index.ts` (Lines 767–775)
- **Severity:** Low
- **Category:** Information Disclosure
- **Why It Matters:**
  When a user completes GitHub OAuth, their verified emails are fetched from `https://api.github.com/user/emails` and cached in `emailLogins`.
  In `src/server/index.ts:773`:
  ```ts
  return c.json({
      ...meta,
      authors: { ...verifiedEmailLogins(), ...meta.authors },
  });
  ```
  The endpoint `GET /api/meta` is accessible to any user with read access, exposing the list of verified private email addresses of other users who have logged into the instance. This conflicts with the privacy specification in `HOSTING.md` ("Emails are used only to resolve avatars, kept in memory, never logged").

- **Recommendation:**
  Do not expose the raw email address mapping to clients. Instead, return a hash (e.g. SHA-256) or resolve avatars server-side by returning only the avatar URL.

---

### SEC-13: Unvalidated Git Revision Parameter in `restoreDoc`
- **File:** `src/server/index.ts` (Lines 970–988) & `src/core/drafts.ts` (Lines 450–466)
- **Severity:** Low
- **Category:** Input Validation
- **Why It Matters:**
  In `POST /api/restore`, `body.sha` is accepted without verifying that it matches a valid hexadecimal commit SHA format:
  ```ts
  // src/core/drafts.ts:465
  await showRef(repoRoot, `${deleteSha}^:${repoRel}`)
  ```
  While `showRef` uses `execFile` (precluding shell injection), passing arbitrary git revision expressions (e.g., `HEAD~2`, branch names, tags) allows restoring arbitrary file states rather than strictly the pre-deletion commit.

- **Recommendation:**
  Validate `deleteSha` against a strict regex (e.g., `/^[0-9a-f]{7,40}$/i`) before executing `git show`.

---

### SEC-14: Unsafe Branch Mirroring via `/api/sync` (`pushRefs --all`)
- **File:** `src/core/sync.ts` (Lines 119–129) & `src/server/index.ts` (Lines 990–1005)
- **Severity:** Medium
- **Category:** Broken Access Control / Data Exposure
- **Why It Matters:**
  When `POST /api/sync` is called by an authenticated user with write access, `sync()` executes:
  ```ts
  // src/core/sync.ts:126-127
  if (as) await pushRefs(repoRoot, githubPushUrl(as.slug), ["--all"], as.token);
  else await git(repoRoot, ["push", "--all"]);
  ```
  This unconditionally mirror-pushes **ALL** local branches in the repository to the upstream GitHub remote. In a multi-user hosted instance where collaborators work on distinct branches, work-in-progress draft branches (`drafts/*`) that may contain unreviewed, unredacted, or private content are published to the remote repository without the branch author's knowledge or consent, under the triggering user's GitHub credentials.

- **Recommendation:**
  Restrict synchronization to explicit tracked upstream branches or the user's active branch instead of mirroring all local branches with `["--all"]`.

---

### SEC-15: Unchecked Force Branch Deletion Flag in `/api/branches/:name`
- **File:** `src/server/index.ts` (Lines 743–747) & `src/core/git.ts` (Lines 122–126)
- **Severity:** Low
- **Category:** Improper Access Control / Data Loss
- **Why It Matters:**
  The branch deletion endpoint `DELETE /api/branches/:name` checks for the presence of the `force` query parameter:
  ```ts
  // src/server/index.ts:743-747
  await deleteBranch(
      ctx.repoRoot,
      name,
      c.req.query("force") !== undefined,
  );
  ```
  In `deleteBranch`, `git branch -D <name>` is executed when `force` is truthy. While the frontend UI removed the force-delete option to protect unmerged branches from accidental deletion, the backend API endpoint continues to support the `?force` query parameter without administrative authorization checks, leaving unmerged branches susceptible to permanent destruction.

- **Recommendation:**
  Disallow forced branch deletion via the API in hosted multi-user environments, or restrict `-D` force deletion to administrators.

---

## Conclusion & Architecture Roadmap

The `fragmt` architecture provides strong core principles for git-native documentation editing, but needs defensive hardening before being deployed in multi-tenant or publicly accessible environments. Addressing the path containment restrictions under `docsRoot: "."`, enforcing secure cookie flags, adding CSRF and security headers, and isolating git worktrees will bring the system into alignment with enterprise security requirements.
