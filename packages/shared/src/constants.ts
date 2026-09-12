import type { MarketplaceSource } from "./schemas.js";

export const DEFAULT_SOURCES: MarketplaceSource[] = [
  {
    id: "facebook",
    name: "Facebook Marketplace",
    domain: "facebook.com/marketplace",
    enabled: true,
    requiresLogin: true,
    status: "needs_login"
  },
  {
    id: "kijiji",
    name: "Kijiji",
    domain: "kijiji.ca",
    enabled: true,
    status: "ready"
  },
  {
    id: "ebay",
    name: "eBay",
    domain: "ebay.ca",
    enabled: true,
    status: "ready"
  },
  {
    id: "craigslist",
    name: "Craigslist",
    domain: "craigslist.org",
    enabled: false,
    status: "learning"
  }
];

