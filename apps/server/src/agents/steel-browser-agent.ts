import type { Listing, MarketplaceSource, SearchIntent } from "@gehackathon/shared";
import { chromium, type BrowserContext, type Page } from "playwright-core";
import Steel from "steel-sdk";

import { BrowserAgentError, type AgentSearchContext, type BrowserAgent } from "./browser-agent.js";
import type { SteelProfileStore } from "./profile-store.js";
import type { RecipeStore, SiteRecipe } from "../recipes/recipe-store.js";
import { marketplaceSearchTerms } from "../search-policy.js";

const SESSION_TIMEOUT_MS = 420_000;
const PAGE_TIMEOUT_MS = 30_000;
const FACEBOOK_MARKETPLACE_URL = "https://www.facebook.com/marketplace/";
const FACEBOOK_LOGIN_POLL_MS = 3_000;
const LOGIN_WAIT_MS = 300_000;

interface SteelBrowserAgentOptions {
  apiKey: string;
  sessionTimeoutMs?: number;
  facebookLoginTimeoutMs?: number;
  recipeStore: RecipeStore;
  profileStore: SteelProfileStore;
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

interface ExtractedFacebookListing {
  title: string;
  url: string;
  priceText?: string;
  imageUrl?: string;
}

/** Real cloud-browser implementation with deterministic marketplace recipes. */
export class SteelBrowserAgent implements BrowserAgent {
  private readonly client: Steel;
  private readonly apiKey: string;
  private readonly sessionTimeoutMs: number;
  private readonly facebookLoginTimeoutMs: number;
  private readonly recipeStore: RecipeStore;
  private readonly profileStore: SteelProfileStore;

  constructor(options: SteelBrowserAgentOptions) {
    this.apiKey = options.apiKey;
    this.sessionTimeoutMs = options.sessionTimeoutMs ?? SESSION_TIMEOUT_MS;
    this.facebookLoginTimeoutMs = options.facebookLoginTimeoutMs ?? positiveIntegerFromEnvironment("FACEBOOK_LOGIN_TIMEOUT_MS", 900_000);
    this.recipeStore = options.recipeStore;
    this.profileStore = options.profileStore;
    this.client = new Steel({ steelAPIKey: this.apiKey });
  }

  async search(source: MarketplaceSource, intent: SearchIntent, context: AgentSearchContext): Promise<Listing[]> {
    let sessionId: string | undefined;
    let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;

    try {
      throwIfAborted(context.signal);
      const isFacebook = source.id === "facebook";
      const profileId = await this.profileStore.get(source.id);
      const session = await this.client.sessions.create({
        timeout: isFacebook ? Math.max(this.sessionTimeoutMs, this.facebookLoginTimeoutMs) : this.sessionTimeoutMs,
        persistProfile: true,
        ...(profileId ? { profileId } : {}),
        debugConfig: { interactive: true }
      });
      sessionId = session.id;
      if (session.profileId) await this.profileStore.save(source.id, session.profileId);
      if (isFacebook && !session.profileId) {
        throw new BrowserAgentError("Steel did not return a persistent profile ID for the Facebook login session.");
      }
      context.reportStatus("searching", "Opening a live Steel browser session…", session.sessionViewerUrl || session.debugUrl);

      browser = await chromium.connectOverCDP(createSteelCdpUrl(session.id, this.apiKey));

      const browserContext = browser.contexts()[0];
      if (!browserContext) throw new BrowserAgentError("Steel session did not expose a browser context.");
      let page = browserContext.pages()[0] ?? (await browserContext.newPage());

      const recipe = await this.recipeStore.get(source.domain);
      const isEbay = source.id === "ebay";
      const isKijiji = source.id === "kijiji";
      if (isFacebook) {
        await page.goto(FACEBOOK_MARKETPLACE_URL, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS });
        await waitForFacebookLogin({
          browserContext,
          page,
          sessionProfileId: session.profileId,
          sessionViewerUrl: session.sessionViewerUrl || session.debugUrl,
          timeoutMs: this.facebookLoginTimeoutMs,
          signal: context.signal,
          reportStatus: context.reportStatus,
          saveProfile: (savedProfileId) => this.profileStore.save(source.id, savedProfileId)
        });
      }

      const destination = isFacebook
        ? createFacebookSearchUrl(intent)
        : isEbay
          ? createEbaySearchUrl(intent)
          : isKijiji
            ? createKijijiSearchUrl(intent)
            : sourceHomeUrl(source);
      await page.goto(destination, {
        waitUntil: "domcontentloaded",
        timeout: PAGE_TIMEOUT_MS
      });
      throwIfAborted(context.signal);
      if (await pageRequiresLogin(page)) {
        context.reportStatus(
          "needs_login",
          `${source.name} needs sign-in. Complete it in the live Steel session to continue this search.`,
          session.sessionViewerUrl || session.debugUrl
        );
        const authenticatedPage = await waitForSignIn(browserContext, source, context.signal);
        if (!authenticatedPage) {
          throw new BrowserAgentError(`${source.name} sign-in was not completed before the session expired.`);
        }
        page = authenticatedPage;
        context.reportStatus("searching", "Sign-in confirmed. Continuing marketplace search…", session.sessionViewerUrl || session.debugUrl);
        await page.goto(destination, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS });
        throwIfAborted(context.signal);
      }
      context.reportStatus("extracting", `Reading ${source.name} listing cards…`, session.sessionViewerUrl || session.debugUrl);

