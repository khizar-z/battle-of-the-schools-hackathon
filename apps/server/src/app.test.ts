import { afterAll, describe, expect, it } from "vitest";

import type { BrowserAgent } from "./agents/browser-agent.js";
import { buildApp } from "./app.js";
import { SearchJobManager } from "./search-jobs.js";

const app = buildApp();

afterAll(async () => {
  await app.close();
});

describe("server", () => {
  it("reports healthy", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "ok", service: "gehackathon-server", mode: "mock" });
  });

  it("returns the initial marketplace catalog", async () => {
    const response = await app.inject({ method: "GET", url: "/sources" });

    expect(response.statusCode).toBe(200);
    expect(response.json().sources).toHaveLength(4);
  });

  it("starts a validated search job", async () => {
    const jobs = new SearchJobManager({ mockAgents: true, mockDelayMs: 0 });
    const testApp = buildApp({ jobs });
    const response = await testApp.inject({
      method: "POST",
      url: "/search",
      payload: { query: "used desk under $50", sources: ["kijiji"] }
    });

    expect(response.statusCode).toBe(200);
    const { jobId } = response.json();
    const job = jobs.get(jobId);
    await job?.done;
    expect(job?.events.at(-1)).toEqual({ type: "job_complete", jobId });

    const snapshot = await testApp.inject({ method: "GET", url: `/search/${jobId}` });
    expect(snapshot.statusCode).toBe(200);
    expect(snapshot.json()).toMatchObject({ jobId, status: "complete" });
    expect(snapshot.json().listings).toHaveLength(2);
    await testApp.close();
  });

  it("cancels a search job and reports unknown jobs", async () => {
    const stalledAgent: BrowserAgent = { search: () => new Promise(() => undefined) };
    const jobs = new SearchJobManager({ agent: stalledAgent });
    const testApp = buildApp({ jobs });
    const started = await testApp.inject({ method: "POST", url: "/search", payload: { query: "bike", sources: ["kijiji"] } });
    const { jobId } = started.json();

    const cancelled = await testApp.inject({ method: "POST", url: `/search/${jobId}/cancel` });
    expect(cancelled.statusCode).toBe(200);
    await jobs.get(jobId)?.done;
    expect(jobs.get(jobId)?.status).toBe("complete");

    const missing = await testApp.inject({ method: "POST", url: "/search/job_404/cancel" });
    expect(missing.statusCode).toBe(404);
    await testApp.close();
  });

  it("rejects unknown marketplace sources", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/search",
      payload: { query: "bike", sources: ["not-a-marketplace"] }
    });

    expect(response.statusCode).toBe(400);
  });
});
