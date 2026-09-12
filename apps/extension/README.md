# Scout extension

## Develop

```bash
npm install
npm run dev --workspace=@gehackathon/extension
```

For a production extension bundle:

```bash
npm run build
```

Load `apps/extension/dist` as an unpacked extension at `chrome://extensions` with Developer mode enabled.

## Backend connection

The extension uses deterministic mock agents when `VITE_API_BASE_URL` is not set. To connect the server, create `apps/extension/.env.local`:

```bash
VITE_API_BASE_URL=http://localhost:3000
```

The server contract is `GET /sources`, `POST /search`, and `GET /search/:jobId/events` (SSE).