      if (isFacebook) {
        await page.waitForSelector('a[href*="/marketplace/item/"]', { timeout: PAGE_TIMEOUT_MS });
        const extracted = await extractFacebookListings(page);
        return extracted.map((listing, index) => normalizeFacebookListing(listing, source, intent, index));
      }

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
        const listings = extracted.map((listing, index) => normalizeKijijiListing(listing, source, index));
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
  await searchInput.fill(marketplaceSearchTerms(intent));
  await searchInput.press("Enter");
  await page.waitForLoadState("domcontentloaded", { timeout: PAGE_TIMEOUT_MS }).catch(() => undefined);

  const resultSelector = 'a[href*="/marketplace/item/"], article a[href], [data-testid*="listing"] a[href], li a[href]';
  const links = await page.locator(resultSelector).evaluateAll((elements: Element[]) =>
    elements.flatMap((element) => {
      const anchor = element as HTMLAnchorElement;
      const title = anchor.textContent?.trim();
      if (!title || !anchor.href || title.length < 3) return [];
      const pathname = new URL(anchor.href).pathname;
      const isMarketplaceItem = /\/marketplace\/item\//i.test(pathname);
      const isCardLink = Boolean(anchor.closest("article, li, [role='article'], [data-testid*='listing']"));
      if (!isMarketplaceItem && !isCardLink) return [];
      const card = anchor.closest("article, li, [role='article'], [data-testid*='listing']") ?? anchor.parentElement;
      const description = card?.textContent?.trim().replace(/\s+/g, " ");
      return [{ title, url: anchor.href, description: description?.slice(0, 700) }];
    }).slice(0, 24)
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
      ...(link.description ? { description: link.description } : {}),
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
  url.searchParams.set("_nkw", marketplaceSearchTerms(intent));
  return url.toString();
}

export function createKijijiSearchUrl(intent: SearchIntent): string {
  const listingSlug = marketplaceSearchTerms(intent)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `https://www.kijiji.ca/b-gta-greater-toronto-area/${listingSlug || "search"}/k0l1700272`;
}

export function createFacebookSearchUrl(intent: SearchIntent): string {
  const url = new URL("https://www.facebook.com/marketplace/search/");
  url.searchParams.set("query", marketplaceSearchTerms(intent));
  return url.toString();
}

function createSteelCdpUrl(sessionId: string, apiKey: string): string {
  const websocketUrl = new URL("wss://connect.steel.dev");
  websocketUrl.searchParams.set("apiKey", apiKey);
  websocketUrl.searchParams.set("sessionId", sessionId);
  return websocketUrl.toString();
}

async function waitForFacebookLogin(options: {
  browserContext: BrowserContext;
  page: Page;
  sessionProfileId?: string;
  sessionViewerUrl?: string;
  timeoutMs: number;
  signal: AbortSignal;
  reportStatus: AgentSearchContext["reportStatus"];
  saveProfile: (profileId: string) => Promise<void>;
}): Promise<void> {
  if (await hasFacebookLogin(options.browserContext)) return;

  options.reportStatus(
    "needs_login",
    "Facebook needs you to sign in. Complete login or any checkpoint in the live browser; search will resume automatically.",
    options.sessionViewerUrl
  );
  const deadline = Date.now() + options.timeoutMs;

  while (Date.now() < deadline) {
    throwIfAborted(options.signal);
    await waitForAbortableDelay(FACEBOOK_LOGIN_POLL_MS, options.signal);
    if (!(await hasFacebookLogin(options.browserContext))) continue;

    if (!options.sessionProfileId) {
      throw new BrowserAgentError("Steel did not return a persistent Facebook profile ID after login.");
    }
    await options.saveProfile(options.sessionProfileId);
    await options.page.goto(FACEBOOK_MARKETPLACE_URL, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS });
    return;
  }

