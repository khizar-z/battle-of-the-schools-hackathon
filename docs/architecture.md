# Architecture

Scout is a browser extension backed by a small TypeScript API.

```text
Extension search form
  -> POST /search
  -> intent parser (Claude tool call, OpenAI Structured Outputs, or local fallback)
  -> parallel BrowserAgent searches
  -> semantic listing judge (same LLM provider, or deterministic fallback)
  -> normalization, deduplication, ranking
  -> SSE listing batches + GET /search/:jobId snapshot
```

Every search event is appended to the job's in-memory log. `GET /search/:jobId/events` replays that log before streaming live events, so a client that reconnects (the popup closes whenever it loses focus, for example when the Steel sign-in tab opens) rebuilds each source's phase and its authoritative `source_complete` count instead of relying on whatever it saw before disconnecting.

`BrowserAgent` isolates browser infrastructure from the job orchestrator. `MockBrowserAgent` supports local UI development. With `MOCK_AGENTS=false`, `SteelBrowserAgent` opens a Steel session, publishes its viewer URL, searches Facebook Marketplace, eBay, or Kijiji through Playwright, then always releases the session.

Recipes are stored in `data/site-recipes.json` at runtime (or `RECIPE_STORE_PATH`). Known eBay and Kijiji recipes are persisted after success. Kijiji's rendered no-results state is handled as a successful empty source and returns zero listings without waiting for listing-card selectors. Unknown sources use a constrained search-box discovery fallback and save a lightweight recipe only if listing links are found.

The rank score is deterministic: query relevance, requested-price fit, recency, requested-location fit, and listing completeness. Exact canonical URLs and high-confidence title/price/location matches are deduplicated.
