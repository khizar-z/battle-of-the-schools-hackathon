import type { Listing, MarketplaceSource, SearchEvent, SearchJobSnapshot } from "@gehackathon/shared";
import { DEFAULT_SOURCES } from "@gehackathon/shared";

const baseUrl = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "");
const mockMode = !baseUrl;
const mockJobs = new Map<string, string[]>();

function apiEndpoint(path: string): string {
  return `${baseUrl}${path}`;
}

async function fetchApi(path: string, init?: RequestInit): Promise<Response> {
  const endpoint = apiEndpoint(path);
  try {
    return await fetch(endpoint, init);
  } catch (error) {
    // Fetch hides the useful browser cause from the popup. Keep the complete
    // endpoint and browser error in the extension console for troubleshooting.
    console.error("[Scout] API request failed", { endpoint, error });
    throw new Error(
      `Cannot reach the Scout API at ${baseUrl}. Start the server and rebuild the extension with VITE_API_BASE_URL set to that address.`
    );
  }
}

/** An HTTP-level failure from the Scout API, keeping the status for callers to act on. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

function responseError(action: string, endpoint: string, response: Response): ApiError {
  console.error("[Scout] API returned an error", { action, endpoint, status: response.status, statusText: response.statusText });
  return new ApiError(`${action} (HTTP ${response.status}). See the extension console for details.`, response.status);
}

export interface SearchApi {
  getSources(): Promise<MarketplaceSource[]>;
  startSearch(query: string, sources: string[]): Promise<{ jobId: string }>;
  getSearchJob(jobId: string): Promise<SearchJobSnapshot>;
  cancelSearch(jobId: string): Promise<void>;
  subscribe(jobId: string, onEvent: (event: SearchEvent) => void, onError: (error: Error) => void): () => void;
  isMock: boolean;
}

const timestamp = "2026-09-12T14:30:00.000Z";
const listingsBySource: Record<string, Listing[]> = {
  facebook: [
    { id: "fb-1", sourceId: "facebook", sourceName: "Facebook Marketplace", title: "Adjustable dumbbells — 40 lb set", price: 45, currency: "CAD", location: "Kensington Market", condition: "Used · Good", postedAt: "2h ago", url: "https://www.facebook.com/marketplace/", extractedAt: timestamp },
    { id: "fb-2", sourceId: "facebook", sourceName: "Facebook Marketplace", title: "Cast iron weight plates, 80 lb", price: 40, currency: "CAD", location: "Toronto", condition: "Used · Good", postedAt: "5h ago", url: "https://www.facebook.com/marketplace/toronto/", extractedAt: timestamp },
  ],
  kijiji: [
    { id: "kj-1", sourceId: "kijiji", sourceName: "Kijiji", title: "Dumbbell set with storage rack", price: 50, currency: "CAD", location: "Downtown Toronto", condition: "Used", postedAt: "Today", url: "https://www.kijiji.ca/", extractedAt: timestamp },
    { id: "kj-2", sourceId: "kijiji", sourceName: "Kijiji", title: "York 25 lb dumbbells", price: 35, currency: "CAD", location: "Little Italy", condition: "Used", postedAt: "Today", url: "https://www.kijiji.ca/b-gta-greater-toronto-area/dumbbells/k0l1700272", extractedAt: timestamp },
  ],
  ebay: [
    { id: "eb-1", sourceId: "ebay", sourceName: "eBay", title: "CAP 50 lb adjustable dumbbell", price: 49.99, currency: "CAD", location: "Ships to Toronto", condition: "Pre-owned", postedAt: "Newly listed", url: "https://www.ebay.ca/", extractedAt: timestamp },
  ],
  craigslist: [
    { id: "cl-1", sourceId: "craigslist", sourceName: "Craigslist", title: "Pair of hex dumbbells, 20 lb", price: 30, currency: "CAD", location: "Toronto", condition: "Used", postedAt: "1d ago", url: "https://toronto.craigslist.org/", extractedAt: timestamp },
  ],
};

function mockSubscription(jobId: string, sourceIds: string[], onEvent: (event: SearchEvent) => void): () => void {
  const events: Array<{ delay: number; event: SearchEvent }> = [{ delay: 0, event: { type: "job_started", jobId } }];
  sourceIds.forEach((sourceId, index) => {
    const source = DEFAULT_SOURCES.find((item) => item.id === sourceId);
    if (!source) return;
    const offset = 250 + index * 280;
    events.push(
      { delay: offset, event: { type: "source_started", sourceId, sourceName: source.name } },
      { delay: offset + 420, event: { type: "source_status", sourceId, status: "extracting", message: "Extracting listing cards…" } },
      { delay: offset + 750, event: { type: "listing_batch", sourceId, listings: listingsBySource[sourceId] ?? [] } },
      { delay: offset + 1050, event: { type: "source_complete", sourceId, count: (listingsBySource[sourceId] ?? []).length } },
    );
  });
  const finishDelay = Math.max(1400, sourceIds.length * 280 + 1350);
  events.push({ delay: finishDelay, event: { type: "job_complete", jobId } });
  const timers = events.map(({ delay, event }) => window.setTimeout(() => onEvent(event), delay));
  return () => timers.forEach(window.clearTimeout);
}

/** Reads the SSE stream to its end and reports whether the job finished within it. */
async function parseSse(response: Response, onEvent: (event: SearchEvent) => void): Promise<{ completed: boolean }> {
  if (!response.body) throw new Error("The event stream did not return a response body.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const messages = buffer.split("\n\n");
    buffer = messages.pop() ?? "";
    messages.forEach((message) => {
      const data = message.split("\n").find((line) => line.startsWith("data:"))?.slice(5).trim();
      if (!data) return;
      const event = JSON.parse(data) as SearchEvent;
      if (event.type === "job_complete") completed = true;
      onEvent(event);
    });
  }
  return { completed };
}

