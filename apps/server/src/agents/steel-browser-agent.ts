import type { Listing, MarketplaceSource, SearchIntent } from "@gehackathon/shared";
import { chromium, type BrowserContext, type Page } from "playwright-core";
import Steel from "steel-sdk";

import { BrowserAgentError, type AgentSearchContext, type BrowserAgent } from "./browser-agent.js";
import type { SteelProfileStore } from "./profile-store.js";
import type { RecipeStore, SiteRecipe } from "../recipes/recipe-store.js";
import { NoopImageQualityAssessor, type ListingImageQualityAssessor } from "../image-quality-service.js";
import { marketplaceSearchTerms } from "../search-policy.js";

const SESSION_TIMEOUT_MS = 420_000;
const PAGE_TIMEOUT_MS = 30_000;
const FACEBOOK_MARKETPLACE_URL = "https://www.facebook.com/marketplace/";
const FACEBOOK_LOGIN_POLL_MS = 3_000;
const LOGIN_WAIT_MS = 300_000;
const IMAGE_QUALITY_MAX_LISTINGS = boundedIntegerFromEnvironment("IMAGE_QUALITY_MAX_LISTINGS", 4, 1, 12);
// eBay is migrating its search results from `li.s-item` cards to `li.s-card`
// cards, and different pages can render either. Match both.
export const EBAY_CARD_SELECTOR = "li.s-card, li.s-item";
// eBay often answers the first request of a fresh browser session with a
// transient error page and serves the same URL normally moments later.
const EBAY_PAGE_ATTEMPTS = 3;

interface SteelBrowserAgentOptions {
  apiKey: string;
  sessionTimeoutMs?: number;
  facebookLoginTimeoutMs?: number;
  recipeStore: RecipeStore;
  profileStore: SteelProfileStore;
  imageQualityAssessor?: ListingImageQualityAssessor;
}

interface ExtractedEbayListing {
  title: string;
  url: string;
  priceText?: string;
  imageUrl?: string;
  condition?: string;
  sellerRatingText?: string;
  productRatingText?: string;
}

type EbayResultState = "results" | "near_matches" | "empty" | "error_page";

interface ExtractedKijijiListing {
  title: string;
  url: string;
  priceText?: string;
  imageUrl?: string;
  location?: string;
  description?: string;
}

interface ExtractedFacebookListing {
  title: string;
  url: string;
  priceText?: string;
  imageUrl?: string;
}

interface ExtractedFacebookCard {
  title?: string;
  url: string;
  textLines: string[];
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
  private readonly imageQualityAssessor: ListingImageQualityAssessor;

