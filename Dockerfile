# Sample image: serve an init'ed docs repo with GitHub sign-in.
# Full walkthrough in docs/HOSTING.md.
FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32

RUN apk add --no-cache git

RUN npm i -g fragmt

# Commits made inside the container: the AUTHOR is always the signed-in
# GitHub user (serve --auth); the committer is this machine identity.
# safe.directory accepts the host-mounted clone at /docs.
# The image runs as the unprivileged node user; USER must come before
# this block so the global config lands in /home/node/.gitconfig.
USER node
RUN git config --global user.name "fragmt" && \
	git config --global user.email "fragmt@localhost" && \
	git config --global --add safe.directory /docs

WORKDIR /docs
EXPOSE 4400
HEALTHCHECK CMD ["node", "-e", "fetch('http://127.0.0.1:4400/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["fragmt", "serve", "--auth", "--port", "4400"]
