# GeHackathon

Universal secondhand marketplace search, built as a Chromium browser extension and browser-agent backend.

## Workspace

- `apps/server` — Fastify API and marketplace-agent orchestration.
- `packages/shared` — runtime-validated data contracts shared by the server and extension.
- `fixtures` — deterministic contract data for local development and tests.

## Local setup

```sh
pnpm install
cp .env.example .env
pnpm typecheck
pnpm test
pnpm dev:server
```

The server is available at `http://localhost:3000`; `GET /health` reports its status and `GET /sources` returns the initial marketplace catalog.
