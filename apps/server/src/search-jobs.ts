import type { Listing, MarketplaceSource, SearchEvent, SearchIntent } from "@gehackathon/shared";

import type { BrowserAgent } from "./agents/browser-agent.js";
import { createBrowserAgent } from "./agents/create-browser-agent.js";

export type SearchJobStatus = "running" | "complete";

export interface SearchJob {
  id: string;
  intent: SearchIntent;
  sources: MarketplaceSource[];
  events: SearchEvent[];
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
}

export class SearchJobManager {
  private readonly jobs = new Map<string, StoredSearchJob>();
  private nextJobNumber = 1;
  private readonly agent: BrowserAgent;
  private readonly sourceTimeoutMs: number;

  constructor(options: SearchJobManagerOptions = {}) {
    this.agent = options.agent ?? createBrowserAgent(options);
    this.sourceTimeoutMs = options.sourceTimeoutMs ?? 90_000;
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
    const timeout = setTimeout(() => {
      controller.abort(timeoutError);
      rejectTimeout(timeoutError);
    }, this.sourceTimeoutMs);
    let listings: Listing[] = [];

    try {
      listings = await Promise.race([
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
      this.emit(job, { type: "listing_batch", sourceId: source.id, listings });
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
}
