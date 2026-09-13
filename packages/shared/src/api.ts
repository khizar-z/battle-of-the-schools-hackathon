import { z } from "zod";

import type { SearchEvent } from "./schemas.js";
import { listingSchema, marketplaceSourceSchema, searchEventSchema, searchIntentSchema } from "./schemas.js";

export const createSearchRequestSchema = z.object({
  query: z.string().trim().min(1).max(500),
  sources: z.array(z.string().min(1)).min(1)
});

export const createSearchResponseSchema = z.object({
  jobId: z.string().min(1)
});

export const sourcesResponseSchema = z.object({
  sources: z.array(marketplaceSourceSchema)
});

export const searchEventsResponseSchema = z.array(searchEventSchema);

export const searchJobSnapshotSchema = z.object({
  jobId: z.string().min(1),
  status: z.enum(["running", "complete"]),
  intent: searchIntentSchema,
  listings: z.array(listingSchema)
});

export type CreateSearchRequest = z.infer<typeof createSearchRequestSchema>;
export type CreateSearchResponse = z.infer<typeof createSearchResponseSchema>;
export type SourcesResponse = z.infer<typeof sourcesResponseSchema>;
export type SearchJobSnapshot = z.infer<typeof searchJobSnapshotSchema>;

/**
 * The extension's boundary to the backend. The concrete browser client can be
 * implemented independently while preserving this streaming contract.
 */
export interface MarketplaceSearchApi {
  createSearch(request: CreateSearchRequest): Promise<CreateSearchResponse>;
  listSources(): Promise<SourcesResponse>;
  getSearchJob(jobId: string): Promise<SearchJobSnapshot>;
  cancelSearch(jobId: string): Promise<void>;
  subscribeToSearchEvents(jobId: string, onEvent: (event: SearchEvent) => void): () => void;
}
