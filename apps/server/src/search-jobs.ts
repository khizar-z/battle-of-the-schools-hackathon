import type { Listing, MarketplaceSource, SearchEvent, SearchIntent } from "@gehackathon/shared";

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
  mockAgents?: boolean;
  mockDelayMs?: number;
}

const FIXTURE_TIME = "2026-09-12T12:00:00.000Z";

export class SearchJobManager {
  private readonly jobs = new Map<string, StoredSearchJob>();
  private nextJobNumber = 1;
  private readonly mockAgents: boolean;
  private readonly mockDelayMs: number;

  constructor(options: SearchJobManagerOptions = {}) {
    this.mockAgents = options.mockAgents ?? process.env.MOCK_AGENTS !== "false";
    this.mockDelayMs = options.mockDelayMs ?? 250;
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
    await Promise.allSettled(
      job.sources.map((source, index) =>
        this.mockAgents ? this.runMockSource(job, source, index) : this.runUnavailableSource(job, source)
      )
    );

    job.status = "complete";
    this.emit(job, { type: "job_complete", jobId: job.id });
    job.resolveDone();
  }

  private async runMockSource(job: StoredSearchJob, source: MarketplaceSource, index: number): Promise<void> {
    this.emit(job, { type: "source_started", sourceId: source.id, sourceName: source.name });
    this.emit(job, { type: "source_status", sourceId: source.id, status: "searching" });
    await this.delay(this.mockDelayMs * (index + 1));
    this.emit(job, { type: "source_status", sourceId: source.id, status: "extracting" });
    await this.delay(this.mockDelayMs);

    const listings = createMockListings(source, job.intent);
    this.emit(job, { type: "listing_batch", sourceId: source.id, listings });
    this.emit(job, { type: "source_complete", sourceId: source.id, count: listings.length });
  }

  private async runUnavailableSource(job: StoredSearchJob, source: MarketplaceSource): Promise<void> {
    this.emit(job, { type: "source_started", sourceId: source.id, sourceName: source.name });
    this.emit(job, {
      type: "source_status",
      sourceId: source.id,
      status: "error",
      message: "Browser agents are not configured. Set MOCK_AGENTS=true for local development."
    });
    this.emit(job, { type: "source_complete", sourceId: source.id, count: 0 });
  }

  private emit(job: StoredSearchJob, event: SearchEvent): void {
    job.events.push(event);
    for (const listener of job.listeners) listener(event);
  }

  private delay(durationMs: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, durationMs));
  }
}

function createMockListings(source: MarketplaceSource, intent: SearchIntent): Listing[] {
  const basePrice = source.id === "ebay" ? 75 : source.id === "facebook" ? 60 : 50;
  const price = intent.maxPrice === 0 ? 0 : Math.min(basePrice, intent.maxPrice ?? basePrice);
  const location = intent.location?.raw ?? "Toronto, ON";
  const path = source.domain.replace(/^https?:\/\//, "").replace(/\/$/, "");

  return [1, 2].map((number) => {
    const candidatePrice = price + (number - 1) * 5;

    return {
      id: `${source.id}-mock-${number}`,
      sourceId: source.id,
      sourceName: source.name,
      title: `${intent.item} — ${number === 1 ? "great condition" : "local pickup"}`,
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
