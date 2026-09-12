import type { Listing, MarketplaceSource, SearchEvent } from "@gehackathon/shared";

export type SearchStatus = "idle" | "running" | "complete" | "error";
export type SourcePhase = "idle" | "searching" | "extracting" | "complete" | "error" | "needs_login";

export interface SourceProgress {
  phase: SourcePhase;
  count: number;
  message?: string;
  liveSessionUrl?: string;
}

export interface SearchState {
  query: string;
  status: SearchStatus;
  jobId?: string;
  selectedSourceIds: string[];
  sourceProgress: Record<string, SourceProgress>;
  listings: Listing[];
  error?: string;
}

export const initialSearchState: SearchState = {
  query: "",
  status: "idle",
  selectedSourceIds: [],
  sourceProgress: {},
  listings: [],
};

export type SearchAction =
  | { type: "set_query"; query: string }
  | { type: "set_sources"; sourceIds: string[] }
  | { type: "toggle_source"; sourceId: string }
  | { type: "start"; jobId: string; sourceIds: string[] }
  | { type: "replace_listings"; listings: Listing[] }
  | { type: "event"; event: SearchEvent }
  | { type: "error"; message: string };

const withProgress = (state: SearchState, sourceId: string, update: Partial<SourceProgress>): SearchState => {
  const previous = state.sourceProgress[sourceId];
  const base: SourceProgress = previous ?? { phase: "idle", count: 0 };
  return {
    ...state,
    sourceProgress: {
      ...state.sourceProgress,
      [sourceId]: { ...base, ...update },
    },
  };
};

export function searchReducer(state: SearchState, action: SearchAction): SearchState {
  switch (action.type) {
    case "set_query":
      return { ...state, query: action.query };
    case "set_sources":
      return { ...state, selectedSourceIds: action.sourceIds };
    case "toggle_source":
      return {
        ...state,
        selectedSourceIds: state.selectedSourceIds.includes(action.sourceId)
          ? state.selectedSourceIds.filter((id) => id !== action.sourceId)
          : [...state.selectedSourceIds, action.sourceId],
      };
    case "start":
      return {
        ...state,
        status: "running",
        error: undefined,
        jobId: action.jobId,
        selectedSourceIds: action.sourceIds,
        listings: [],
        sourceProgress: Object.fromEntries(action.sourceIds.map((id) => [id, { phase: "idle", count: 0 }])),
      };
    case "replace_listings":
      return { ...state, listings: action.listings };
    case "error":
      return { ...state, status: "error", error: action.message };
    case "event": {
      const event = action.event;
      if (event.type === "job_started") return { ...state, status: "running", jobId: event.jobId };
      if (event.type === "source_started") return withProgress(state, event.sourceId, { phase: "searching", message: "Finding listings…" });
      if (event.type === "source_status") {
        return withProgress(state, event.sourceId, {
          phase: event.status,
          message: event.message,
          liveSessionUrl: event.liveSessionUrl,
        });
      }
      if (event.type === "listing_batch") {
        const current = state.sourceProgress[event.sourceId] ?? { phase: "extracting" as const, count: 0 };
        const knownUrls = new Set(state.listings.map((listing) => listing.url));
        const newListings = event.listings.filter((listing) => !knownUrls.has(listing.url));
        return withProgress(
          { ...state, listings: [...state.listings, ...newListings] },
          event.sourceId,
          { phase: "extracting", count: current.count + newListings.length, message: "Reading listing details…" },
        );
      }
      if (event.type === "source_complete") return withProgress(state, event.sourceId, { phase: "complete", count: event.count, message: "Search complete" });
      if (event.type === "job_complete") return { ...state, status: "complete" };
      return state;
    }
  }
}

export function sourcesForState(sources: MarketplaceSource[], state: SearchState): MarketplaceSource[] {
  return sources.map((source) => ({ ...source, enabled: state.selectedSourceIds.includes(source.id) }));
}
