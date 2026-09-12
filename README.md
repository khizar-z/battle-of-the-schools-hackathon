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

## Development search API

`POST /search` accepts a query and marketplace IDs, then returns a job ID. Subscribe to `GET /search/:jobId/events` using Server-Sent Events to receive source progress and listing batches. With `MOCK_AGENTS=true`, the server emits deterministic sample listings so the extension can be built without browser-agent credentials.

`GET /search/:jobId` returns the latest normalized, deduplicated, ranked result snapshot. The deterministic MVP rank score combines query relevance, requested price fit, recency, location fit, and listing completeness.

To run a real browser session, set `MOCK_AGENTS=false` and provide `STEEL_API_KEY`. Live recipes currently search eBay and Kijiji through Steel browser sessions and emit a session-viewer URL in source-status events. Other enabled sources remain isolated failures until their recipes are added, so one unsupported marketplace never interrupts the overall search.
