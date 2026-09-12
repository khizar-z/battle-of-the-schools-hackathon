import type { SearchIntent } from "@gehackathon/shared";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

import { parseSearchIntent } from "./query-parser.js";

const modelIntentSchema = z.object({
  rawQuery: z.string(),
  item: z.string(),
  category: z.string().nullable(),
  maxPrice: z.number().nonnegative().nullable(),
  minPrice: z.number().nonnegative().nullable(),
  currency: z.string().length(3).nullable(),
  location: z
    .object({
      raw: z.string(),
      latitude: z.number().min(-90).max(90).nullable(),
      longitude: z.number().min(-180).max(180).nullable(),
      radiusKm: z.number().positive().nullable()
    })
    .nullable(),
  condition: z.enum(["new", "used", "any"]),
  keywords: z.array(z.string()).nullable(),
  exclusions: z.array(z.string()).nullable(),
  pickupOnly: z.boolean().nullable()
});

export interface QueryParser {
  parse(rawQuery: string): Promise<SearchIntent>;
}

export class FallbackQueryParser implements QueryParser {
  async parse(rawQuery: string): Promise<SearchIntent> {
    return parseSearchIntent(rawQuery);
  }
}

export class OpenAIQueryParser implements QueryParser {
  private readonly fallback: QueryParser;

  constructor(
    private readonly client: Pick<OpenAI, "responses">,
    private readonly model = "gpt-5-mini",
    fallback: QueryParser = new FallbackQueryParser()
  ) {
    this.fallback = fallback;
  }

  async parse(rawQuery: string): Promise<SearchIntent> {
    try {
      const response = await this.client.responses.parse({
        model: this.model,
        store: false,
        instructions:
          "Extract secondhand-shopping search intent. Preserve the exact query. Infer only explicit constraints; use null for missing optional fields. Set condition to any unless new or used is explicit.",
        input: rawQuery,
        text: { format: zodTextFormat(modelIntentSchema, "search_intent") }
      });
      if (!response.output_parsed) throw new Error("The model did not return a structured search intent.");

      return fromModelIntent(response.output_parsed, rawQuery);
    } catch {
      return this.fallback.parse(rawQuery);
    }
  }
}

export function createQueryParser(): QueryParser {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || process.env.USE_LLM_PARSER === "false") return new FallbackQueryParser();

  return new OpenAIQueryParser(new OpenAI({ apiKey }), process.env.OPENAI_MODEL ?? "gpt-5-mini");
}

function fromModelIntent(modelIntent: z.infer<typeof modelIntentSchema>, rawQuery: string): SearchIntent {
  const location = modelIntent.location;
  return {
    rawQuery,
    item: modelIntent.item.trim() || parseSearchIntent(rawQuery).item,
    ...(modelIntent.category ? { category: modelIntent.category } : {}),
    ...(modelIntent.maxPrice === null ? {} : { maxPrice: modelIntent.maxPrice }),
    ...(modelIntent.minPrice === null ? {} : { minPrice: modelIntent.minPrice }),
    ...(modelIntent.currency ? { currency: modelIntent.currency } : {}),
    ...(location
      ? {
          location: {
            raw: location.raw,
            ...(location.latitude === null ? {} : { latitude: location.latitude }),
            ...(location.longitude === null ? {} : { longitude: location.longitude }),
            ...(location.radiusKm === null ? {} : { radiusKm: location.radiusKm })
          }
        }
      : {}),
    condition: modelIntent.condition,
    ...(modelIntent.keywords?.length ? { keywords: modelIntent.keywords } : {}),
    ...(modelIntent.exclusions?.length ? { exclusions: modelIntent.exclusions } : {}),
    ...(modelIntent.pickupOnly === null ? {} : { pickupOnly: modelIntent.pickupOnly })
  };
}
