import type { Listing, MarketplaceSource, SearchEvent, SearchJobSnapshot } from "@gehackathon/shared";
import { defaultSources } from "./sources";

const baseUrl = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "");
const mockMode = !baseUrl;
const mockJobs = new Map<string, string[]>();

export interface SearchApi {
  getSources(): Promise<MarketplaceSource[]>;
  startSearch(query: string, sources: string[]): Promise<{ jobId: string }>;
  getSearchJob(jobId: string): Promise<SearchJobSnapshot>;
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
    const source = defaultSources.find((item) => item.id === sourceId);
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

async function parseSse(response: Response, onEvent: (event: SearchEvent) => void): Promise<void> {
  if (!response.body) throw new Error("The event stream did not return a response body.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const messages = buffer.split("\n\n");
    buffer = messages.pop() ?? "";
    messages.forEach((message) => {
      const data = message.split("\n").find((line) => line.startsWith("data:"))?.slice(5).trim();
      if (data) onEvent(JSON.parse(data) as SearchEvent);
    });
  }
}

export const searchApi: SearchApi = {
  isMock: mockMode,
  async getSources() {
    if (mockMode) return defaultSources;
    const response = await fetch(`${baseUrl}/sources`);
    if (!response.ok) throw new Error("Unable to load marketplaces.");
    const payload = await response.json() as MarketplaceSource[] | { sources: MarketplaceSource[] };
    return Array.isArray(payload) ? payload : payload.sources;
  },
  async startSearch(query, sources) {
    if (mockMode) {
      const jobId = `demo-${Date.now()}`;
      mockJobs.set(jobId, sources);
      return { jobId };
    }
    const response = await fetch(`${baseUrl}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, sources }),
    });
    if (!response.ok) throw new Error("Could not start this search.");
    return response.json() as Promise<{ jobId: string }>;
  },
  async getSearchJob(jobId) {
    if (mockMode) {
      return {
        jobId,
        status: "complete",
        intent: { rawQuery: "demo", item: "dumbbells", condition: "any" },
        listings: (mockJobs.get(jobId) ?? []).flatMap((sourceId) => listingsBySource[sourceId] ?? []),
      };
    }
    const response = await fetch(`${baseUrl}/search/${jobId}`);
    if (!response.ok) throw new Error("Could not load the completed search results.");
    return response.json() as Promise<SearchJobSnapshot>;
  },
  subscribe(jobId, onEvent, onError) {
    if (mockMode) return mockSubscription(jobId, mockJobs.get(jobId) ?? [], onEvent);
    const controller = new AbortController();
    fetch(`${baseUrl}/search/${jobId}/events`, { signal: controller.signal, headers: { Accept: "text/event-stream" } })
      .then((response) => {
        if (!response.ok) throw new Error("Could not connect to live search updates.");
        return parseSse(response, onEvent);
      })
      .catch((error: unknown) => {
        if ((error as DOMException).name !== "AbortError") onError(error instanceof Error ? error : new Error("Event stream failed."));
      });
    return () => controller.abort();
  },
};
