import { describe, expect, it } from "vitest";

import { listingSchema, searchEventSchema, searchIntentSchema } from "./schemas.js";

describe("shared schemas", () => {
  it("accepts a partial but useful search intent", () => {
    expect(
      searchIntentSchema.parse({
        rawQuery: "free bicycle near downtown Toronto",
        item: "bicycle",
        maxPrice: 0,
        location: { raw: "downtown Toronto" },
        condition: "any"
      })
    ).toMatchObject({ item: "bicycle", maxPrice: 0 });
  });

  it("rejects listings without a canonical URL", () => {
    expect(() =>
      listingSchema.parse({
        id: "1",
        sourceId: "kijiji",
        sourceName: "Kijiji",
        title: "Bike",
        extractedAt: new Date().toISOString()
      })
    ).toThrow();
  });

  it("accepts a listing batch event", () => {
    expect(
      searchEventSchema.parse({ type: "listing_batch", sourceId: "ebay", listings: [] })
    ).toEqual({ type: "listing_batch", sourceId: "ebay", listings: [] });
  });
});

