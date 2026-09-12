import type { SearchIntent } from "@gehackathon/shared";

const PRICE_PATTERN = /\b(?:under|below|less than|up to|max(?:imum)? of?)\s*(?:c\$|cad\s*|\$)?\s*([\d,.]+)/i;
const MIN_PRICE_PATTERN = /\b(?:over|above|more than|at least|min(?:imum)? of?)\s*(?:c\$|cad\s*|\$)?\s*([\d,.]+)/i;
const LOCATION_PATTERN = /\b(?:near|around|in)\s+(.+?)(?=\s+\b(?:under|below|less than|up to|max(?:imum)?|over|above|more than|at least|min(?:imum)?|pickup only)\b|$)/i;

function parsePrice(value: string | undefined): number | undefined {
  if (!value) return undefined;

  const parsed = Number.parseFloat(value.replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * A deliberately conservative local parser. It keeps search working before an
 * LLM is configured and supplies a predictable fallback when one is unavailable.
 */
export function parseSearchIntent(rawQuery: string): SearchIntent {
  const raw = rawQuery.trim().replace(/\s+/g, " ");
  const lower = raw.toLowerCase();
  const maxPriceMatch = lower.match(PRICE_PATTERN);
  const minPriceMatch = lower.match(MIN_PRICE_PATTERN);
  const locationMatch = raw.match(LOCATION_PATTERN);
  const hasFreePrice = /\bfree\b/i.test(raw);
  const condition = /\bnew\b/i.test(raw) ? "new" : /\bused\b|secondhand|pre-owned/i.test(raw) ? "used" : "any";

  let item = raw
    .replace(LOCATION_PATTERN, " ")
    .replace(PRICE_PATTERN, " ")
    .replace(MIN_PRICE_PATTERN, " ")
    .replace(/\b(?:free|new|used|secondhand|pre-owned|pickup only)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  // A vague request is still a valid search. Preserve the original words rather
  // than rejecting it because no specific attributes were recognized.
  if (!item) item = raw;

  const includesDollar = /(?:c\$|cad\s*|\$)/i.test(raw);

  return {
    rawQuery: raw,
    item,
    ...(hasFreePrice ? { maxPrice: 0 } : { maxPrice: parsePrice(maxPriceMatch?.[1]) }),
    ...(minPriceMatch ? { minPrice: parsePrice(minPriceMatch[1]) } : {}),
    ...(includesDollar ? { currency: "CAD" } : {}),
    ...(locationMatch?.[1] ? { location: { raw: locationMatch[1].trim() } } : {}),
    condition,
    ...(lower.includes("pickup only") ? { pickupOnly: true } : {})
  };
}

