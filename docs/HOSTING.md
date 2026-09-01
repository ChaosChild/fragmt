# Hosting fragmt

By default `fragmt serve` is a local, single-user tool bound to `127.0.0.1`.
With `--auth` it becomes a small multi-user server: everyone signs in with
GitHub, and **your repo's collaborator permissions are the entire access
system** – there is no users table and no roles to configure.

## The two modes

| Invocation | Auth | Binds | Start rule |
| --- | --- | --- | --- |
| `fragmt serve` | none – today's local mode | `127.0.0.1` loopback only | always starts |
| `fragmt serve --auth --port <n>` | GitHub OAuth required | all interfaces | refuses to start without `--port` and both `GH_CLIENT_ID` + `GH_CLIENT_SECRET` |

`--port` is mandatory with `--auth` because the OAuth callback needs a
repeatable port – an ephemeral port would break every sign-in. Plain `serve`
keeps port `0` (ephemeral) as always.

## Quick start

```sh
git clone https://github.com/you/your-docs && cd your-docs
npx fragmt init            # once per clone
GH_CLIENT_ID=… GH_CLIENT_SECRET=… npx fragmt serve --auth --port 4400
```

Open `http://<host>:4400`, press **Sign in with GitHub**, done. Sign-in
attributes every subsequent edit and comment commit to the signed-in user
(author field; the committer stays the machine's git identity, the same way
GitHub's web editor attributes edits).

## Registering the GitHub OAuth app

1. GitHub → Settings → Developer settings → **OAuth Apps** → **New OAuth App**.
2. App name: anything. Homepage: your repo or site.
3. **Authorization callback URL:** `http://<host>:<port>/api/auth/callback`.
   The callback is per-origin – a localhost trial, a LAN IP and a public
   domain each need their own app (or callback entry).
4. Register, copy the **Client ID**, then **Generate a client secret**. The
   secret is shown once; regenerating invalidates the old one.
5. Export both as `GH_CLIENT_ID` and `GH_CLIENT_SECRET` before starting the
   server. Never put them in `.fragmt.json` – that file is committed to the
   docs repo. If either is missing, `serve --auth` refuses to start.

## Permissions: GitHub collaborators are the system

| Collaborator permission | Access |
| --- | --- |
| admin, maintain, write | edit – everything the local tool can do |
| read, triage | read-only – every mutation is refused with a clear 403 |
| everyone else | nothing – every API call is a 403 |

How it works, and its edges:

- The check queries GitHub with the **signed-in user's own token** (scope
  `repo` – classic OAuth apps have no read-only scope, and the check must read
  private-repo metadata). The token lives in the server's in-memory session
  only: never persisted, never sent to the browser, never logged.
- Permission results are cached for up to **5 minutes** – a revocation lands
  within that window.
- The repo's `origin` must be a github.com URL. Anything else (or GitHub
  being unreachable) **fails closed**: signed-in users can read, every
  mutation is refused.
- Merges of draft branches currently commit with the server's git identity;
  edit and comment commits carry the signed-in author. True per-user push
  identity arrives with PR wiring ([#27](https://github.com/ChaosChild/fragmt/issues/27)).

## TLS

fragmt speaks plain HTTP only. Terminate TLS in front of it and keep
`proxy_set_header Host` intact – the OAuth redirect URL is derived from the
request's host, so the proxy must forward it unchanged.

nginx:

```nginx
server {
	listen 443 ssl;
	server_name docs.example.com;
	# ssl_certificate / ssl_certificate_key as usual
	location / {
		proxy_pass http://127.0.0.1:4400;
		proxy_set_header Host $host;
		proxy_set_header X-Forwarded-Proto https;
	}
}
```

Caddy, the two-line version:

```
docs.example.com {
	reverse_proxy 127.0.0.1:4400
}
```

With a public HTTPS origin, register the OAuth app callback as
`https://docs.example.com/api/auth/callback`.

## Docker

The repo root ships a sample `Dockerfile` and `docker-compose.yml` (pre-built
GHCR images are planned for later releases). Prepare the docs repo on the
host first – a normal clone plus one `npx fragmt init` – then:

```sh
cp .env.example .env    # put GH_CLIENT_ID / GH_CLIENT_SECRET in .env
docker compose up -d
```

`docker-compose.yml` mounts `./my-docs` (rename to your clone) at `/docs` and
publishes `4400:4400`. The image preinstalls git, the committer identity, and
`safe.directory` for the mount, so container commits behave like local ones.

## Sessions and security notes

- Sessions are **in-memory**: a server restart signs everyone out (7-day
  absolute TTL otherwise). A file-backed store is a deliberate non-feature
  until it hurts.
- Cookies are `HttpOnly` and `SameSite=Lax`. The `Secure` flag is not set
  because plain-HTTP LAN use is a supported mode; behind a TLS proxy the
  session cookie still only travels over the encrypted hop between browser
  and proxy.
- The API is same-origin: no CORS anywhere, so other sites cannot drive a
  signed-in browser against your instance.
- One instance serves **one repo** today. Multi-repo hosting is a post-v2
  idea tracked in [#28](https://github.com/ChaosChild/fragmt/issues/28).
