import { describe, expect, it } from "vitest";

import { parseSearchIntent } from "../query-parser.js";
import { createEbaySearchUrl, createFacebookSearchUrl, createKijijiSearchUrl, extractFacebookPriceText } from "./steel-browser-agent.js";

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

  it("builds a Facebook Marketplace search URL after login is available", () => {
    const url = new URL(createFacebookSearchUrl(parseSearchIntent("used road bike")));

    expect(url.origin + url.pathname).toBe("https://www.facebook.com/marketplace/search/");
    expect(url.searchParams.get("query")).toBe("used road bike");
  });

  it("extracts currency-marked rent instead of a bedroom count", () => {
    expect(extractFacebookPriceText(["1 bedroom apartment near UofT", "$2,400 / month", "Toronto, ON"])).toBe("$2,400");
    expect(extractFacebookPriceText(["2 bedroom condo", "CA$1,850 monthly"])).toBe("CA$1,850");
    expect(extractFacebookPriceText(["3 bedroom apartment", "Toronto, ON"])).toBeUndefined();
  });
});
