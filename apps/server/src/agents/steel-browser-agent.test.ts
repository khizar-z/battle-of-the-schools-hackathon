import { describe, expect, it } from "vitest";

import { parseSearchIntent } from "../query-parser.js";
import {
  EBAY_CARD_SELECTOR,
  createEbaySearchUrl,
  createFacebookSearchUrl,
  createKijijiSearchUrl,
  extractFacebookPriceText,
  hasEbayNoResultsText,
  hasKijijiNoResultsText,
  isEbayErrorPage,
  isFacebookMarketplaceHome,
  parseProductRating,
  parseSellerRating
} from "./steel-browser-agent.js";

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

  it("matches both eBay result-card layouts", () => {
    expect(EBAY_CARD_SELECTOR.split(",").map((part) => part.trim())).toEqual(["li.s-card", "li.s-item"]);
  });

  it("recognizes eBay's no-exact-match and error pages", () => {
    expect(hasEbayNoResultsText("0 results for housing near uoft\nNo exact matches found\nResults matching fewer words")).toBe(true);
    expect(hasEbayNoResultsText("1,240 results for used dumbbells")).toBe(false);
    expect(isEbayErrorPage("Error Page | eBay", "SORRY Something went wrong on our end 0.6fa71002")).toBe(true);
    expect(isEbayErrorPage("Used Dumbbells for sale | eBay", "0 results for used dumbbells")).toBe(false);
  });

  it("recognizes Kijiji's successful empty-results page", () => {
    expect(hasKijijiNoResultsText('No results for "a query with no matches"')).toBe(true);
    expect(hasKijijiNoResultsText("Sorry, we couldn't find any listings matching your search.")).toBe(true);
    expect(hasKijijiNoResultsText("Showing 123 listings in Toronto")).toBe(false);
  });

  it("builds a Facebook Marketplace search URL after login is available", () => {
    const url = new URL(createFacebookSearchUrl(parseSearchIntent("used road bike")));

    expect(url.origin + url.pathname).toBe("https://www.facebook.com/marketplace/search/");
    expect(url.searchParams.get("query")).toBe("used road bike");
  });

  it("only uses the Marketplace-field fallback after Facebook redirects search to its home page", () => {
    expect(isFacebookMarketplaceHome("https://www.facebook.com/marketplace/")).toBe(true);
    expect(isFacebookMarketplaceHome("https://www.facebook.com/marketplace/search/?query=used+bike")).toBe(false);
  });

  it("extracts currency-marked rent instead of a bedroom count", () => {
    expect(extractFacebookPriceText(["1 bedroom apartment near UofT", "$2,400 / month", "Toronto, ON"])).toBe("$2,400");
    expect(extractFacebookPriceText(["2 bedroom condo", "CA$1,850 monthly"])).toBe("CA$1,850");
    expect(extractFacebookPriceText(["3 bedroom apartment", "Toronto, ON"])).toBeUndefined();
  });

  it("normalizes product stars and seller feedback to five-star ratings", () => {
    expect(parseProductRating("4.7 out of 5 stars")).toBe(4.7);
    expect(parseSellerRating("99.2% positive feedback")).toBe(4.96);
  });
});
