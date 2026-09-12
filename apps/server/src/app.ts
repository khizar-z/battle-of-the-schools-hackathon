import Fastify from "fastify";

import { DEFAULT_SOURCES } from "@gehackathon/shared";

export function buildApp() {
  const app = Fastify({ logger: true });

  app.get("/health", async () => ({
    status: "ok",
    service: "gehackathon-server"
  }));

  // This gives the extension a stable development contract before agent work begins.
  app.get("/sources", async () => ({ sources: DEFAULT_SOURCES }));

  return app;
}