  constructor(options: SteelBrowserAgentOptions) {
    this.apiKey = options.apiKey;
    this.sessionTimeoutMs = options.sessionTimeoutMs ?? SESSION_TIMEOUT_MS;
    this.facebookLoginTimeoutMs = options.facebookLoginTimeoutMs ?? positiveIntegerFromEnvironment("FACEBOOK_LOGIN_TIMEOUT_MS", 900_000);
    this.recipeStore = options.recipeStore;
    this.profileStore = options.profileStore;
    this.imageQualityAssessor = options.imageQualityAssessor ?? new NoopImageQualityAssessor();
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

      const isEbay = source.id === "ebay";
      const isKijiji = source.id === "kijiji";
      const destination = isFacebook
        ? createFacebookSearchUrl(intent)
        : isEbay
          ? createEbaySearchUrl(intent)
          : isKijiji
            ? createKijijiSearchUrl(intent)
            : sourceHomeUrl(source);
      const recipe = await this.recipeStore.get(source.domain);
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

      if (isFacebook) {
        await openFacebookSearch(page, destination, marketplaceSearchTerms(intent), context);
      } else {
        await page.goto(destination, {
          waitUntil: "domcontentloaded",
          timeout: PAGE_TIMEOUT_MS
        });
      }
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
        if (isFacebook) {
          await openFacebookSearch(page, destination, marketplaceSearchTerms(intent), context);
        } else {
          await page.goto(destination, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS });
        }
        throwIfAborted(context.signal);
      }
      context.reportStatus("extracting", `Reading ${source.name} listing cards…`, session.sessionViewerUrl || session.debugUrl);

      if (isFacebook) {
        await page.waitForSelector('a[href*="/marketplace/item/"]', { timeout: PAGE_TIMEOUT_MS });
        const extracted = await extractFacebookListings(page);
        return this.assessListingImages(page, extracted.map((listing, index) => normalizeFacebookListing(listing, source, intent, index)), context);
      }

      if (isEbay) {
        const resultState = await loadEbayResults(page, destination, context);
        if (resultState === "empty") {
          context.reportStatus("extracting", "eBay found no listings matching this search.");
          await this.recipeStore.save(defaultRecipe(source));
          return [];
        }
        if (resultState === "near_matches") {
          context.reportStatus("extracting", "eBay found no exact matches. Evaluating its closest listings…");
        }
        const extracted = await extractEbayListings(page);
        const listings = extracted.map((listing, index) =>
          normalizeEbayListing(listing, source, intent, index, resultState === "near_matches" ? 0.6 : 0.9)
        );
        await this.recipeStore.save(defaultRecipe(source));
        return this.assessListingImages(page, listings, context);
      }

      if (isKijiji) {
        const resultState = await waitForKijijiResultState(
          page,
          recipe?.resultSelector ?? '[data-testid="listing-link"]',
          context.signal
        );
        if (resultState === "empty") {
          context.reportStatus("extracting", "Kijiji found no listings matching this search.");
          return [];
        }
        await revealLazyImages(page, context.signal);
        const extracted = await extractKijijiListings(page);
        const listings = extracted.map((listing, index) => normalizeKijijiListing(listing, source, index));
        await this.recipeStore.save(defaultRecipe(source));
        return this.assessListingImages(page, listings, context);
      }

      const discovered = await discoverGenericSearch(page, source, intent);
      await this.recipeStore.save(discovered.recipe);
      return this.assessListingImages(page, discovered.listings, context);
    } catch (error) {
      if (error instanceof BrowserAgentError) throw error;
      throw new BrowserAgentError(`Steel browser search failed: ${errorMessage(error)}`);
    } finally {
      await browser?.close().catch(() => undefined);
      if (sessionId) await this.client.sessions.release(sessionId).catch(() => undefined);
    }
  }

  private async assessListingImages(page: Page, listings: Listing[], context: AgentSearchContext): Promise<Listing[]> {
    if (!this.imageQualityAssessor.enabled) return listings;
    const candidates = listings.slice(0, IMAGE_QUALITY_MAX_LISTINGS);
    if (!candidates.some((listing) => listing.imageUrl)) return listings;
    context.reportStatus("extracting", "Inspecting listing photos for visible product condition…");

    const assessments = await Promise.all(candidates.map(async (listing) => {
      if (!listing.imageUrl) return listing;
      try {
        const screenshot = await screenshotListingImage(page, listing.imageUrl);
        if (!screenshot) return listing;
        const assessment = await this.imageQualityAssessor.assess(listing, screenshot);
        return assessment ? { ...listing, ...assessment } : listing;
      } catch (error) {
        // Image scoring enriches a listing; it must never prevent the extracted
        // result from being returned. Steel can close a page while a screenshot
        // request is in flight, particularly after a Facebook search redirect.
        console.warn("Skipping optional listing-image assessment", {
          listingId: listing.id,
          reason: errorMessage(error)
        });
        return listing;
      }
    }));
    const byId = new Map(assessments.map((listing) => [listing.id, listing]));
    return listings.map((listing) => byId.get(listing.id) ?? listing);
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
    resultSelector: ebay ? EBAY_CARD_SELECTOR : '[data-testid="listing-link"]',
    fieldSelectors: ebay
      ? { title: ".s-card__title, .s-item__title", price: ".s-card__price, .s-item__price", image: "img.s-card__image, .s-item__image-img", url: "a.s-card__link, a.s-item__link" }
      : { title: '[data-testid="listing-title"]', price: '[data-testid="listing-price"]', image: '[data-testid="listing-card-image"]', location: '[data-testid="listing-location"]', url: '[data-testid="listing-link"]' },
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

async function openFacebookSearch(
  page: Page,
  destination: string,
  query: string,
  context: AgentSearchContext
): Promise<void> {
  await page.goto(destination, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS });
  if (!isFacebookMarketplaceHome(page.url())) return;

  // Facebook sometimes redirects the direct search URL to Marketplace home
  // immediately after a manual login. In that case, use its own search field
  // rather than leaving the user at a completed login with no search running.
  context.reportStatus("searching", "Facebook returned to Marketplace home. Submitting the requested search…");
  const searchInput = page.locator(
    'input[aria-label*="Search Marketplace" i], input[placeholder*="Search Marketplace" i], input[role="combobox"][aria-label*="Marketplace" i]'
  ).first();
  if (!(await searchInput.isVisible().catch(() => false))) {
    throw new BrowserAgentError("Facebook returned to Marketplace home after login and did not expose a Marketplace search field.");
  }
  await searchInput.fill(query);
  await searchInput.press("Enter");
  await page.waitForLoadState("domcontentloaded", { timeout: PAGE_TIMEOUT_MS }).catch(() => undefined);
}

