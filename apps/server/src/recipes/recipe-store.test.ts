import { describe, expect, it } from "vitest";

import { InMemoryRecipeStore } from "./recipe-store.js";

describe("recipe store", () => {
  it("normalizes domains and returns saved recipes", async () => {
    const store = new InMemoryRecipeStore();
    await store.save({
      domain: "https://www.example.com/marketplace",
      searchSteps: [{ action: "fill", target: "input[type=search]" }],
      resultSelector: "article",
      learnedAt: "2026-09-12T12:00:00.000Z"
    });

    await expect(store.get("example.com")).resolves.toMatchObject({ resultSelector: "article" });
  });
});
