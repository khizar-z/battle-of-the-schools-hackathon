import { describe, expect, it } from "vitest";
import type { Listing } from "@gehackathon/shared";
import { initialSearchState, searchReducer } from "./search-state";

const listing: Listing = {
  id: "listing-1",
  sourceId: "kijiji",
  sourceName: "Kijiji",
  title: "Vintage desk lamp",
  price: 20,
  currency: "CAD",
  url: "https://example.test/listing-1",
  extractedAt: "2026-09-12T00:00:00.000Z",
};

describe("searchReducer", () => {
  it("resets results and initializes each selected marketplace when a search starts", () => {
    const previous = { ...initialSearchState, listings: [listing], selectedSourceIds: ["ebay"] };
    const next = searchReducer(previous, { type: "start", jobId: "job-123", sourceIds: ["kijiji", "ebay"] });

    expect(next.status).toBe("running");
    expect(next.listings).toEqual([]);
    expect(next.sourceProgress.kijiji).toEqual({ phase: "idle", count: 0 });
  });

  it("adds streamed batches and tracks their source count", () => {
    const started = searchReducer(initialSearchState, { type: "start", jobId: "job-123", sourceIds: ["kijiji"] });
    const next = searchReducer(started, { type: "event", event: { type: "listing_batch", sourceId: "kijiji", listings: [listing] } });

    expect(next.listings).toEqual([listing]);
    expect(next.sourceProgress.kijiji).toMatchObject({ phase: "extracting", count: 1 });
  });

  it("does not duplicate a listing sent twice by the event stream", () => {
    const started = searchReducer(initialSearchState, { type: "start", jobId: "job-123", sourceIds: ["kijiji"] });
    const afterFirstBatch = searchReducer(started, { type: "event", event: { type: "listing_batch", sourceId: "kijiji", listings: [listing] } });
    const next = searchReducer(afterFirstBatch, { type: "event", event: { type: "listing_batch", sourceId: "kijiji", listings: [listing] } });

    expect(next.listings).toHaveLength(1);
    expect(next.sourceProgress.kijiji.count).toBe(1);
  });

  it("preserves partial results when another marketplace errors", () => {
    const started = searchReducer(initialSearchState, { type: "start", jobId: "job-123", sourceIds: ["kijiji", "ebay"] });
    const withResult = searchReducer(started, { type: "event", event: { type: "listing_batch", sourceId: "kijiji", listings: [listing] } });
    const next = searchReducer(withResult, { type: "event", event: { type: "source_status", sourceId: "ebay", status: "error", message: "Timed out" } });

    expect(next.listings).toEqual([listing]);
    expect(next.sourceProgress.ebay).toMatchObject({ phase: "error", message: "Timed out" });
  });
});
