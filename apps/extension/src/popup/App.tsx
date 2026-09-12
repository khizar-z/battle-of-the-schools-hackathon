import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { Listing, MarketplaceSource } from "@gehackathon/shared";
import { searchApi } from "../lib/api";
import { initialSearchState, searchReducer, type SourceProgress } from "../lib/search-state";
import { defaultSources } from "../lib/sources";

const phaseLabel: Record<SourceProgress["phase"], string> = {
  idle: "Queued",
  searching: "Searching…",
  extracting: "Extracting…",
  complete: "Complete",
  error: "Couldn’t search",
  needs_login: "Sign-in needed",
};

function formatPrice(listing: Listing): string {
  if (listing.price === undefined) return "Price not listed";
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: listing.currency ?? "CAD", maximumFractionDigits: 0 }).format(listing.price);
}

function SourceToggle({ source, checked, onToggle }: { source: MarketplaceSource; checked: boolean; onToggle: () => void }) {
  return (
    <label className={`source-toggle ${checked ? "is-selected" : ""}`}>
      <input type="checkbox" checked={checked} onChange={onToggle} />
      <span className="source-check" aria-hidden="true">✓</span>
      <span>{source.name}</span>
      {source.requiresLogin && <span className="login-dot" title="May require sign-in" aria-label="May require sign-in" />}
    </label>
  );
}

function ActivityPanel({ sources, selectedIds, progress }: { sources: MarketplaceSource[]; selectedIds: string[]; progress: Record<string, SourceProgress> }) {
  const activeSources = sources.filter((source) => selectedIds.includes(source.id));
  if (!activeSources.length) return null;
  return (
    <section className="activity-panel" aria-label="Agent activity">
      <div className="section-heading"><h2>Agent activity</h2><span className="pulse-label">LIVE</span></div>
      {activeSources.map((source) => {
        const item = progress[source.id] ?? { phase: "idle" as const, count: 0 };
        return (
          <div className="activity-row" key={source.id}>
            <span className={`status-dot ${item.phase}`} aria-hidden="true" />
            <div className="activity-copy">
              <strong>{source.name}</strong>
              <span>{item.message ?? phaseLabel[item.phase]}</span>
            </div>
            {item.phase === "complete" ? <span className="count-pill">{item.count}</span> : null}
            {item.liveSessionUrl ? <a className="watch-link" href={item.liveSessionUrl} target="_blank" rel="noreferrer">Watch live ↗</a> : null}
          </div>
        );
      })}
    </section>
  );
}

function ListingCard({ listing }: { listing: Listing }) {
  return (
    <article className="listing-card">
      <div className="listing-image" aria-hidden="true"><span>{listing.title.split(" ")[0].slice(0, 1)}</span></div>
      <div className="listing-content">
        <div className="card-topline"><span className="badge">{listing.sourceName}</span>{listing.postedAt && <span className="freshness">{listing.postedAt}</span>}</div>
        <h3>{listing.title}</h3>
        <p className="listing-price">{formatPrice(listing)}</p>
        <p className="listing-meta">{[listing.location, listing.condition].filter(Boolean).join(" · ") || "Details available on listing"}</p>
        <a className="open-listing" href={listing.url} target="_blank" rel="noreferrer">Open listing <span aria-hidden="true">↗</span></a>
      </div>
    </article>
  );
}

