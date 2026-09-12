# Extension browser support

## Supported browsers

Scout is a single Manifest V3 extension bundle that supports Firefox 121+ and
Chromium 121+ (including Chrome, Edge, and Brave). The browser API usage stays
within the shared WebExtension surface, and the background worker selects the
available `browser` or `chrome` namespace at runtime.

The manifest deliberately includes both `background.service_worker` and
`background.scripts`. Chromium runs the service worker; Firefox runs the script
fallback. This is the cross-browser MV3 approach documented by [MDN](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background).

## Build and load

```bash
pnpm install
pnpm build
```

The built extension is in `apps/extension/dist`.

- Chromium: enable Developer mode in `chrome://extensions`, choose **Load unpacked**, and select `apps/extension/dist`.
- Firefox: go to `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select `apps/extension/dist/manifest.json`.

Temporary Firefox add-ons are removed when the browser closes. Distribution through
Firefox Add-ons requires signing.

## Agent B implementation changes

- React popup search experience with source toggles, result cards, filters, live
  agent activity, errors, loading states, and keyboard-native controls.
- Typed search-state reducer for incremental SSE listing batches and independent
  marketplace failures.
- Mock agent stream when `VITE_API_BASE_URL` is omitted, so the product can be
  demonstrated without the backend.
- Backend client support for both a bare source list and the server's
  `{ "sources": [...] }` response envelope.
- Firefox/Chromium Manifest V3 compatibility test to prevent regressions.
