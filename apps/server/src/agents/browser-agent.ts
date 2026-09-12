import type { Listing, MarketplaceSource, SearchIntent } from "@gehackathon/shared";

export type AgentPhase = "searching" | "extracting";

export interface AgentSearchContext {
  sourceIndex: number;
  signal: AbortSignal;
  reportStatus: (phase: AgentPhase, message?: string, liveSessionUrl?: string) => void;
}

/**
 * The only browser-search boundary the orchestrator knows about. Implementations
 * may use fixtures, deterministic recipes, or an agentic browser session.
 */
export interface BrowserAgent {
  search(source: MarketplaceSource, intent: SearchIntent, context: AgentSearchContext): Promise<Listing[]>;
}

export class BrowserAgentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowserAgentError";
  }
}

