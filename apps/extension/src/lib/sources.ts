import type { MarketplaceSource } from "@gehackathon/shared";

export const defaultSources: MarketplaceSource[] = [
  { id: "facebook", name: "Facebook Marketplace", domain: "facebook.com", enabled: true, requiresLogin: true, status: "ready" },
  { id: "kijiji", name: "Kijiji", domain: "kijiji.ca", enabled: true, status: "ready" },
  { id: "ebay", name: "eBay", domain: "ebay.com", enabled: true, status: "ready" },
  { id: "craigslist", name: "Craigslist", domain: "craigslist.org", enabled: false, status: "ready" },
];