export function isFacebookMarketplaceHome(url: string): boolean {
  try {
    const parsed = new URL(url);
    return /(^|\.)facebook\.com$/i.test(parsed.hostname) && /^\/marketplace\/?$/.test(parsed.pathname);
  } catch {
    return false;
  }
}

function createSteelCdpUrl(sessionId: string, apiKey: string): string {
  const websocketUrl = new URL("wss://connect.steel.dev");
  websocketUrl.searchParams.set("apiKey", apiKey);
  websocketUrl.searchParams.set("sessionId", sessionId);
  return websocketUrl.toString();
}

/**
 * Kijiji intentionally renders a results page with no listing-card elements
 * when a query has no matches. Waiting only for cards leaves the browser agent
 * blocked in the extracting phase until the remote Steel session times out.
 */
async function waitForKijijiResultState(
  page: Page,
  resultSelector: string,
  signal: AbortSignal
): Promise<"results" | "empty"> {
  const deadline = Date.now() + PAGE_TIMEOUT_MS;
  const results = page.locator(resultSelector);

  while (Date.now() < deadline) {
    throwIfAborted(signal);

    if (await results.count() > 0) return "results";

    let pageText: string;
    try {
      pageText = await page.locator("body").innerText({ timeout: 3_000 });
    } catch (error) {
      // A closed Steel page must finish this source with an error instead of
      // appearing to keep reading cards after the remote session has ended.
      throw new BrowserAgentError(`Kijiji page became unavailable while checking search results: ${errorMessage(error)}`);
    }
    if (hasKijijiNoResultsText(pageText)) return "empty";

    await waitForAbortableDelay(350, signal);
  }

  throw new BrowserAgentError("Kijiji did not render listing cards or a no-results message.");
}

/**
 * eBay renders result cards with either its legacy or its newer markup, shows
 * a "0 results" heading followed by near-match cards when nothing matches the
 * exact wording, and occasionally serves a transient error page. Waiting for
 * one card selector alone times out on every one of those pages.
 */
async function loadEbayResults(
  page: Page,
  destination: string,
  context: AgentSearchContext
): Promise<Exclude<EbayResultState, "error_page">> {
  for (let attempt = 1; attempt <= EBAY_PAGE_ATTEMPTS; attempt += 1) {
    const state = await waitForEbayResultState(page, context.signal);
    if (state !== "error_page") return state;
    if (attempt === EBAY_PAGE_ATTEMPTS) break;
    context.reportStatus("searching", `eBay returned a temporary error page. Reloading (${attempt}/${EBAY_PAGE_ATTEMPTS - 1})…`);
    await waitForAbortableDelay(1_500, context.signal);
    await page.goto(destination, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS });
  }
  throw new BrowserAgentError("eBay kept returning a temporary error page instead of search results.");
}

async function waitForEbayResultState(page: Page, signal: AbortSignal): Promise<EbayResultState> {
  const deadline = Date.now() + PAGE_TIMEOUT_MS;
  const cards = page.locator(EBAY_CARD_SELECTOR);

  while (Date.now() < deadline) {
    throwIfAborted(signal);

    let pageText: string;
    let title: string;
    try {
      title = await page.title();
      pageText = await page.locator("body").innerText({ timeout: 3_000 });
    } catch (error) {
      throw new BrowserAgentError(`eBay page became unavailable while checking search results: ${errorMessage(error)}`);
    }
    if (isEbayErrorPage(title, pageText)) return "error_page";

    const noExactMatches = hasEbayNoResultsText(pageText);
    if (await cards.count() > 0) return noExactMatches ? "near_matches" : "results";
    if (noExactMatches) return "empty";

    await waitForAbortableDelay(350, signal);
  }

  throw new BrowserAgentError("eBay did not render listing cards or a no-results message.");
}

export function hasEbayNoResultsText(value: string): boolean {
  const text = value.replace(/\s+/g, " ").toLowerCase();
  return /\b0 results for\b|\bno exact matches found\b/.test(text);
}

