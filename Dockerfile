# Sample image: serve an init'ed docs repo with GitHub sign-in.
# Full walkthrough in docs/HOSTING.md.
FROM node:22-alpine

RUN apk add --no-cache git

RUN npm i -g fragmt

# Commits made inside the container: the AUTHOR is always the signed-in
# GitHub user (serve --auth); the committer is this machine identity.
# safe.directory accepts the host-mounted clone at /docs.
RUN git config --global user.name "fragmt" && \
	git config --global user.email "fragmt@localhost" && \
	git config --global --add safe.directory /docs

WORKDIR /docs
EXPOSE 4400
CMD ["fragmt", "serve", "--auth", "--port", "4400"]
