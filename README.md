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

After searching, choose **Keep results open** to open a persistent Scout workspace tab. Listing links open separately, so the search results remain available. The popup itself closes when it loses focus, which is standard Chromium extension behavior. Closing the popup does not lose a running search: reopening it (or the workspace tab) resubscribes to the job's event stream, which the server replays from the beginning, so every marketplace's status and listing count is rebuilt accurately.

## Development search API

`POST /search` accepts a query and marketplace IDs, then returns a job ID. Subscribe to `GET /search/:jobId/events` using Server-Sent Events to receive source progress and listing batches. With `MOCK_AGENTS=true`, the server emits deterministic sample listings so the extension can be built without browser-agent credentials.

`POST /search/:jobId/cancel` stops a running job: each unfinished marketplace completes as `skipped`, browser sessions are released, and the stream still ends with `job_complete`. The extension shows a **Cancel** button beside **Search** while a job is running. `GET /search/:jobId` returns the latest normalized, deduplicated, ranked result snapshot. Scout sends each marketplace the user's original, broad wording and then uses the configured LLM to semantically judge the returned listing cards. This avoids brittle literal matches—for example, an automotive part called “housing” is not a UofT rental. When no model is configured or a request fails, the deterministic ranker remains available.

To run a real browser session, set `MOCK_AGENTS=false` and provide `STEEL_API_KEY`. Live recipes currently search Facebook Marketplace, eBay, and Kijiji through Steel browser sessions and emit a session-viewer URL in source-status events. Other enabled sources remain isolated failures until their recipes are added, so one unsupported marketplace never interrupts the overall search.

Housing and other ambiguous searches stay broad on every selected marketplace; Scout does not silently skip sources or force a category before it has seen their inventory. If a marketplace redirects a Steel session to sign-in, Scout presents an **Open sign-in** prompt and continues the search automatically after sign-in completes. Steel Profiles persist the signed-in browser state per marketplace in `data/steel-profiles.json`, so later searches reuse that login.

To use Claude for shopping-intent parsing and semantic listing selection, set `LLM_PROVIDER=anthropic`, `ANTHROPIC_API_KEY`, and optionally `ANTHROPIC_MODEL` (default: `claude-haiku-4-5`). `LLM_PROVIDER=openai` uses GPT-5 Mini Structured Outputs for the same decisions. Any model/API failure automatically falls back to local parsing and ranking. Recipe data is persisted locally in `data/site-recipes.json` and is ignored by Git. See [architecture](docs/architecture.md) and the [demo runbook](docs/demo.md).
