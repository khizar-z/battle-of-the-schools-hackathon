import type { Listing, MarketplaceSource, SearchIntent } from "@gehackathon/shared";
import { chromium, type Page } from "playwright-core";
import Steel from "steel-sdk";

import { BrowserAgentError, type AgentSearchContext, type BrowserAgent } from "./browser-agent.js";
import type { RecipeStore, SiteRecipe } from "../recipes/recipe-store.js";

const SESSION_TIMEOUT_MS = 120_000;
const PAGE_TIMEOUT_MS = 30_000;

interface SteelBrowserAgentOptions {
  apiKey: string;
  sessionTimeoutMs?: number;
  recipeStore: RecipeStore;
}

interface ExtractedEbayListing {
  title: string;
  url: string;
  priceText?: string;
  imageUrl?: string;
  condition?: string;
}

interface ExtractedKijijiListing {
  title: string;
  url: string;
  priceText?: string;
  location?: string;
  description?: string;
}

/** Real cloud-browser implementation with deterministic marketplace recipes. */
export class SteelBrowserAgent implements BrowserAgent {
  private readonly client: Steel;
  private readonly apiKey: string;
  private readonly sessionTimeoutMs: number;
  private readonly recipeStore: RecipeStore;

  constructor(options: SteelBrowserAgentOptions) {
    this.apiKey = options.apiKey;
    this.sessionTimeoutMs = options.sessionTimeoutMs ?? SESSION_TIMEOUT_MS;
    this.recipeStore = options.recipeStore;
    this.client = new Steel({ steelAPIKey: this.apiKey });
  }

  async search(source: MarketplaceSource, intent: SearchIntent, context: AgentSearchContext): Promise<Listing[]> {
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

      const recipe = await this.recipeStore.get(source.domain);
      const isEbay = source.id === "ebay";
      const isKijiji = source.id === "kijiji";
      const destination = isEbay ? createEbaySearchUrl(intent) : isKijiji ? createKijijiSearchUrl(intent) : sourceHomeUrl(source);
      await page.goto(destination, {
        waitUntil: "domcontentloaded",
        timeout: PAGE_TIMEOUT_MS
      });
      throwIfAborted(context.signal);
      context.reportStatus("extracting", `Reading ${source.name} listing cards…`, session.sessionViewerUrl || session.debugUrl);

      if (isEbay) {
        await page.waitForSelector(recipe?.resultSelector ?? "li.s-item", { timeout: PAGE_TIMEOUT_MS });
        const extracted = await extractEbayListings(page);
        const listings = extracted.map((listing, index) => normalizeEbayListing(listing, source, intent, index));
        await this.recipeStore.save(defaultRecipe(source));
        return listings;
      }

      if (isKijiji) {
        await page.waitForSelector(recipe?.resultSelector ?? '[data-testid="listing-link"]', { timeout: PAGE_TIMEOUT_MS });
        const extracted = await extractKijijiListings(page);
        const listings = extracted
          .map((listing, index) => normalizeKijijiListing(listing, source, index))
          .filter((listing) => isWithinPriceRange(listing, intent));
        await this.recipeStore.save(defaultRecipe(source));
        return listings;
      }

      const discovered = await discoverGenericSearch(page, source, intent);
      await this.recipeStore.save(discovered.recipe);
      return discovered.listings;
    } catch (error) {
      if (error instanceof BrowserAgentError) throw error;
      throw new BrowserAgentError(`Steel browser search failed: ${errorMessage(error)}`);
    } finally {
      await browser?.close().catch(() => undefined);
      if (sessionId) await this.client.sessions.release(sessionId).catch(() => undefined);
    }
  }
}

function sourceHomeUrl(source: MarketplaceSource): string {
  return source.domain.startsWith("http") ? source.domain : `https://${source.domain}`;
}

function defaultRecipe(source: MarketplaceSource): SiteRecipe {
  const ebay = source.id === "ebay";
  return {
    domain: source.domain,
    searchUrlTemplate: ebay ? "https://www.ebay.ca/sch/i.html?_nkw={query}" : "https://www.kijiji.ca/b-gta-greater-toronto-area/{query}/k0l1700272",
    searchSteps: [{ action: "navigate", target: ebay ? "eBay search URL" : "Kijiji Toronto search URL" }],
    resultSelector: ebay ? "li.s-item" : '[data-testid="listing-link"]',
    fieldSelectors: ebay
      ? { title: ".s-item__title", price: ".s-item__price", image: ".s-item__image-img", url: "a.s-item__link" }
      : { title: '[data-testid="listing-title"]', price: '[data-testid="listing-price"]', location: '[data-testid="listing-location"]', url: '[data-testid="listing-link"]' },
    learnedAt: new Date().toISOString()
  };
}

