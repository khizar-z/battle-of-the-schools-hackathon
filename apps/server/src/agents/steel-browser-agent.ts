import type { Listing, MarketplaceSource, SearchIntent } from "@gehackathon/shared";
import { chromium } from "playwright-core";
import Steel from "steel-sdk";

import { BrowserAgentError, type AgentSearchContext, type BrowserAgent } from "./browser-agent.js";

const SESSION_TIMEOUT_MS = 120_000;
const PAGE_TIMEOUT_MS = 30_000;

interface SteelBrowserAgentOptions {
  apiKey: string;
  sessionTimeoutMs?: number;
}

interface ExtractedEbayListing {
  title: string;
  url: string;
  priceText?: string;
  imageUrl?: string;
  condition?: string;
}

/** Real cloud-browser implementation. The first deterministic recipe targets eBay. */
export class SteelBrowserAgent implements BrowserAgent {
  private readonly client: Steel;
  private readonly apiKey: string;
  private readonly sessionTimeoutMs: number;

  constructor(options: SteelBrowserAgentOptions) {
    this.apiKey = options.apiKey;
    this.sessionTimeoutMs = options.sessionTimeoutMs ?? SESSION_TIMEOUT_MS;
    this.client = new Steel({ steelAPIKey: this.apiKey });
  }

  async search(source: MarketplaceSource, intent: SearchIntent, context: AgentSearchContext): Promise<Listing[]> {
    if (source.id !== "ebay") {
      throw new BrowserAgentError(`${source.name} does not have a browser recipe yet.`);
    }

    let sessionId: string | undefined;
    let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;

    try {
      throwIfAborted(context.signal);
      const session = await this.client.sessions.create({ timeout: this.sessionTimeoutMs });
      sessionId = session.id;
      context.reportStatus("searching", "Opening a live Steel browser session…", session.sessionViewerUrl || session.debugUrl);

      const cdpUrl = new URL(session.websocketUrl);
      cdpUrl.searchParams.set("apiKey", this.apiKey);
      browser = await chromium.connectOverCDP(cdpUrl.toString());

      const browserContext = browser.contexts()[0];
      if (!browserContext) throw new BrowserAgentError("Steel session did not expose a browser context.");
      const page = browserContext.pages()[0] ?? (await browserContext.newPage());

      await page.goto(createEbaySearchUrl(intent), { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS });
      throwIfAborted(context.signal);
      context.reportStatus("extracting", "Reading eBay listing cards…", session.sessionViewerUrl || session.debugUrl);
      await page.waitForSelector("li.s-item", { timeout: PAGE_TIMEOUT_MS });

      const extracted = await page.locator("li.s-item").evaluateAll((cards) =>
        cards.slice(0, 24).flatMap((card) => {
          const title = card.querySelector(".s-item__title")?.textContent?.trim();
          const link = card.querySelector("a.s-item__link") as HTMLAnchorElement | null;
          const url = link?.href;
          if (!title || !url || title.toLowerCase() === "shop on ebay") return [];

          return [{
            title,
            url,
            priceText: card.querySelector(".s-item__price")?.textContent?.trim(),
            imageUrl: (card.querySelector(".s-item__image-img") as HTMLImageElement | null)?.src,
            condition: card.querySelector(".SECONDARY_INFO")?.textContent?.trim()
          }];
        })
      );

      return extracted.map((listing, index) => normalizeEbayListing(listing, source, intent, index));
    } catch (error) {
      if (error instanceof BrowserAgentError) throw error;
      throw new BrowserAgentError(`Steel browser search failed: ${errorMessage(error)}`);
    } finally {
      await browser?.close().catch(() => undefined);
      if (sessionId) await this.client.sessions.release(sessionId).catch(() => undefined);
    }
  }
}

function createEbaySearchUrl(intent: SearchIntent): string {
  const url = new URL("https://www.ebay.ca/sch/i.html");
  url.searchParams.set("_nkw", intent.item);
  if (intent.maxPrice !== undefined) url.searchParams.set("_udhi", String(intent.maxPrice));
  if (intent.minPrice !== undefined) url.searchParams.set("_udlo", String(intent.minPrice));
  if (intent.condition === "used") url.searchParams.set("LH_ItemCondition", "3000");
  if (intent.condition === "new") url.searchParams.set("LH_ItemCondition", "1000");
  return url.toString();
}

function normalizeEbayListing(
  listing: ExtractedEbayListing,
  source: MarketplaceSource,
  intent: SearchIntent,
  index: number
): Listing {
  const price = parsePrice(listing.priceText);
  const canonicalUrl = new URL(listing.url);
  canonicalUrl.search = "";

  return {
    id: canonicalUrl.pathname.split("/").filter(Boolean).at(-1) ?? `ebay-${index}`,
    sourceId: source.id,
    sourceName: source.name,
    title: listing.title,
    ...(price === undefined ? {} : { price }),
    currency: intent.currency ?? "CAD",
    ...(listing.imageUrl?.startsWith("http") ? { imageUrl: listing.imageUrl } : {}),
    url: canonicalUrl.toString(),
    condition: listing.condition,
    extractedAt: new Date().toISOString(),
    confidence: 0.9
  };
}

function parsePrice(priceText: string | undefined): number | undefined {
  if (!priceText) return undefined;
  const value = Number.parseFloat(priceText.replace(/[^\d.,]/g, "").replaceAll(",", ""));
  return Number.isFinite(value) ? value : undefined;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Search was cancelled");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown browser error";
}

