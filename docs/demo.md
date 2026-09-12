# Demo runbook

1. Start the API with `pnpm dev:server` and load the built extension from `apps/extension/dist`.
2. For a safe fallback, leave `MOCK_AGENTS=true`; the extension can run without credentials.
3. For the agent demo, set `MOCK_AGENTS=false` and add `STEEL_API_KEY` to `.env`.
4. Set `VITE_API_BASE_URL=http://localhost:3000` before building the extension.
5. Search for `used dumbbells under $50 near Kensington Market` with eBay and Kijiji selected.
6. Expand the activity panel as status events arrive; use **Watch live** when Steel exposes a session viewer.
7. Show listings arrive incrementally, then point out the final ranked feed after the search completes.
8. If an external site is slow or blocked, switch back to mock mode and repeat the exact UI flow.

Before presenting, run `pnpm typecheck && pnpm test && pnpm build` and confirm `/health` reports the expected mode.