export function isEbayErrorPage(title: string, bodyText: string): boolean {
  const text = bodyText.replace(/\s+/g, " ").toLowerCase();
  return /^error page\b/i.test(title.trim()) || /something went wrong on our end/.test(text);
}

export function hasKijijiNoResultsText(value: string): boolean {
  const text = value.replace(/\s+/g, " ").toLowerCase();
  return /\bno results(?:\s+for)?\b|\bcouldn['’]t find (?:any )?(?:results|listings)\b|\bno matches found\b/.test(text);
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
  const cards = await page.locator('a[href*="/marketplace/item/"]').evaluateAll((anchors: Element[]): ExtractedFacebookCard[] =>
    anchors.slice(0, 48).flatMap((element) => {
      const anchor = element as HTMLAnchorElement;
      if (!anchor.href) return [];

      const textLines = (anchor.innerText || anchor.textContent || "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      return [{
        title: anchor.getAttribute("aria-label")?.trim()
          || (anchor.querySelector("img") as HTMLImageElement | null)?.alt?.trim()
          || textLines.find((line) => !/^[$£€]?\s*\d/.test(line)),
        url: anchor.href,
        textLines,
        imageUrl: (anchor.querySelector("img") as HTMLImageElement | null)?.src
      }];
    })
  );

  const seenUrls = new Set<string>();
  return cards.flatMap((card) => {
    if (!card.title || card.title.length < 2 || seenUrls.has(card.url)) return [];
    seenUrls.add(card.url);
    return [{
      title: card.title,
      url: card.url,
      priceText: extractFacebookPriceText(card.textLines),
      imageUrl: card.imageUrl
    }];
  });
}

/**
 * Facebook cards commonly contain counts such as "1 bedroom" before their
 * actual rent. Only accept a currency-marked amount (or "Free") as a price.
 */