export const searchApi: SearchApi = {
  isMock: mockMode,
  async getSources() {
    if (mockMode) return DEFAULT_SOURCES;
    const response = await fetchApi("/sources");
    if (!response.ok) throw responseError("Unable to load marketplaces", apiEndpoint("/sources"), response);
    const payload = await response.json() as MarketplaceSource[] | { sources: MarketplaceSource[] };
    return Array.isArray(payload) ? payload : payload.sources;
  },
  async startSearch(query, sources) {
    if (mockMode) {
      const jobId = `demo-${Date.now()}`;
      mockJobs.set(jobId, sources);
      return { jobId };
    }
    const response = await fetchApi("/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, sources }),
    });
    if (!response.ok) throw responseError("Could not start this search", apiEndpoint("/search"), response);
    return response.json() as Promise<{ jobId: string }>;
  },
  async getSearchJob(jobId) {
    if (mockMode) {
      // Demo jobs only live in this page's memory, so a job from a previous
      // popup session behaves like a server that no longer has it.
      const sourceIds = mockJobs.get(jobId);
      if (!sourceIds) throw new ApiError("Demo search results are only available in the session that ran them.", 404);
      return {
        jobId,
        status: "complete",
        intent: { rawQuery: "demo", item: "dumbbells", condition: "any" },
        listings: sourceIds.flatMap((sourceId) => listingsBySource[sourceId] ?? []),
      };
    }
    const response = await fetchApi(`/search/${jobId}`);
    if (!response.ok) throw responseError("Could not load the completed search results", apiEndpoint(`/search/${jobId}`), response);
    return response.json() as Promise<SearchJobSnapshot>;
  },
  async cancelSearch(jobId) {
    // Demo searches only run as timers in this page, which the subscription
    // cleanup clears; there is nothing to stop remotely.
    if (mockMode) return;
    const response = await fetchApi(`/search/${jobId}/cancel`, { method: "POST" });
    // A job the server no longer has is already stopped.
    if (!response.ok && response.status !== 404) throw responseError("Could not cancel this search", apiEndpoint(`/search/${jobId}/cancel`), response);
  },
  subscribe(jobId, onEvent, onError) {
    if (mockMode) return mockSubscription(jobId, mockJobs.get(jobId) ?? [], onEvent);
    const controller = new AbortController();
    fetchApi(`/search/${jobId}/events`, { signal: controller.signal, headers: { Accept: "text/event-stream" } })
      .then((response) => {
        if (!response.ok) throw responseError("Could not connect to live search updates", apiEndpoint(`/search/${jobId}/events`), response);
        return parseSse(response, onEvent);
      })
      .then(({ completed }) => {
        // The server only closes the stream after job_complete, so an earlier
        // close means the connection was lost. Surface it instead of leaving
        // the popup in a permanent "Searching…" state.
        if (!completed) onError(new Error("Live search updates ended before the search finished. Start the search again."));
      })
      .catch((error: unknown) => {
        if ((error as DOMException).name !== "AbortError") onError(error instanceof Error ? error : new Error("Event stream failed."));
      });
    return () => controller.abort();
  },
};
