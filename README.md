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

To build the extension against the local API, set `VITE_API_BASE_URL=http://localhost:3000` in `apps/extension/.env.local`, run `pnpm build`, then load `apps/extension/dist` as an unpacked Chromium extension.

After searching, choose **Keep results open** to open a persistent Scout workspace tab. Listing links open separately, so the search results remain available. The popup itself closes when it loses focus, which is standard Chromium extension behavior.

## Development search API

`POST /search` accepts a query and marketplace IDs, then returns a job ID. Subscribe to `GET /search/:jobId/events` using Server-Sent Events to receive source progress and listing batches. With `MOCK_AGENTS=true`, the server emits deterministic sample listings so the extension can be built without browser-agent credentials.

`GET /search/:jobId` returns the latest normalized, deduplicated, ranked result snapshot. The deterministic MVP rank score combines query relevance, requested price fit, recency, location fit, and listing completeness.

To run a real browser session, set `MOCK_AGENTS=false` and provide `STEEL_API_KEY`. Live recipes currently search eBay and Kijiji through Steel browser sessions and emit a session-viewer URL in source-status events. Other enabled sources remain isolated failures until their recipes are added, so one unsupported marketplace never interrupts the overall search.

Housing searches are routed to Kijiji's rental category, while Facebook Marketplace continues through its regular search flow and is screened for rental relevance. eBay is shown as skipped to avoid literal product-keyword matches. If a marketplace redirects a Steel session to sign-in, Scout presents an **Open sign-in** prompt and continues the search automatically after sign-in completes. Steel Profiles persist the signed-in browser state per marketplace in `data/steel-profiles.json`, so later searches reuse that login.

To parse shopping intent with Claude, set `LLM_PROVIDER=anthropic`, `ANTHROPIC_API_KEY`, and optionally `ANTHROPIC_MODEL` (default: `claude-haiku-4-5`). `LLM_PROVIDER=openai` keeps the existing GPT-5 Mini Structured Outputs option. Any model/API failure automatically falls back to the local parser. Recipe data is persisted locally in `data/site-recipes.json` and is ignored by Git. See [architecture](docs/architecture.md) and the [demo runbook](docs/demo.md).
