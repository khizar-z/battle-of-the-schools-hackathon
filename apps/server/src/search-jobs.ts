import type { Listing, MarketplaceSource, SearchEvent, SearchIntent } from "@gehackathon/shared";

import type { BrowserAgent } from "./agents/browser-agent.js";
import { createBrowserAgent } from "./agents/create-browser-agent.js";
import { createListingRanker, type ListingRanker } from "./listing-relevance-service.js";
import { dedupeListings, rankListings } from "./ranking/listings.js";

export type SearchJobStatus = "running" | "complete";

export interface SearchJob {
  id: string;
  intent: SearchIntent;
  sources: MarketplaceSource[];
  events: SearchEvent[];
  listings: Listing[];
  status: SearchJobStatus;
  done: Promise<void>;
}

interface StoredSearchJob extends SearchJob {
  resolveDone: () => void;
  listeners: Set<(event: SearchEvent) => void>;
}

export interface SearchJobManagerOptions {
  agent?: BrowserAgent;
  mockAgents?: boolean;
  mockDelayMs?: number;
  sourceTimeoutMs?: number;
  facebookLoginTimeoutMs?: number;
  sourceRetryCount?: number;
  ranker?: ListingRanker;
}

export class SearchJobManager {
  private readonly jobs = new Map<string, StoredSearchJob>();
  private nextJobNumber = 1;
  private readonly agent: BrowserAgent;
  private readonly sourceTimeoutMs: number;
  private readonly facebookLoginTimeoutMs: number;
  private readonly sourceRetryCount: number;
  private readonly ranker: ListingRanker;

  constructor(options: SearchJobManagerOptions = {}) {
    this.agent = options.agent ?? createBrowserAgent(options);
    // Manual marketplace sign-in is interactive, so allow enough time for it
    // to complete and for the authenticated browser to resume the search.
    this.sourceTimeoutMs = options.sourceTimeoutMs ?? 360_000;
    this.facebookLoginTimeoutMs = options.facebookLoginTimeoutMs ?? positiveIntegerFromEnvironment("FACEBOOK_LOGIN_TIMEOUT_MS", 900_000);
    this.sourceRetryCount = options.sourceRetryCount ?? 1;
    this.ranker = options.ranker ?? createListingRanker();
  }

  start(intent: SearchIntent, sources: MarketplaceSource[]): SearchJob {
    const id = `job_${this.nextJobNumber++}`;
    let resolveDone!: () => void;
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });
    const job: StoredSearchJob = {
      id,
      intent,
      sources,
      events: [],
      listings: [],
      status: "running",
      done,
      resolveDone,
      listeners: new Set()
    };

    this.jobs.set(id, job);
    this.emit(job, { type: "job_started", jobId: id });
    void this.run(job);
    return job;
  }

  get(jobId: string): SearchJob | undefined {
    return this.jobs.get(jobId);
  }

  subscribe(jobId: string, listener: (event: SearchEvent) => void): (() => void) | undefined {
    const job = this.jobs.get(jobId);
    if (!job || job.status === "complete") return undefined;

    job.listeners.add(listener);
    return () => job.listeners.delete(listener);
  }

  private async run(job: StoredSearchJob): Promise<void> {
    await Promise.allSettled(job.sources.map((source, index) => this.runSource(job, source, index)));
    job.status = "complete";
    this.emit(job, { type: "job_complete", jobId: job.id });
    job.resolveDone();
  }

  private async runSource(job: StoredSearchJob, source: MarketplaceSource, sourceIndex: number): Promise<void> {
    this.emit(job, { type: "source_started", sourceId: source.id, sourceName: source.name });
    const controller = new AbortController();
    const timeoutError = new Error("Marketplace search timed out");
    let rejectTimeout!: (error: Error) => void;
    const timeoutPromise = new Promise<never>((_, reject) => {
      rejectTimeout = reject;
    });
    const timeoutMs = source.id === "facebook" ? Math.max(this.sourceTimeoutMs, this.facebookLoginTimeoutMs) : this.sourceTimeoutMs;
    const timeout = setTimeout(() => {
      controller.abort(timeoutError);
      rejectTimeout(timeoutError);
    }, timeoutMs);
    let listings: Listing[] = [];

    try {
      const rawListings = await this.searchWithRetry(job, source, sourceIndex, controller, timeoutPromise);
      const candidates = dedupeListings(rawListings, job.listings);
      this.emit(job, {
        type: "source_status",
        sourceId: source.id,
        status: "ranking",
        message: `Evaluating ${candidates.length} candidate listings for relevance…`
      });
      listings = rankListings(await this.ranker.rank(job.intent, candidates), job.intent);
      job.listings = rankListings([...job.listings, ...listings], job.intent);
      if (listings.length) this.emit(job, { type: "listing_batch", sourceId: source.id, listings });
    } catch (error) {
      this.emit(job, {
        type: "source_status",
        sourceId: source.id,
        status: "error",
        message: error instanceof Error ? error.message : "Marketplace search failed"
      });
    } finally {
      clearTimeout(timeout);
      this.emit(job, { type: "source_complete", sourceId: source.id, count: listings.length });
    }
  }

  private emit(job: StoredSearchJob, event: SearchEvent): void {
    job.events.push(event);
    for (const listener of job.listeners) listener(event);
  }

  private async searchWithRetry(
    job: StoredSearchJob,
    source: MarketplaceSource,
    sourceIndex: number,
    controller: AbortController,
    timeoutPromise: Promise<never>
  ): Promise<Listing[]> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.sourceRetryCount; attempt += 1) {
      try {
        return await Promise.race([
          this.agent.search(source, job.intent, {
            sourceIndex,
            signal: controller.signal,
            reportStatus: (status, message, liveSessionUrl) => {
              if (!controller.signal.aborted) {
                this.emit(job, { type: "source_status", sourceId: source.id, status, message, liveSessionUrl });
              }
            }
          }),
          timeoutPromise
        ]);
      } catch (error) {
        lastError = error;
        if (controller.signal.aborted || attempt === this.sourceRetryCount) throw error;
        this.emit(job, {
          type: "source_status",
          sourceId: source.id,
          status: "searching",
          message: `Retrying marketplace search (${attempt + 1}/${this.sourceRetryCount})…`
        });
      }
    }
    throw lastError;
  }
}

function positiveIntegerFromEnvironment(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= 60_000 ? parsed : fallback;
}
