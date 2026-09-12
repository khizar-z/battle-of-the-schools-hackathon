import type { Listing, MarketplaceSource, SearchIntent } from "@gehackathon/shared";

const HOUSING_TERMS = new Set([
  "apartment",
  "apartments",
  "basement",
  "bedroom",
  "condo",
  "condos",
  "house",
  "lease",
  "rental",
  "rentals",
  "room",
  "rooms",
  "roommate",
  "sublet",
  "sublease",
  "unit"
]);

/** eBay is deliberately excluded from local-rental searches; Facebook and
 * generic sources can still search and are screened by the housing relevance gate. */
export function unsupportedSourceReason(source: MarketplaceSource, intent: SearchIntent): string | undefined {
  if (intent.searchMode !== "housing" || source.id !== "ebay") return undefined;
  return `${source.name} is skipped: it is not a supported local-rental source.`;
}

export function searchTermsForIntent(intent: SearchIntent): string {
  if (intent.searchMode !== "housing") return intent.item;

  const explicitHousingTerms = tokenize(intent.item).filter((term) => HOUSING_TERMS.has(term));
  const itemTerms = explicitHousingTerms.length ? intent.item : "apartment rental room";
  return [itemTerms, intent.location?.raw].filter(Boolean).join(" ");
}

/** Reject keyword-only false positives such as automotive "housing" parts. */
export function filterListingsForIntent(listings: Listing[], intent: SearchIntent): Listing[] {
  if (intent.searchMode !== "housing") return listings;
  return listings.filter((listing) => {
    const listingTerms = new Set(tokenize(`${listing.title} ${listing.description ?? ""}`));
    return [...HOUSING_TERMS].some((term) => listingTerms.has(term));
  });
}

function tokenize(value: string): string[] {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter(Boolean);
}
