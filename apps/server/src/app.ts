import cors from "@fastify/cors";
import Fastify from "fastify";

import { DEFAULT_SOURCES, createSearchRequestSchema } from "@gehackathon/shared";

import { createQueryParser, getConfiguredLlmProvider, type QueryParser } from "./query-parser-service.js";
import { SearchJobManager } from "./search-jobs.js";

export interface BuildAppOptions {
  jobs?: SearchJobManager;
  queryParser?: QueryParser;
}

function formatSseEvent(event: unknown): string {
  return `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({ logger: true });
  const jobs = options.jobs ?? new SearchJobManager();
  const queryParser = options.queryParser ?? createQueryParser();
  const llmProvider = getConfiguredLlmProvider();

  void app.register(cors, { origin: true });

  app.get("/health", async () => ({
    status: "ok",
    service: "gehackathon-server",
    mode: process.env.MOCK_AGENTS === "false" ? "live" : "mock",
    steelConfigured: Boolean(process.env.STEEL_API_KEY),
    llmConfigured: llmProvider !== "fallback",
    llmProvider
  }));

  // This gives the extension a stable development contract before agent work begins.
  app.get("/sources", async () => ({ sources: DEFAULT_SOURCES }));

  app.post("/search", async (request, reply) => {
    const parsed = createSearchRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid search request", details: parsed.error.flatten() });
    }

    const sources = parsed.data.sources.flatMap((sourceId) =>
      DEFAULT_SOURCES.filter((source) => source.id === sourceId)
    );
    if (sources.length !== parsed.data.sources.length) {
      return reply.code(400).send({ error: "One or more marketplace sources are unknown" });
    }

    const intent = await queryParser.parse(parsed.data.query);
    const job = jobs.start(intent, sources);
    return { jobId: job.id };
  });

  app.get("/search/:jobId", (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const job = jobs.get(jobId);
    if (!job) return reply.code(404).send({ error: "Search job not found" });

    return { jobId: job.id, status: job.status, intent: job.intent, listings: job.listings };
  });

  app.post("/search/:jobId/cancel", (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const job = jobs.cancel(jobId);
    if (!job) return reply.code(404).send({ error: "Search job not found" });

    return { jobId: job.id, status: job.status };
  });

  app.get("/search/:jobId/events", (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const job = jobs.get(jobId);
    if (!job) return reply.code(404).send({ error: "Search job not found" });

    reply.hijack();
    reply.raw.writeHead(200, {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream"
    });

    for (const event of job.events) reply.raw.write(formatSseEvent(event));

    if (job.status === "complete") {
      reply.raw.end();
      return;
    }

    const unsubscribe = jobs.subscribe(job.id, (event) => {
      reply.raw.write(formatSseEvent(event));
      if (event.type === "job_complete") {
        unsubscribe?.();
        reply.raw.end();
      }
    });
    reply.raw.on("close", () => unsubscribe?.());
  });

  return app;
}
