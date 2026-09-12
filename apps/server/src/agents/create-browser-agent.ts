import { BrowserAgentError, type BrowserAgent } from "./browser-agent.js";
import { MockBrowserAgent } from "./mock-browser-agent.js";
import { SteelBrowserAgent } from "./steel-browser-agent.js";
import { createRecipeStore, type RecipeStore } from "../recipes/recipe-store.js";

export interface CreateBrowserAgentOptions {
  mockAgents?: boolean;
  mockDelayMs?: number;
  steelApiKey?: string;
  recipeStore?: RecipeStore;
}

export function createBrowserAgent(options: CreateBrowserAgentOptions = {}): BrowserAgent {
  const mockAgents = options.mockAgents ?? process.env.MOCK_AGENTS !== "false";
  if (mockAgents) return new MockBrowserAgent(options.mockDelayMs);

  const steelApiKey = options.steelApiKey ?? process.env.STEEL_API_KEY;
  if (!steelApiKey) {
    return {
      async search() {
        throw new BrowserAgentError("STEEL_API_KEY is required when MOCK_AGENTS=false.");
      }
    };
  }

  return new SteelBrowserAgent({ apiKey: steelApiKey, recipeStore: options.recipeStore ?? createRecipeStore() });
}
