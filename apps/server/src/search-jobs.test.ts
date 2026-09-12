import { describe, expect, it } from "vitest";

import { DEFAULT_SOURCES } from "@gehackathon/shared";

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
});
