import { describe, expect, it } from "vitest";

import { DEFAULT_SOURCES } from "@gehackathon/shared";
import type { BrowserAgent } from "./agents/browser-agent.js";

import { parseSearchIntent } from "./query-parser.js";
import { SearchJobManager } from "./search-jobs.js";

describe("SearchJobManager", () => {
  it("streams source progress and preserves partial results", async () => {
    const jobs = new SearchJobManager({ mockAgents: true, mockDelayMs: 0 });
    const job = jobs.start(parseSearchIntent("used desk under $50"), DEFAULT_SOURCES.slice(1, 3));

    await job.done;

    expect(job.events.map((event) => event.type)).toContain("listing_batch");
    expect(job.events.at(-1)).toEqual({ type: "job_complete", jobId: job.id });
    const listingBatches = job.events.filter((event) => event.type === "listing_batch");
    expect(listingBatches).toHaveLength(2);
    expect(listingBatches.every((event) => event.listings.length === 2)).toBe(true);
    expect(listingBatches.flatMap((event) => event.listings).every((listing) => listing.price! <= 50)).toBe(true);
  });

  it("isolates a timed-out agent without blocking the job", async () => {
    const stalledAgent: BrowserAgent = { search: () => new Promise(() => undefined) };
    const jobs = new SearchJobManager({ agent: stalledAgent, sourceTimeoutMs: 1 });
    const job = jobs.start(parseSearchIntent("used desk"), [DEFAULT_SOURCES[1]]);

    await job.done;

    expect(job.events).toContainEqual({
      type: "source_status",
      sourceId: "kijiji",
      status: "error",
      message: "Marketplace search timed out"
    });
    expect(job.events.at(-1)).toEqual({ type: "job_complete", jobId: job.id });
  });

  it("retries a recoverable source failure once", async () => {
    let attempts = 0;
    const flakyAgent: BrowserAgent = {
      async search() {
        attempts += 1;
        if (attempts === 1) throw new Error("temporary upstream failure");
        return [];
      }
    };
    const jobs = new SearchJobManager({ agent: flakyAgent, sourceRetryCount: 1 });
    const job = jobs.start(parseSearchIntent("used desk"), [DEFAULT_SOURCES[1]]);

    await job.done;

    expect(attempts).toBe(2);
    expect(job.events).toContainEqual(expect.objectContaining({ message: "Retrying marketplace search (1/1)…" }));
  });

  it("searches every selected source instead of imposing a housing source policy", async () => {
    let calls = 0;
    const agent: BrowserAgent = { search: async () => { calls += 1; return []; } };
    const jobs = new SearchJobManager({ agent });
    const job = jobs.start(
      { rawQuery: "housing near uoft", item: "housing", searchMode: "housing" },
      [{ id: "ebay", name: "eBay", domain: "ebay.ca", enabled: true }]
    );
    await job.done;

    expect(calls).toBe(1);
    expect(job.events).not.toContainEqual(expect.objectContaining({ type: "source_status", status: "skipped" }));
  });
});
