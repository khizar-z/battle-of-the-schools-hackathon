# Scout extension

## Develop

```bash
pnpm install
pnpm dev:extension
```

For a production extension bundle:

```bash
pnpm build
```

The extension build caps each Node build process at 384 MB, so a broken or
unexpected dependency graph cannot consume unbounded memory. A build failure is
reported normally instead of exhausting the machine.

## Browser support

Scout ships one Manifest V3 bundle for current Chromium browsers and Firefox 121+.
The manifest registers both background mechanisms: Chromium uses the service worker
and Firefox uses the background script fallback. This is intentional and covered by
a manifest test.

- Chrome, Edge, Brave, and other Chromium 121+ browsers: open `chrome://extensions`, enable **Developer mode**, then select **Load unpacked** and choose `apps/extension/dist`.
- Firefox 121+: open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, then select `apps/extension/dist/manifest.json`.

Firefox temporary add-ons are removed when Firefox closes. A signed AMO distribution
is required for a persistent Firefox installation.

## Backend connection

The extension uses deterministic mock agents when `VITE_API_BASE_URL` is not set. To connect the server, create `apps/extension/.env.local`:

```bash
VITE_API_BASE_URL=http://localhost:3000
```

The server contract is `GET /sources`, `POST /search`, and `GET /search/:jobId/events` (SSE).

## Verification

```bash
pnpm --filter @gehackathon/extension typecheck
pnpm --filter @gehackathon/extension test
pnpm --filter @gehackathon/extension build
```
