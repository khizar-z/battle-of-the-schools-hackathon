import { describe, expect, it } from "vitest";

import { parseSearchIntent } from "./query-parser.js";

describe("parseSearchIntent", () => {
  it("extracts the useful constraints from a shopping request", () => {
    expect(parseSearchIntent("used dumbbells under $50 near Kensington Market pickup only")).toEqual({
      rawQuery: "used dumbbells under $50 near Kensington Market pickup only",
      item: "dumbbells",
      maxPrice: 50,
      currency: "CAD",
      location: { raw: "Kensington Market" },
      condition: "used",
      pickupOnly: true
    });
  });

  it("understands free listings without requiring every optional field", () => {
    expect(parseSearchIntent("free bicycle near downtown Toronto")).toMatchObject({
      item: "bicycle",
      maxPrice: 0,
      location: { raw: "downtown Toronto" },
      condition: "any"
    });
  });
});