  throw new BrowserAgentError("Facebook login was not completed before the login window expired.");
}

async function hasFacebookLogin(browserContext: BrowserContext): Promise<boolean> {
  // Only cookie names are checked. Cookie values are never logged, saved, or
  // passed through the API.
  const cookies = await browserContext.cookies(["https://www.facebook.com", "https://m.facebook.com"]);
  const cookieNames = new Set(cookies.map((cookie) => cookie.name));
  return cookieNames.has("c_user") && cookieNames.has("xs");
}

function waitForAbortableDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(signal.reason instanceof Error ? signal.reason : new Error("Search was cancelled"));
    };
    function cleanup(): void {
      signal.removeEventListener("abort", onAbort);
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function extractFacebookListings(page: Page): Promise<ExtractedFacebookListing[]> {
  return page.locator('a[href*="/marketplace/item/"]').evaluateAll((anchors: Element[]) => {
    const seenUrls = new Set<string>();
    return anchors.slice(0, 48).flatMap((element) => {
      const anchor = element as HTMLAnchorElement;
      if (!anchor.href || seenUrls.has(anchor.href)) return [];
      seenUrls.add(anchor.href);

      const textLines = (anchor.innerText || anchor.textContent || "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      const title = anchor.getAttribute("aria-label")?.trim()
        || (anchor.querySelector("img") as HTMLImageElement | null)?.alt?.trim()
        || textLines.find((line) => !/^[$£€]?\s*\d/.test(line));
      if (!title || title.length < 2) return [];

      return [{
        title,
        url: anchor.href,
        priceText: textLines.find((line) => /^[$£€]?\s*\d/.test(line)),
        imageUrl: (anchor.querySelector("img") as HTMLImageElement | null)?.src
      }];
    });
  });
}

async function pageRequiresLogin(page: Page): Promise<boolean> {
  const urlLooksLikeLogin = /(?:login|log-in|signin|sign-in|checkpoint)/i.test(page.url());
  if (urlLooksLikeLogin) return true;
  return page.locator('input[type="password"], input[name="email"], input[name="username"]').first().isVisible().catch(() => false);
}

async function waitForSignIn(browserContext: BrowserContext, source: MarketplaceSource, signal: AbortSignal): Promise<Page | undefined> {
  const deadline = Date.now() + LOGIN_WAIT_MS;
  let stableCandidate: { page: Page; url: string; seenAt: number } | undefined;
  while (Date.now() < deadline) {
    throwIfAborted(signal);
    const pages = browserContext.pages().filter((page) => !page.isClosed() && sourceUrlMatches(page.url(), source));
    const authenticated = await hasAuthenticatedSession(browserContext, source);
    for (const page of pages) {
      if (await pageRequiresLogin(page)) continue;

      // Facebook's login flow briefly changes its URL before it has completed.
      // For Facebook we require its authenticated session cookie; for other
      // marketplaces, require a non-login page to remain stable for two polls.
      if (authenticated) return page;
      if (stableCandidate?.page === page && stableCandidate.url === page.url() && Date.now() - stableCandidate.seenAt >= 2_000) {
        return page;
      }
      stableCandidate = { page, url: page.url(), seenAt: Date.now() };
    }
    await delay(1_000);
  }
  return undefined;
}

async function hasAuthenticatedSession(browserContext: BrowserContext, source: MarketplaceSource): Promise<boolean> {
  if (source.id !== "facebook") return false;
  return hasFacebookLogin(browserContext);
}

function sourceUrlMatches(url: string, source: MarketplaceSource): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    const domain = source.domain.replace(/^https?:\/\//, "").split("/")[0].toLowerCase();
    return hostname === domain || hostname.endsWith(`.${domain}`);
  } catch {
    return false;
  }
}

function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
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

function normalizeFacebookListing(
  listing: ExtractedFacebookListing,
  source: MarketplaceSource,
  intent: SearchIntent,
  index: number
): Listing {
  const canonicalUrl = new URL(listing.url);
  canonicalUrl.search = "";
  const price = parsePrice(listing.priceText);

  return {
    id: canonicalUrl.pathname.split("/").filter(Boolean).at(-1) ?? `facebook-${index}`,
    sourceId: source.id,
    sourceName: source.name,
    title: listing.title,
    ...(price === undefined ? {} : { price }),
    currency: intent.currency ?? "CAD",
    ...(listing.imageUrl?.startsWith("http") ? { imageUrl: listing.imageUrl } : {}),
    url: canonicalUrl.toString(),
    extractedAt: new Date().toISOString(),
    confidence: 0.8
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

function positiveIntegerFromEnvironment(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= 60_000 ? parsed : fallback;
}
