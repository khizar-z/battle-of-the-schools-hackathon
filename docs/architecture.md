# Architecture

Scout is a browser extension backed by a small TypeScript API.

```text
Extension search form
  -> POST /search
  -> query parser (OpenAI Structured Outputs or local fallback)
  -> parallel BrowserAgent searches
  -> normalization, deduplication, ranking
  -> SSE listing batches + GET /search/:jobId snapshot
```

`BrowserAgent` isolates browser infrastructure from the job orchestrator. `MockBrowserAgent` supports local UI development. With `MOCK_AGENTS=false`, `SteelBrowserAgent` opens a Steel session, publishes its viewer URL, searches eBay or Kijiji through Playwright, then always releases the session.

Recipes are stored in `data/site-recipes.json` at runtime (or `RECIPE_STORE_PATH`). Known eBay and Kijiji recipes are persisted after success. Unknown sources use a constrained search-box discovery fallback and save a lightweight recipe only if listing links are found.

The rank score is deterministic: query relevance, requested-price fit, recency, requested-location fit, and listing completeness. Exact canonical URLs and high-confidence title/price/location matches are deduplicated.

