import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";

import { AnthropicListingRanker } from "./listing-relevance-service.js";

const intent = { rawQuery: "housing near uoft", item: "housing", searchMode: "housing" as const };
const extractedAt = "2026-09-12T12:00:00.000Z";

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
});
