import type { Listing, MarketplaceSource, SearchIntent } from "@gehackathon/shared";

import type { AgentSearchContext, BrowserAgent } from "./browser-agent.js";

const FIXTURE_TIME = "2026-09-12T12:00:00.000Z";

export class MockBrowserAgent implements BrowserAgent {
  constructor(private readonly delayMs = 250) {}

  async search(source: MarketplaceSource, intent: SearchIntent, context: AgentSearchContext): Promise<Listing[]> {
    context.reportStatus("searching", "Searching marketplace…");
    await delay(this.delayMs * (context.sourceIndex + 1), context.signal);
    context.reportStatus("extracting", "Extracting listing cards…");
    await delay(this.delayMs, context.signal);

    return createMockListings(source, intent);
  }
}

function delay(durationMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, durationMs);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(signal.reason instanceof Error ? signal.reason : new Error("Search was cancelled"));
      },
      { once: true }
    );
  });
}

function createMockListings(source: MarketplaceSource, intent: SearchIntent): Listing[] {
  const basePrice = source.id === "ebay" ? 75 : source.id === "facebook" ? 60 : 50;
  const price = intent.maxPrice === 0 ? 0 : Math.min(basePrice, intent.maxPrice ?? basePrice);
  const location = intent.location?.raw ?? "Toronto, ON";
  const path = source.domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const sourceQualifier =
    source.id === "ebay" ? "shipping available" : source.id === "kijiji" ? "nearby pickup" : "local seller";

  return [1, 2].map((number) => {
    const candidatePrice = price + (number - 1) * 5;
    const title = intent.searchMode === "housing"
      ? number === 1
        ? `One-bedroom apartment rental near ${location}`
        : `Room for rent near ${location}`
      : `${intent.item} — ${sourceQualifier} ${number === 1 ? "option" : "great condition"}`;

    return {
      id: `${source.id}-mock-${number}`,
      sourceId: source.id,
      sourceName: source.name,
      title,
      price: intent.maxPrice === undefined ? candidatePrice : Math.min(candidatePrice, intent.maxPrice),
      currency: intent.currency ?? "CAD",
      imageUrl: `https://images.example.com/${source.id}-${number}.jpg`,
      url: `https://${path}/listing/${source.id}-mock-${number}`,
      location,
      condition: intent.condition === "any" ? "used" : intent.condition,
      postedAt: FIXTURE_TIME,
      extractedAt: FIXTURE_TIME,
      confidence: 0.95
    };
  });
}
