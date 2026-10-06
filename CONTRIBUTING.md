# Contributing

Thanks for helping with the GitGone server.

## Setup

Node 22 or newer, pnpm (`corepack enable`) and Docker.

```bash
pnpm install
cp .env.example .env        # then set APP_KEY: node ace generate:key
pnpm services               # Postgres on 5433, test database on 5434
node ace migration:run
pnpm dev                    # http://localhost:3333
```

The ports do not overlap with the cloud (Postgres 5432, Redis 6379, Mailpit 8025): both can run together.
`pnpm services:stop` stops the containers.

## Before opening a pull request

```bash
pnpm lint
pnpm typecheck
pnpm test                   # uses the test database (.env.test)
pnpm build
```

CI runs the same commands, plus CodeQL, Gitleaks, Plumber, actionlint and typos.

## Changesets

A change that ships to users needs a changeset: run `pnpm changeset`, pick the bump (patch, minor, major) and
describe the change for the CHANGELOG. Docs, tests and refactors without user impact do not need one.

On every push to `main`, the Release workflow opens or updates a **chore: version packages** pull request that
bumps the version and the CHANGELOG. Merging it tags the release and publishes the Docker image to `ghcr.io`.

## Conventions

- TypeScript strict, no comments in the code.
- Commit messages follow Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`).
- `main` is protected: every change goes through a pull request with a green CI.

## Code of Conduct

This project follows the [Contributor Code of Conduct](CODE_OF_CONDUCT.md). By participating you agree to abide by its terms.
