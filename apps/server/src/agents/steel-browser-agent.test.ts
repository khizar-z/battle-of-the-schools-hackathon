import { describe, expect, it } from "vitest";

import { parseSearchIntent } from "../query-parser.js";
import { createEbaySearchUrl, createKijijiSearchUrl } from "./steel-browser-agent.js";

describe("marketplace browser recipes", () => {
  it("uses the original request without imposing marketplace filters", () => {
    const url = new URL(createEbaySearchUrl(parseSearchIntent("used dumbbells under $50")));

    expect(url.origin + url.pathname).toBe("https://www.ebay.ca/sch/i.html");
    expect(url.searchParams.get("_nkw")).toBe("used dumbbells under $50");
    expect(url.searchParams.get("_udhi")).toBeNull();
    expect(url.searchParams.get("LH_ItemCondition")).toBeNull();
  });

  it("builds a Toronto Kijiji result URL from the original request", () => {
    expect(createKijijiSearchUrl(parseSearchIntent("used dumbbells near downtown Toronto"))).toBe(
      "https://www.kijiji.ca/b-gta-greater-toronto-area/used-dumbbells-near-downtown-toronto/k0l1700272"
    );
  });

  it("keeps a housing query broad instead of forcing it into a rental category", () => {
    expect(createKijijiSearchUrl(parseSearchIntent("housing near uoft"))).toBe(
      "https://www.kijiji.ca/b-gta-greater-toronto-area/housing-near-uoft/k0l1700272"
    );
  });
});
