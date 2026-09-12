import { describe, expect, it } from "vitest";

import type { Listing } from "@gehackathon/shared";

import { filterListingsForIntent } from "../search-policy.js";
import { dedupeListings, rankListings } from "./listings.js";

const extractedAt = "2026-09-12T12:00:00.000Z";

function listing(overrides: Partial<Listing> = {}): Listing {
  return {
    id: "item-1",
    sourceId: "kijiji",
    sourceName: "Kijiji",
    title: "Used ThinkPad T480 laptop",
    price: 300,
    currency: "CAD",
    url: "https://example.com/listings/item-1",
    location: "Toronto, ON",
    extractedAt,
    ...overrides
  };
}

describe("listing aggregation", () => {
  it("removes canonical URL and near-identical cross-source duplicates", () => {
    const first = listing();
    const trackedUrlDuplicate = listing({ sourceId: "ebay", url: "https://example.com/listings/item-1?utm_source=test" });
    const probableDuplicate = listing({
      id: "item-2",
      sourceId: "facebook",
      sourceName: "Facebook Marketplace",
      title: "ThinkPad T480 used laptop",
      price: 305,
      url: "https://another.example.com/t480"
    });

    expect(dedupeListings([first, trackedUrlDuplicate, probableDuplicate], [])).toEqual([expect.objectContaining({ id: "item-1" })]);
  });

  it("ranks relevant, local, lower-priced listings first", () => {
    const ranked = rankListings(
      [
        listing({ title: "Office chair", price: 20, url: "https://example.com/chair" }),
        listing({
          title: "Used ThinkPad T480 laptop",
          price: 250,
          imageUrl: "https://images.example.com/t480.jpg",
          postedAt: "2026-09-12T11:00:00.000Z"
        })
      ],
      {
        rawQuery: "used ThinkPad under $400 near Toronto",
        item: "ThinkPad",
        maxPrice: 400,
        location: { raw: "Toronto" },
        condition: "used"
      }
    );

    expect(ranked[0]).toMatchObject({ title: "Used ThinkPad T480 laptop" });
    expect(ranked[0].rankScore).toBeGreaterThan(ranked[1].rankScore ?? 0);
  });

  it("removes mechanical housing parts from a rental search", () => {
    const intent = { rawQuery: "housing near uoft", item: "housing", searchMode: "housing" as const };
    const filtered = filterListingsForIntent(
      [
        listing({ title: "Transmission housing for Toyota", url: "https://example.com/part" }),
        listing({ title: "One-bedroom apartment near UofT", url: "https://example.com/apartment" })
      ],
      intent
    );

    expect(filtered).toEqual([expect.objectContaining({ title: "One-bedroom apartment near UofT" })]);
  });
});
