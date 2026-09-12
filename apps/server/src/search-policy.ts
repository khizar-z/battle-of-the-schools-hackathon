import type { SearchIntent } from "@gehackathon/shared";

/**
 * The marketplace receives the request in the user's own words. Marketplace
 * search engines have different syntax and inventory, so pre-translating the
 * query into a restrictive taxonomy hides useful candidates before Scout can
 * inspect them.
 */
export function marketplaceSearchTerms(intent: SearchIntent): string {
  return intent.rawQuery.trim() || intent.item.trim();
}

/** Terms used only by the deterministic fallback ranker. */
export function relevanceTermsForIntent(intent: SearchIntent): string {
  return [intent.item, ...(intent.keywords ?? []), intent.location?.raw]
    .filter(Boolean)
    .join(" ");
}
