export interface SearchIntent {
  rawQuery: string;
  item: string;
  category?: string;
  searchMode?: "housing";
  maxPrice?: number;
  minPrice?: number;
  currency?: string;
  location?: {
    raw: string;
    latitude?: number;
    longitude?: number;
    radiusKm?: number;
  };
  condition?: "new" | "used" | "any";
  keywords?: string[];
  exclusions?: string[];
  pickupOnly?: boolean;
}

export interface MarketplaceSource {
  id: string;
  name: string;
  domain: string;
  enabled: boolean;
  requiresLogin?: boolean;
  status?: "ready" | "learning" | "needs_login" | "error";
}

export interface Listing {
  id: string;
  sourceId: string;
  sourceName: string;
  title: string;
  price?: number;
  currency?: string;
  imageUrl?: string;
  url: string;
  location?: string;
  seller?: string;
  sellerRating?: number;
  productRating?: number;
  condition?: string;
  postedAt?: string;
  description?: string;
  extractedAt: string;
  confidence?: number;
  relevanceScore?: number;
  imageQualityScore?: number;
  imageQualityConfidence?: number;
  imageQualityRationale?: string;
  rankScore?: number;
}

export type SearchEvent =
  | { type: "job_started"; jobId: string }
  | { type: "source_started"; sourceId: string; sourceName: string }
  | {
      type: "source_status";
      sourceId: string;
      status: "searching" | "extracting" | "ranking" | "complete" | "error" | "needs_login" | "skipped";
      message?: string;
      liveSessionUrl?: string;
    }
  | { type: "listing_batch"; sourceId: string; listings: Listing[] }
  | { type: "source_complete"; sourceId: string; count: number }
  | { type: "job_complete"; jobId: string };
