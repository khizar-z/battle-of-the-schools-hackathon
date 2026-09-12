import type { Listing, SearchIntent } from "@gehackathon/shared";

import { searchTermsForIntent } from "../search-policy.js";

const TRACKING_PARAMETERS = new Set(["fbclid", "gclid", "mc_cid", "mc_eid"]);

export function normalizeListing(listing: Listing): Listing {
  const url = new URL(listing.url);
  url.hash = "";
  for (const [name] of url.searchParams) {
    if (name.startsWith("utm_") || TRACKING_PARAMETERS.has(name)) url.searchParams.delete(name);
  }
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/$/, "");

  return {
    ...listing,
    title: listing.title.trim().replace(/\s+/g, " "),
    url: url.toString(),
    ...(listing.location ? { location: listing.location.trim().replace(/\s+/g, " ") } : {}),
    ...(listing.description ? { description: listing.description.trim().replace(/\s+/g, " ") } : {}),
    ...(listing.price === undefined ? {} : { price: Math.round(listing.price * 100) / 100 })
  };
}

export function dedupeListings(incoming: Listing[], existing: Listing[]): Listing[] {
  const accepted = [...existing];

  return incoming
    .map(normalizeListing)
    .filter((listing) => {
      if (accepted.some((candidate) => isDuplicate(listing, candidate))) return false;
      accepted.push(listing);
      return true;
    });
}

export function rankListings(listings: Listing[], intent: SearchIntent): Listing[] {
  return listings
    .map((listing) => ({ ...listing, rankScore: scoreListing(listing, intent) }))
    .sort((left, right) => (right.rankScore ?? 0) - (left.rankScore ?? 0));
}

export function scoreListing(listing: Listing, intent: SearchIntent): number {
  const text = `${listing.title} ${listing.description ?? ""}`;
  const targetTerms = tokens([searchTermsForIntent(intent), ...(intent.keywords ?? [])].join(" "));
  const textTerms = new Set(tokens(text));
  const matchingTerms = targetTerms.filter((term) => textTerms.has(term)).length;
  const relevance = targetTerms.length ? (matchingTerms / targetTerms.length) * 50 : 0;
  const exclusions = (intent.exclusions ?? []).some((term) => textTerms.has(normalizeText(term))) ? -40 : 0;

  let price = 0;
  if (listing.price !== undefined) {
    if (intent.maxPrice !== undefined) {
      price = Math.max(0, 20 * (1 - listing.price / Math.max(intent.maxPrice, 1)));
    } else {
      price = Math.max(0, 15 - Math.min(listing.price, 150) / 10);
    }
  }

  const recency = scoreRecency(listing.postedAt);
  const location = scoreLocation(listing.location, intent.location?.raw);
  const completeness = [listing.imageUrl, listing.description, listing.seller, listing.condition, listing.postedAt].filter(Boolean).length;

  return Math.max(0, Math.min(100, Math.round((relevance + exclusions + price + recency + location + completeness) * 100) / 100));
}

function isDuplicate(left: Listing, right: Listing): boolean {
  if (left.url === right.url) return true;
  if (left.price === undefined || right.price === undefined || !left.location || !right.location) return false;

  const largestPrice = Math.max(left.price, right.price, 1);
  const similarPrice = Math.abs(left.price - right.price) <= Math.max(5, largestPrice * 0.1);
  const sameLocation = normalizeText(left.location) === normalizeText(right.location);
  return similarPrice && sameLocation && jaccardSimilarity(tokens(left.title), tokens(right.title)) >= 0.8;
}

function scoreRecency(postedAt: string | undefined): number {
  if (!postedAt) return 0;
  const timestamp = Date.parse(postedAt);
  if (Number.isNaN(timestamp)) return 0;
  const ageDays = (Date.now() - timestamp) / 86_400_000;
  if (ageDays <= 1) return 15;
  if (ageDays <= 7) return 10;
  if (ageDays <= 30) return 5;
  return 0;
}

function scoreLocation(listingLocation: string | undefined, requestedLocation: string | undefined): number {
  if (!listingLocation || !requestedLocation) return 0;
  const listing = normalizeText(listingLocation);
  const requested = normalizeText(requestedLocation);
  return listing.includes(requested) || requested.includes(listing) ? 10 : 0;
}

function tokens(value: string): string[] {
  return normalizeText(value).split(" ").filter((token) => token.length > 1);
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function jaccardSimilarity(left: string[], right: string[]): number {
  const leftTerms = new Set(left);
  const rightTerms = new Set(right);
  const intersection = [...leftTerms].filter((term) => rightTerms.has(term)).length;
  const union = new Set([...leftTerms, ...rightTerms]).size;
  return union ? intersection / union : 0;
}
