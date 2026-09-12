import { describe, expect, it } from "vitest";

import { parseSearchIntent } from "../query-parser.js";
import { createEbaySearchUrl, createKijijiSearchUrl } from "./steel-browser-agent.js";

describe("marketplace browser recipes", () => {
  it("builds an eBay query with supported price and condition filters", () => {
    const url = new URL(createEbaySearchUrl(parseSearchIntent("used dumbbells under $50")));

    expect(url.origin + url.pathname).toBe("https://www.ebay.ca/sch/i.html");
    expect(url.searchParams.get("_nkw")).toBe("dumbbells");
    expect(url.searchParams.get("_udhi")).toBe("50");
    expect(url.searchParams.get("LH_ItemCondition")).toBe("3000");
  });

  it("builds a Toronto Kijiji result URL from the parsed item", () => {
    expect(createKijijiSearchUrl(parseSearchIntent("used dumbbells near downtown Toronto"))).toBe(
      "https://www.kijiji.ca/b-gta-greater-toronto-area/dumbbells/k0l1700272"
    );
  });
});
