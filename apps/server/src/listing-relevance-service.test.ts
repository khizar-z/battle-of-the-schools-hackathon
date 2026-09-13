import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";

import type { Listing } from "@gehackathon/shared";

import { AnthropicListingRanker, FallbackListingRanker } from "./listing-relevance-service.js";

const intent = { rawQuery: "housing near uoft", item: "housing", searchMode: "housing" as const };
const extractedAt = "2026-09-12T12:00:00.000Z";

const room: Listing = { id: "rental", sourceId: "kijiji", sourceName: "Kijiji", title: "Vacant rooms near UofT", price: 900, url: "https://example.com/rental", extractedAt, confidence: 0.9 };
const nearMatchCard: Listing = { id: "mtg", sourceId: "ebay", sourceName: "eBay", title: "MTG Duskmourn: House of Horror", price: 1, url: "https://example.com/mtg", extractedAt, confidence: 0.6 };

function clientReturning(rankings: unknown): Pick<Anthropic, "messages"> {
  return {
    messages: { create: async () => ({ content: [{ type: "tool_use", name: "rank_listings", input: { rankings } }] }) }
  } as unknown as Pick<Anthropic, "messages">;
}

describe("listing relevance service", () => {
  it("uses Claude's semantic decision to remove keyword false positives", async () => {
    const client = {
      messages: {
        create: async () => ({
          content: [{
            type: "tool_use",
            name: "rank_listings",
            input: {
              rankings: [
                { index: 0, relevant: false, relevanceScore: 2 },
                { index: 1, relevant: true, relevanceScore: 97 }
              ]
            }
          }]
        })
      }
    } as unknown as Pick<Anthropic, "messages">;
    const ranker = new AnthropicListingRanker(client, "test-model");

    await expect(ranker.rank(intent, [
      { id: "part", sourceId: "facebook", sourceName: "Facebook", title: "Transmission housing for Toyota", url: "https://example.com/part", extractedAt },
      { id: "rental", sourceId: "facebook", sourceName: "Facebook", title: "One-bedroom apartment near UofT", url: "https://example.com/rental", extractedAt }
    ])).resolves.toEqual([
      expect.objectContaining({ id: "rental", relevanceScore: 97 })
    ]);
  });

  it("treats listings the model skipped as not relevant instead of accepting the whole batch", async () => {
    const ranker = new AnthropicListingRanker(clientReturning([{ index: 0, relevant: true, relevanceScore: 88 }]), "test-model");

    await expect(ranker.rank(intent, [room, nearMatchCard])).resolves.toEqual([expect.objectContaining({ id: "rental" })]);
  });

  it("retries a failed model call once, then falls back without near-match listings", async () => {
    let calls = 0;
    const failingClient = {
      messages: { create: async () => { calls += 1; throw new Error("429 rate limited"); } }
    } as unknown as Pick<Anthropic, "messages">;
    const ranker = new AnthropicListingRanker(failingClient, "test-model", new FallbackListingRanker(), { retryDelayMs: 1 });

    const kept = await ranker.rank(intent, [room, nearMatchCard]);

    expect(calls).toBe(2);
    expect(kept.map((listing) => listing.id)).toEqual(["rental"]);
  });

  it("fallback ranking keeps marketplace matches but never near matches", async () => {
    const kept = await new FallbackListingRanker().rank({ ...intent, maxPrice: 1_000 }, [
      room,
      nearMatchCard,
      { ...room, id: "too-expensive", price: 1_500 },
      { ...room, id: "unknown-confidence", confidence: undefined }
    ]);

    expect(kept.map((listing) => listing.id)).toEqual(["rental", "unknown-confidence"]);
  });
});
