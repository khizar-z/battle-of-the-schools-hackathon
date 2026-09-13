import { describe, expect, it } from "vitest";
import type { Listing, SearchEvent } from "@gehackathon/shared";
import { initialSearchState, searchReducer, type SearchState } from "./search-state";

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

  it("clears a sign-in-required state when the source completes successfully", () => {
    const signInRequired = searchReducer(initialSearchState, {
      type: "event",
      event: { type: "source_status", sourceId: "facebook", status: "needs_login", message: "Sign in first" }
    });
    const completed = searchReducer(signInRequired, {
      type: "event",
      event: { type: "source_complete", sourceId: "facebook", count: 0 }
    });

    expect(completed.sourceProgress.facebook).toEqual({ phase: "complete", message: "Search complete", count: 0, liveSessionUrl: undefined });
  });

  it("rebuilds authoritative source counts when a saved session resumes the event stream", () => {
    // Saved while the popup was closed during Facebook sign-in: Kijiji had
    // finished, Facebook was still waiting for the user.
    const facebookListing: Listing = { ...listing, id: "listing-2", sourceId: "facebook", sourceName: "Facebook Marketplace", url: "https://example.test/listing-2" };
    const saved: SearchState = {
      ...initialSearchState,
      jobId: "job-123",
      status: "running",
      selectedSourceIds: ["facebook", "kijiji"],
      listings: [listing],
      sourceProgress: {
        kijiji: { phase: "complete", count: 1, message: "Search complete" },
        facebook: { phase: "needs_login", count: 0, message: "Sign in", liveSessionUrl: "https://viewer.example.test" },
      },
    };
    const replayedLog: SearchEvent[] = [
      { type: "job_started", jobId: "job-123" },
      { type: "source_started", sourceId: "facebook", sourceName: "Facebook Marketplace" },
      { type: "source_started", sourceId: "kijiji", sourceName: "Kijiji" },
      { type: "listing_batch", sourceId: "kijiji", listings: [listing] },
      { type: "source_complete", sourceId: "kijiji", count: 1 },
      { type: "source_status", sourceId: "facebook", status: "needs_login", message: "Sign in", liveSessionUrl: "https://viewer.example.test" },
      { type: "source_status", sourceId: "facebook", status: "extracting", message: "Reading Facebook Marketplace listing cards…" },
      { type: "listing_batch", sourceId: "facebook", listings: [facebookListing] },
      { type: "source_complete", sourceId: "facebook", count: 1 },
      { type: "job_complete", jobId: "job-123" },
    ];

    const restored = searchReducer(initialSearchState, { type: "restore", state: saved });
    const resumed = replayedLog.reduce((state, event) => searchReducer(state, { type: "event", event }), restored);

    expect(resumed.status).toBe("complete");
    expect(resumed.listings).toEqual([listing, facebookListing]);
    expect(resumed.sourceProgress.facebook).toEqual({ phase: "complete", count: 1, message: "Search complete", liveSessionUrl: undefined });
    expect(resumed.sourceProgress.kijiji).toEqual({ phase: "complete", count: 1, message: "Search complete", liveSessionUrl: undefined });
  });

  it("uses the server's completion count over the client's running tally", () => {
    const started = searchReducer(initialSearchState, { type: "start", jobId: "job-123", sourceIds: ["facebook"] });
    const completed = searchReducer(started, { type: "event", event: { type: "source_complete", sourceId: "facebook", count: 12 } });

    expect(completed.sourceProgress.facebook).toMatchObject({ phase: "complete", count: 12 });
  });
});
