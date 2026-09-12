import { z } from "zod";

import type { SearchEvent } from "./schemas.js";
import { marketplaceSourceSchema, searchEventSchema } from "./schemas.js";

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

export type CreateSearchRequest = z.infer<typeof createSearchRequestSchema>;
export type CreateSearchResponse = z.infer<typeof createSearchResponseSchema>;
export type SourcesResponse = z.infer<typeof sourcesResponseSchema>;

/**
 * The extension's boundary to the backend. The concrete browser client can be
 * implemented independently while preserving this streaming contract.
 */
export interface MarketplaceSearchApi {
  createSearch(request: CreateSearchRequest): Promise<CreateSearchResponse>;
  listSources(): Promise<SourcesResponse>;
  subscribeToSearchEvents(jobId: string, onEvent: (event: SearchEvent) => void): () => void;
}
