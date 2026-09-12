import type { SearchIntent } from "@gehackathon/shared";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

import { parseSearchIntent } from "./query-parser.js";

const modelIntentSchema = z.object({
  rawQuery: z.string(),
  item: z.string(),
  category: z.string().nullable(),
  searchMode: z.enum(["housing"]).nullable(),
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

export type LlmProvider = "anthropic" | "openai" | "fallback";

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
          "Extract secondhand-shopping search intent. Preserve the exact query. Infer only explicit constraints; use null for missing optional fields. These fields guide later relevance judgement and must not rewrite or narrow the user's raw marketplace query. Set condition to any unless new or used is explicit. Set searchMode to housing only for homes, apartments, rooms, rentals, sublets, or roommates; otherwise use null. Normalize UofT to University of Toronto in location.raw.",
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

export class AnthropicQueryParser implements QueryParser {
  private readonly fallback: QueryParser;

  constructor(
    private readonly client: Pick<Anthropic, "messages">,
    private readonly model = "claude-haiku-4-5",
    fallback: QueryParser = new FallbackQueryParser()
  ) {
    this.fallback = fallback;
  }

  async parse(rawQuery: string): Promise<SearchIntent> {
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 500,
        system:
          "Extract secondhand-shopping search intent. Preserve the exact query. Infer only explicit constraints; use null for missing optional fields. These fields guide later relevance judgement and must not rewrite or narrow the user's raw marketplace query. Set condition to any unless new or used is explicit. Set searchMode to housing only for homes, apartments, rooms, rentals, sublets, or roommates; otherwise use null. Normalize UofT to University of Toronto in location.raw.",
        messages: [{ role: "user", content: rawQuery }],
        tools: [
          {
            name: "parse_search_intent",
            description: "Return the user's shopping query as a structured search intent.",
            input_schema: MODEL_INTENT_JSON_SCHEMA
          }
        ],
        tool_choice: { type: "tool", name: "parse_search_intent" }
      });
      const toolUse = response.content.find(
        (block): block is Anthropic.ToolUseBlock =>
          block.type === "tool_use" && block.name === "parse_search_intent"
      );
      if (!toolUse) throw new Error("The model did not return a structured search intent.");

      return fromModelIntent(modelIntentSchema.parse(toolUse.input), rawQuery);
    } catch {
      return this.fallback.parse(rawQuery);
    }
  }
}

export function getConfiguredLlmProvider(environment: NodeJS.ProcessEnv = process.env): LlmProvider {
  if (environment.USE_LLM_PARSER === "false") return "fallback";

  const requestedProvider = environment.LLM_PROVIDER?.toLowerCase();
  if (requestedProvider === "anthropic") return environment.ANTHROPIC_API_KEY ? "anthropic" : "fallback";
  if (requestedProvider === "openai") return environment.OPENAI_API_KEY ? "openai" : "fallback";

  if (environment.OPENAI_API_KEY) return "openai";
  if (environment.ANTHROPIC_API_KEY) return "anthropic";
  return "fallback";
}

export function createQueryParser(environment: NodeJS.ProcessEnv = process.env): QueryParser {
  const provider = getConfiguredLlmProvider(environment);
  if (provider === "anthropic") {
    return new AnthropicQueryParser(
      new Anthropic({ apiKey: environment.ANTHROPIC_API_KEY }),
      environment.ANTHROPIC_MODEL ?? "claude-haiku-4-5"
    );
  }
  if (provider === "openai") {
    return new OpenAIQueryParser(
      new OpenAI({ apiKey: environment.OPENAI_API_KEY }),
      environment.OPENAI_MODEL ?? "gpt-5-mini"
    );
  }

  return new FallbackQueryParser();
}

const MODEL_INTENT_JSON_SCHEMA: Anthropic.Tool.InputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    rawQuery: { type: "string" },
    item: { type: "string" },
    category: { type: ["string", "null"] },
    searchMode: { type: ["string", "null"], enum: ["housing", null] },
    maxPrice: { type: ["number", "null"], minimum: 0 },
    minPrice: { type: ["number", "null"], minimum: 0 },
    currency: { type: ["string", "null"], minLength: 3, maxLength: 3 },
    location: {
      type: ["object", "null"],
      additionalProperties: false,
      properties: {
        raw: { type: "string" },
        latitude: { type: ["number", "null"], minimum: -90, maximum: 90 },
        longitude: { type: ["number", "null"], minimum: -180, maximum: 180 },
        radiusKm: { type: ["number", "null"], exclusiveMinimum: 0 }
      },
      required: ["raw", "latitude", "longitude", "radiusKm"]
    },
    condition: { type: "string", enum: ["new", "used", "any"] },
    keywords: { type: ["array", "null"], items: { type: "string" } },
    exclusions: { type: ["array", "null"], items: { type: "string" } },
    pickupOnly: { type: ["boolean", "null"] }
  },
  required: [
    "rawQuery",
    "item",
    "category",
    "searchMode",
    "maxPrice",
    "minPrice",
    "currency",
    "location",
    "condition",
    "keywords",
    "exclusions",
    "pickupOnly"
  ]
};

function fromModelIntent(modelIntent: z.infer<typeof modelIntentSchema>, rawQuery: string): SearchIntent {
  const location = modelIntent.location;
  return {
    rawQuery,
    item: modelIntent.item.trim() || parseSearchIntent(rawQuery).item,
    ...(modelIntent.category ? { category: modelIntent.category } : {}),
    ...(modelIntent.searchMode ? { searchMode: modelIntent.searchMode } : {}),
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