export function App() {
  const [state, dispatch] = useReducer(searchReducer, initialSearchState);
  const [sources, setSources] = useState<MarketplaceSource[]>(defaultSources);
  const [sort, setSort] = useState<"relevance" | "price">("relevance");
  const [marketplaceFilter, setMarketplaceFilter] = useState("all");
  const [maxPrice, setMaxPrice] = useState("");
  const cancelSubscription = useRef<(() => void) | null>(null);

  useEffect(() => {
    let live = true;
    searchApi.getSources().then((loadedSources) => {
      if (!live) return;
      setSources(loadedSources);
      dispatch({ type: "set_sources", sourceIds: loadedSources.filter((source) => source.enabled).map((source) => source.id) });
    }).catch((error: unknown) => {
      if (live) dispatch({ type: "error", message: error instanceof Error ? error.message : "Could not load marketplaces." });
    });
    return () => { live = false; cancelSubscription.current?.(); };
  }, []);

  const handleSearch = async (event: React.FormEvent) => {
    event.preventDefault();
    const query = state.query.trim();
    if (!query) {
      dispatch({ type: "error", message: "Tell Scout what you’re looking for first." });
      return;
    }
    if (!state.selectedSourceIds.length) {
      dispatch({ type: "error", message: "Choose at least one marketplace to search." });
      return;
    }
    cancelSubscription.current?.();
    try {
      const { jobId } = await searchApi.startSearch(query, state.selectedSourceIds);
      dispatch({ type: "start", jobId, sourceIds: state.selectedSourceIds });
      cancelSubscription.current = searchApi.subscribe(
        jobId,
        (searchEvent) => dispatch({ type: "event", event: searchEvent }),
        (error) => dispatch({ type: "error", message: error.message }),
      );
    } catch (error) {
      dispatch({ type: "error", message: error instanceof Error ? error.message : "Could not start this search." });
    }
  };

  const visibleListings = useMemo(() => {
    const priceLimit = Number(maxPrice);
    const filtered = state.listings.filter((listing) =>
      (marketplaceFilter === "all" || listing.sourceId === marketplaceFilter) &&
      (!maxPrice || listing.price === undefined || listing.price <= priceLimit),
    );
    return sort === "price" ? [...filtered].sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity)) : filtered;
  }, [state.listings, marketplaceFilter, maxPrice, sort]);

  const hasSearch = state.status !== "idle" || state.listings.length > 0;
  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand-mark" aria-hidden="true">S</div>
        <div><p className="eyebrow">UNIVERSAL SECONDHAND SEARCH</p><h1>Scout</h1></div>
        {searchApi.isMock && <span className="demo-badge">Demo mode</span>}
      </header>

      <form className="search-form" onSubmit={handleSearch}>
        <label htmlFor="query">What are you looking for?</label>
        <div className="query-row">
          <input id="query" value={state.query} onChange={(event) => dispatch({ type: "set_query", query: event.target.value })} placeholder="used dumbbells under $50 near Kensington" autoComplete="off" />
          <button type="submit" disabled={state.status === "running"}>{state.status === "running" ? "Searching…" : "Search"}</button>
        </div>
      </form>

      <section className="source-section" aria-label="Marketplace selection">
        <div className="section-heading"><h2>Search on</h2><button type="button" className="text-button" title="Custom marketplaces are coming next">+ Add marketplace</button></div>
        <div className="source-list">
          {sources.map((source) => <SourceToggle key={source.id} source={source} checked={state.selectedSourceIds.includes(source.id)} onToggle={() => dispatch({ type: "toggle_source", sourceId: source.id })} />)}
        </div>
      </section>

      {state.error && <div className="error-banner" role="alert">{state.error}</div>}
      {hasSearch && <ActivityPanel sources={sources} selectedIds={state.selectedSourceIds} progress={state.sourceProgress} />}

      <section className="results-section" aria-live="polite">
        <div className="results-heading">
          <div><h2>Results {state.listings.length ? `(${state.listings.length})` : ""}</h2><p>{state.status === "running" ? "New finds appear as agents finish." : state.status === "complete" ? "Search complete." : "Your best local finds will appear here."}</p></div>
          {hasSearch && <div className="controls">
            <select value={sort} onChange={(event) => setSort(event.target.value as "relevance" | "price")} aria-label="Sort results"><option value="relevance">Relevance</option><option value="price">Lowest price</option></select>
            <select value={marketplaceFilter} onChange={(event) => setMarketplaceFilter(event.target.value)} aria-label="Filter by marketplace"><option value="all">All sources</option>{sources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}</select>
            <input value={maxPrice} onChange={(event) => setMaxPrice(event.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" placeholder="Max $" aria-label="Maximum price" />
          </div>}
        </div>
        {!hasSearch ? <div className="empty-state"><span aria-hidden="true">⌕</span><h3>One search. Every good find.</h3><p>Pick your marketplaces and Scout’s agents will compare listings for you.</p></div> : visibleListings.length ? <div className="listing-grid">{visibleListings.map((listing) => <ListingCard key={listing.id} listing={listing} />)}</div> : <div className="empty-state compact"><span className="loader" aria-hidden="true" /><p>{state.status === "running" ? "Agents are checking listings…" : "No listings match those filters."}</p></div>}
      </section>
    </main>
  );
}
