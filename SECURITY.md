# Security Policy

## Supported versions

The current release line receives security fixes; there is no backporting to
older lines. Keep `fragmt` updated – fixes ship as patch releases.

| Version | Supported |
| ------- | --------- |
| latest 0.x | ✅ |
| older     | ❌ |

## Reporting a vulnerability

Please report privately, not in public issues:

- **GitHub private vulnerability reporting** on this repository
  (Security → Report a vulnerability), or
- email **chaoschild.1st@gmail.com**

Include what you found, how to reproduce it, and the affected version
(`npm ls fragmt` or the version from your install). You will get an
acknowledgement within a few days; fixes ship as patch releases with credit
to the reporter unless you prefer otherwise.

## What runs where

Worth knowing before you dig: fragmt serves a local editor over the docs of
a git clone you own. The default `serve` binds to `127.0.0.1` only. The
multi-user mode (`serve --auth`) is a GitHub OAuth flow gated by your repo's
collaborator permissions – the [hosting guide](docs/HOSTING.md) covers TLS
termination and the Docker sample's hardening. Server-side parsing of
untrusted input is limited to markdown, frontmatter and the git metadata of
your own repo.
