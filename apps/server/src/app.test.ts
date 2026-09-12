import { afterAll, describe, expect, it } from "vitest";

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
    expect(response.json()).toEqual({ status: "ok", service: "gehackathon-server" });
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

  it("rejects unknown marketplace sources", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/search",
      payload: { query: "bike", sources: ["not-a-marketplace"] }
    });

    expect(response.statusCode).toBe(400);
  });
});
