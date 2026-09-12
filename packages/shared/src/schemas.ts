import { z } from "zod";

export const searchIntentSchema = z.object({
  rawQuery: z.string().min(1),
  item: z.string().min(1),
  category: z.string().min(1).optional(),
  searchMode: z.enum(["housing"]).optional(),
  maxPrice: z.number().nonnegative().optional(),
  minPrice: z.number().nonnegative().optional(),
  currency: z.string().length(3).optional(),
  location: z
    .object({
      raw: z.string().min(1),
      latitude: z.number().min(-90).max(90).optional(),
      longitude: z.number().min(-180).max(180).optional(),
      radiusKm: z.number().positive().optional()
    })
    .optional(),
  condition: z.enum(["new", "used", "any"]).optional(),
  keywords: z.array(z.string().min(1)).optional(),
  exclusions: z.array(z.string().min(1)).optional(),
  pickupOnly: z.boolean().optional()
});

export const marketplaceSourceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  domain: z.string().min(1),
  enabled: z.boolean(),
  requiresLogin: z.boolean().optional(),
  status: z.enum(["ready", "learning", "needs_login", "error"]).optional()
});

export const listingSchema = z.object({
  id: z.string().min(1),
  sourceId: z.string().min(1),
  sourceName: z.string().min(1),
  title: z.string().min(1),
  price: z.number().nonnegative().optional(),
  currency: z.string().length(3).optional(),
  imageUrl: z.string().url().optional(),
  url: z.string().url(),
  location: z.string().min(1).optional(),
  seller: z.string().min(1).optional(),
  condition: z.string().min(1).optional(),
  postedAt: z.string().datetime().optional(),
  description: z.string().min(1).optional(),
  extractedAt: z.string().datetime(),
  confidence: z.number().min(0).max(1).optional(),
  relevanceScore: z.number().min(0).max(100).optional(),
  rankScore: z.number().min(0).max(100).optional()
});

export const searchEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("job_started"), jobId: z.string().min(1) }),
  z.object({
    type: z.literal("source_started"),
    sourceId: z.string().min(1),
    sourceName: z.string().min(1)
  }),
  z.object({
    type: z.literal("source_status"),
    sourceId: z.string().min(1),
    status: z.enum(["searching", "extracting", "ranking", "complete", "error", "needs_login", "skipped"]),
    message: z.string().min(1).optional(),
    liveSessionUrl: z.string().url().optional()
  }),
  z.object({
    type: z.literal("listing_batch"),
    sourceId: z.string().min(1),
    listings: z.array(listingSchema)
  }),
  z.object({
    type: z.literal("source_complete"),
    sourceId: z.string().min(1),
    count: z.number().int().nonnegative()
  }),
  z.object({ type: z.literal("job_complete"), jobId: z.string().min(1) })
]);

export type SearchIntent = z.infer<typeof searchIntentSchema>;
export type MarketplaceSource = z.infer<typeof marketplaceSourceSchema>;
export type Listing = z.infer<typeof listingSchema>;
export type SearchEvent = z.infer<typeof searchEventSchema>;
