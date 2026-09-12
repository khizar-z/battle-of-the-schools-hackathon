import type { Listing, MarketplaceSource, SearchEvent, SearchIntent } from "@gehackathon/shared";

import type { BrowserAgent } from "./agents/browser-agent.js";
import { createBrowserAgent } from "./agents/create-browser-agent.js";
import { dedupeListings, rankListings } from "./ranking/listings.js";
import { filterListingsForIntent, unsupportedSourceReason } from "./search-policy.js";

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
  sourceRetryCount?: number;
}

export class SearchJobManager {
  private readonly jobs = new Map<string, StoredSearchJob>();
  private nextJobNumber = 1;
  private readonly agent: BrowserAgent;
  private readonly sourceTimeoutMs: number;
  private readonly sourceRetryCount: number;

  constructor(options: SearchJobManagerOptions = {}) {
    this.agent = options.agent ?? createBrowserAgent(options);
    this.sourceTimeoutMs = options.sourceTimeoutMs ?? 210_000;
    this.sourceRetryCount = options.sourceRetryCount ?? 1;
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
    const unsupportedReason = unsupportedSourceReason(source, job.intent);
    if (unsupportedReason) {
      this.emit(job, { type: "source_status", sourceId: source.id, status: "skipped", message: unsupportedReason });
      this.emit(job, { type: "source_complete", sourceId: source.id, count: 0 });
      return;
    }
    const controller = new AbortController();
    const timeoutError = new Error("Marketplace search timed out");
    let rejectTimeout!: (error: Error) => void;
    const timeoutPromise = new Promise<never>((_, reject) => {
      rejectTimeout = reject;
    });
    const timeout = setTimeout(() => {
      controller.abort(timeoutError);
      rejectTimeout(timeoutError);
    }, this.sourceTimeoutMs);
    let listings: Listing[] = [];

    try {
      const rawListings = await this.searchWithRetry(job, source, sourceIndex, controller, timeoutPromise);
      listings = rankListings(filterListingsForIntent(dedupeListings(rawListings, job.listings), job.intent), job.intent);
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