async function discoverGenericSearch(page: Page, source: MarketplaceSource, intent: SearchIntent): Promise<{ listings: Listing[]; recipe: SiteRecipe }> {
  const inputSelector = '[role="searchbox"], input[type="search"], input[name="q"], input[name="query"], input[placeholder*="Search" i]';
  const searchInput = page.locator(inputSelector).first();
  if (!(await searchInput.isVisible().catch(() => false))) {
    throw new BrowserAgentError(`${source.name} does not expose a discoverable search box.`);
  }
  await searchInput.fill(intent.item);
  await searchInput.press("Enter");
  await page.waitForLoadState("domcontentloaded", { timeout: PAGE_TIMEOUT_MS }).catch(() => undefined);

  const resultSelector = 'article a[href], [data-testid*="listing"] a[href], li a[href]';
  const links = await page.locator(resultSelector).evaluateAll((elements: Element[]) =>
    elements.slice(0, 24).flatMap((element) => {
      const anchor = element as HTMLAnchorElement;
      const title = anchor.textContent?.trim();
      if (!title || !anchor.href || title.length < 3) return [];
      return [{ title, url: anchor.href }];
    })
  );
  if (!links.length) throw new BrowserAgentError(`${source.name} search completed but no listing links were discovered.`);

  const extractedAt = new Date().toISOString();
  return {
    listings: links.map((link, index) => ({
      id: new URL(link.url).pathname.split("/").filter(Boolean).at(-1) ?? `${source.id}-${index}`,
      sourceId: source.id,
      sourceName: source.name,
      title: link.title,
      url: link.url,
      extractedAt,
      confidence: 0.45
    })),
    recipe: {
      domain: source.domain,
      searchSteps: [
        { action: "fill", target: inputSelector },
        { action: "press", target: "Enter" }
      ],
      resultSelector,
      fieldSelectors: { title: "a[href]", url: "a[href]" },
      learnedAt: extractedAt
    }
  };
}

export function createEbaySearchUrl(intent: SearchIntent): string {
  const url = new URL("https://www.ebay.ca/sch/i.html");
  url.searchParams.set("_nkw", intent.item);
  if (intent.maxPrice !== undefined) url.searchParams.set("_udhi", String(intent.maxPrice));
  if (intent.minPrice !== undefined) url.searchParams.set("_udlo", String(intent.minPrice));
  if (intent.condition === "used") url.searchParams.set("LH_ItemCondition", "3000");
  if (intent.condition === "new") url.searchParams.set("LH_ItemCondition", "1000");
  return url.toString();
}

export function createKijijiSearchUrl(intent: SearchIntent): string {
  const listingSlug = intent.item
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `https://www.kijiji.ca/b-gta-greater-toronto-area/${listingSlug || "search"}/k0l1700272`;
}

async function extractEbayListings(page: Page): Promise<ExtractedEbayListing[]> {
  return page.locator("li.s-item").evaluateAll((cards: Element[]) =>
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
}

async function extractKijijiListings(page: Page): Promise<ExtractedKijijiListing[]> {
  return page.locator('[data-testid="listing-link"]').evaluateAll((links: Element[]) =>
    links.slice(0, 24).flatMap((link) => {
      const anchor = link as HTMLAnchorElement;
      const title = anchor.textContent?.trim();
      const url = anchor.href;
      if (!title || !url) return [];

      let card: Element | null = anchor.parentElement;
      while (card && !card.querySelector('[data-testid="listing-price"]')) card = card.parentElement;

      return [{
        title,
        url,
        priceText: card?.querySelector('[data-testid="listing-price"]')?.textContent?.trim(),
        location: card?.querySelector('[data-testid="listing-location"]')?.textContent?.trim(),
        description: card?.querySelector('[data-testid="listing-description"]')?.textContent?.trim()
      }];
    })
  );
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

function normalizeKijijiListing(listing: ExtractedKijijiListing, source: MarketplaceSource, index: number): Listing {
  const price = parsePrice(listing.priceText);
  const canonicalUrl = new URL(listing.url);
  canonicalUrl.search = "";

  return {
    id: canonicalUrl.pathname.split("/").filter(Boolean).at(-1) ?? `kijiji-${index}`,
    sourceId: source.id,
    sourceName: source.name,
    title: listing.title,
    ...(price === undefined ? {} : { price }),
    currency: "CAD",
    url: canonicalUrl.toString(),
    location: listing.location,
    description: listing.description,
    extractedAt: new Date().toISOString(),
    confidence: 0.9
  };
}

function isWithinPriceRange(listing: Listing, intent: SearchIntent): boolean {
  if (listing.price === undefined) return intent.minPrice === undefined && intent.maxPrice === undefined;
  if (intent.minPrice !== undefined && listing.price < intent.minPrice) return false;
  if (intent.maxPrice !== undefined && listing.price > intent.maxPrice) return false;
  return true;
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