export function extractFacebookPriceText(textLines: string[]): string | undefined {
  for (const line of textLines) {
    if (/^free$/i.test(line.trim())) return "0";
    const currencyPrice = line.match(/(?:(?:CA|US|C)\s*)?[$€£]\s*\d[\d,]*(?:\.\d{1,2})?/i);
    if (currencyPrice) return currencyPrice[0];
    const codedCurrencyPrice = line.match(/\b\d[\d,]*(?:\.\d{1,2})?\s*(?:CAD|USD|EUR|GBP)\b/i);
    if (codedCurrencyPrice) return codedCurrencyPrice[0];
  }
  return undefined;
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
  return page.locator(EBAY_CARD_SELECTOR).evaluateAll((cards: Element[]) =>
    cards.slice(0, 30).flatMap((card) => {
      const title = card.querySelector(".s-card__title, .s-item__title")?.textContent?.trim();
      const link = [...card.querySelectorAll<HTMLAnchorElement>("a.s-card__link[href], a.s-item__link[href]")]
        .find((anchor) => /\/itm\//.test(anchor.href));
      const url = link?.href;
      // eBay pads both layouts with a hidden "Shop on eBay" template card.
      if (!title || !url || title.toLowerCase() === "shop on ebay" || /\/itm\/123456(?:[/?#]|$)/.test(url)) return [];

      const cardText = (card as HTMLElement).innerText ?? card.textContent ?? "";
      const ratingElement = card.querySelector('[aria-label*="out of 5"], .x-star-rating');
      return [{
        title,
        url,
        priceText: card.querySelector(".s-card__price, .s-item__price")?.textContent?.trim(),
        imageUrl: (card.querySelector("img.s-card__image, .s-item__image-img") as HTMLImageElement | null)?.src,
        condition: card.querySelector(".s-card__subtitle, .SECONDARY_INFO")?.textContent?.trim(),
        productRatingText: ratingElement?.getAttribute("aria-label") ?? ratingElement?.textContent?.trim(),
        sellerRatingText: cardText.match(/\d{1,3}(?:\.\d+)?%\s*positive/i)?.[0]
          ?? card.querySelector(".s-item__seller-info-text, [class*='seller']")?.textContent?.trim()
      }];
    })
  );
}

/**
 * Kijiji lazy-loads card photos as they scroll into view. A quick pass down
 * the list gives every card a real image URL before extraction.
 */
async function revealLazyImages(page: Page, signal: AbortSignal): Promise<void> {
  try {
    const steps = 6;
    for (let step = 1; step <= steps; step += 1) {
      throwIfAborted(signal);
      await page.evaluate((fraction) => window.scrollTo(0, document.body.scrollHeight * fraction), step / steps);
      await waitForAbortableDelay(200, signal);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
  } catch (error) {
    if (signal.aborted) throw error;
    // Scrolling only improves image coverage; extraction proceeds without it.
  }
}

async function extractKijijiListings(page: Page): Promise<ExtractedKijijiListing[]> {
  return page.locator('[data-testid="listing-link"]').evaluateAll((links: Element[]) =>
    links.slice(0, 24).flatMap((link) => {
      const anchor = link as HTMLAnchorElement;
      const title = anchor.textContent?.trim();
      const url = anchor.href;
      if (!title || !url) return [];

      // The price sits in a details block below the title; the photo is a
      // sibling of that block inside the listing-card section.
      let details: Element | null = anchor.parentElement;
      while (details && !details.querySelector('[data-testid="listing-price"]')) details = details.parentElement;
      const card = anchor.closest('[data-testid="listing-card"], li') ?? details;
      const image = card?.querySelector('img[data-testid="listing-card-image"], img') as HTMLImageElement | null;
      const imageUrl = [image?.currentSrc, image?.getAttribute("src"), image?.getAttribute("data-src"), image?.getAttribute("srcset")?.split(",")[0]?.trim().split(" ")[0]]
        .find((candidate) => candidate?.startsWith("http"));

      return [{
        title,
        url,
        priceText: details?.querySelector('[data-testid="listing-price"]')?.textContent?.trim(),
        ...(imageUrl ? { imageUrl } : {}),
        location: details?.querySelector('[data-testid="listing-location"]')?.textContent?.trim(),
        description: details?.querySelector('[data-testid="listing-description"]')?.textContent?.trim()
      }];
    })
  );
}

function normalizeEbayListing(
  listing: ExtractedEbayListing,
  source: MarketplaceSource,
  intent: SearchIntent,
  index: number,
  confidence: number
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
    ...(parseProductRating(listing.productRatingText) === undefined ? {} : { productRating: parseProductRating(listing.productRatingText) }),
    ...(parseSellerRating(listing.sellerRatingText) === undefined ? {} : { sellerRating: parseSellerRating(listing.sellerRatingText) }),
    extractedAt: new Date().toISOString(),
    confidence
  };
}

export function parseProductRating(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = value.match(/(?:^|\s)([0-5](?:\.\d+)?)\s*(?:out of\s*5|\/\s*5|stars?)/i);
  if (!match) return undefined;
  const rating = Number.parseFloat(match[1]);
  return Number.isFinite(rating) ? Math.max(0, Math.min(5, rating)) : undefined;
}

export function parseSellerRating(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const percentage = value.match(/(\d{1,3}(?:\.\d+)?)\s*%\s*(?:positive|feedback)/i);
  if (percentage) {
    const rating = Math.round(Number.parseFloat(percentage[1]) * 5) / 100;
    return Number.isFinite(rating) ? Math.max(0, Math.min(5, rating)) : undefined;
  }
  return parseProductRating(value);
}

async function screenshotListingImage(page: Page, imageUrl: string): Promise<Buffer | undefined> {
  try {
    if (page.isClosed()) return undefined;
    const images = page.locator("img");
    const count = Math.min(await images.count(), 100);
    for (let index = 0; index < count; index += 1) {
      const image = images.nth(index);
      const source = await image.getAttribute("src").catch(() => undefined);
      if (!source || !sameImageSource(source, imageUrl)) continue;
      const visible = await image.isVisible().catch(() => false);
      if (!visible) continue;
      return image.screenshot({ type: "png", timeout: PAGE_TIMEOUT_MS }).catch(() => undefined);
    }
  } catch (error) {
    // A page can close between the isClosed check and a locator operation.
    // This is expected for a remote browser and simply means no score is added.
    console.warn("Could not capture listing image for optional assessment", { reason: errorMessage(error) });
  }
  return undefined;
}

function sameImageSource(left: string, right: string): boolean {
  try {
    const normalizedLeft = new URL(left).toString();
    const normalizedRight = new URL(right).toString();
    return normalizedLeft === normalizedRight;
  } catch {
    return left === right;
  }
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
    ...(listing.imageUrl?.startsWith("http") ? { imageUrl: listing.imageUrl } : {}),
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

function boundedIntegerFromEnvironment(name: string, fallback: number, minimum: number, maximum: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}
