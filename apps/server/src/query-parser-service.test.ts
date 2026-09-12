import type Anthropic from "@anthropic-ai/sdk";
import type OpenAI from "openai";
import { describe, expect, it } from "vitest";

import {
  AnthropicQueryParser,
  FallbackQueryParser,
  OpenAIQueryParser,
  getConfiguredLlmProvider
} from "./query-parser-service.js";

describe("query parser service", () => {
  it("uses structured model output when available", async () => {
    const client = {
      responses: {
        parse: async () => ({
          output_parsed: {
            rawQuery: "ignore this copy",
            item: "ThinkPad",
            category: "laptops",
            searchMode: null,
            maxPrice: 400,
            minPrice: null,
            currency: "CAD",
            location: { raw: "Toronto", latitude: null, longitude: null, radiusKm: 10 },
            condition: "used",
            keywords: ["T480"],
            exclusions: null,
            pickupOnly: true
          }
        })
      }
    } as unknown as Pick<OpenAI, "responses">;
    const parser = new OpenAIQueryParser(client, "test-model");

    await expect(parser.parse("used ThinkPad under $400 near Toronto")).resolves.toMatchObject({
      rawQuery: "used ThinkPad under $400 near Toronto",
      item: "ThinkPad",
      maxPrice: 400,
      location: { raw: "Toronto", radiusKm: 10 },
      pickupOnly: true
    });
  });

  it("falls back to deterministic parsing when the model is unavailable", async () => {
    const client = { responses: { parse: async () => { throw new Error("network unavailable"); } } } as unknown as Pick<OpenAI, "responses">;
    const parser = new OpenAIQueryParser(client, "test-model", new FallbackQueryParser());

    await expect(parser.parse("free bicycle near downtown Toronto")).resolves.toMatchObject({ item: "bicycle", maxPrice: 0 });
  });

  it("uses a forced Claude tool call when configured", async () => {
    const client = {
      messages: {
        create: async () => ({
          content: [
            {
              type: "tool_use",
              name: "parse_search_intent",
              input: {
                rawQuery: "copy ignored",
                item: "Nintendo Switch",
                category: "gaming",
                searchMode: null,
                maxPrice: 250,
                minPrice: null,
                currency: "CAD",
                location: { raw: "Toronto", latitude: null, longitude: null, radiusKm: null },
                condition: "used",
                keywords: ["OLED"],
                exclusions: null,
                pickupOnly: null
              }
            }
          ]
        })
      }
    } as unknown as Pick<Anthropic, "messages">;
    const parser = new AnthropicQueryParser(client, "test-model");

    await expect(parser.parse("used Nintendo Switch OLED under $250 near Toronto")).resolves.toMatchObject({
      rawQuery: "used Nintendo Switch OLED under $250 near Toronto",
      item: "Nintendo Switch",
      maxPrice: 250,
      location: { raw: "Toronto" },
      keywords: ["OLED"]
    });
  });

  it("selects Claude only when explicitly configured and keyed", () => {
    expect(getConfiguredLlmProvider({ LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "test" })).toBe("anthropic");
    expect(getConfiguredLlmProvider({ LLM_PROVIDER: "anthropic" })).toBe("fallback");
    expect(getConfiguredLlmProvider({ OPENAI_API_KEY: "test", ANTHROPIC_API_KEY: "test" })).toBe("openai");
  });
});
