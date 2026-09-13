import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { Listing, MarketplaceSource } from "@gehackathon/shared";
import { DEFAULT_SOURCES } from "@gehackathon/shared";
import { ApiError, searchApi } from "../lib/api";
import { initialSearchState, searchReducer, type SourceProgress } from "../lib/search-state";
import { loadSearchSession, openSearchWorkspace, saveSearchSession } from "../lib/search-session";

const phaseLabel: Record<SourceProgress["phase"], string> = {
  idle: "Queued",
  searching: "Searching…",
  extracting: "Extracting…",
  ranking: "AI is evaluating matches…",
  complete: "Complete",
  error: "Couldn’t search",
  needs_login: "Sign-in needed",
  skipped: "Not searched",
};

function describeSearchError(error: unknown): string {
  if (error instanceof ApiError && error.status === 404) {
    return "Scout’s server no longer has this search, so live updates stopped. Start the search again.";
  }
  return error instanceof Error ? error.message : "Live search updates failed.";
}

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
            {item.liveSessionUrl ? <a className="watch-link" href={item.liveSessionUrl} target="_blank" rel="noreferrer">{item.phase === "needs_login" ? "Sign in ↗" : "Watch live ↗"}</a> : null}
          </div>
        );
      })}
    </section>
  );
}

function SignInPrompt({ sources, progress }: { sources: MarketplaceSource[]; progress: Record<string, SourceProgress> }) {
  const source = sources.find((item) => progress[item.id]?.phase === "needs_login");
  if (!source) return null;
  const item = progress[source.id];
  return (
    <aside className="sign-in-prompt" role="alert">
      <div>
        <strong>Sign in to {source.name} to continue</strong>
        <p>{item.message ?? "Complete sign-in in the live Steel session. Scout will continue automatically."}</p>
      </div>
      {item.liveSessionUrl ? <a href={item.liveSessionUrl} target="_blank" rel="noreferrer">Open sign-in ↗</a> : null}
    </aside>
  );
}

/** Popup Widget Listing Card (Exact card from after that message) */
function WidgetListingCard({ listing }: { listing: Listing }) {
  return (
    <article className="listing-card">
      <div className="listing-image">
        {listing.imageUrl ? <img src={listing.imageUrl} alt="" /> : <span aria-hidden="true">{listing.title.split(" ")[0].slice(0, 1)}</span>}
      </div>
      <div className="listing-content">
        <div className="card-topline">
          <span className="badge">{listing.sourceName}</span>
          {listing.postedAt && <span className="freshness">{listing.postedAt}</span>}
        </div>
        <h3>{listing.title}</h3>
        <p className="listing-price">{formatPrice(listing)}</p>
        <p className="listing-meta">{[listing.location, listing.condition].filter(Boolean).join(" · ") || "Details available on listing"}</p>
        <a className="open-listing" href={listing.url} target="_blank" rel="noreferrer">Open listing <span aria-hidden="true">↗</span></a>
      </div>
    </article>
  );
}

/** Web Page Workspace Listing Card (Facebook Marketplace Photo-First Style) */
function WebListingCard({ listing }: { listing: Listing }) {
  return (
    <a className="web-listing-card" href={listing.url} target="_blank" rel="noreferrer">
      <div className="web-card-image-container">
        {listing.imageUrl ? (
          <img src={listing.imageUrl} alt={listing.title} loading="lazy" />
        ) : (
          <div className="web-card-image-fallback">
            <span>{listing.sourceName.slice(0, 2).toUpperCase()}</span>
          </div>
        )}
        <span className="source-tag">{listing.sourceName}</span>
        {listing.postedAt && <span className="freshness-tag">{listing.postedAt}</span>}
      </div>
      <div className="web-card-content">
        <div className="web-card-price">{formatPrice(listing)}</div>
        <h3 className="web-card-title" title={listing.title}>{listing.title}</h3>
        <p className="web-card-meta">
          {[listing.location, listing.condition].filter(Boolean).join(" · ") || "Location on listing"}
        </p>
      </div>
    </a>
  );
}

export function App() {
  const [state, dispatch] = useReducer(searchReducer, initialSearchState);
  const [sources, setSources] = useState<MarketplaceSource[]>(DEFAULT_SOURCES);
  const [sort, setSort] = useState<"relevance" | "price">("relevance");
  const [marketplaceFilter, setMarketplaceFilter] = useState("all");
  const [maxPrice, setMaxPrice] = useState("");
  const [storageReady, setStorageReady] = useState(false);
  const restoredSourceIds = useRef<string[] | undefined>(undefined);

  const [isWorkspace, setIsWorkspace] = useState(() => {
    const param = new URLSearchParams(window.location.search).get("view");
    return param === "workspace" || window.innerWidth >= 800;
  });

  useEffect(() => {
    const handleResize = () => {
      const param = new URLSearchParams(window.location.search).get("view");
      setIsWorkspace(param === "workspace" || window.innerWidth >= 800);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    let live = true;
    void loadSearchSession().then((savedState) => {
      if (!live) return;
      if (savedState) {
        restoredSourceIds.current = savedState.selectedSourceIds;
        dispatch({ type: "restore", state: savedState });
      }
      setStorageReady(true);
    });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    let live = true;
    searchApi.getSources().then((loadedSources) => {
      if (!live) return;
      setSources(loadedSources);
      const restoredIds = restoredSourceIds.current?.filter((id) => loadedSources.some((source) => source.id === id));
      dispatch({ type: "set_sources", sourceIds: restoredIds?.length ? restoredIds : loadedSources.filter((source) => source.enabled).map((source) => source.id) });
    }).catch((error: unknown) => {
      if (live) dispatch({ type: "error", message: error instanceof Error ? error.message : "Could not load marketplaces." });
    });
    return () => { live = false; };
  }, [storageReady]);

  useEffect(() => {
    if (storageReady) void saveSearchSession(state);
  }, [state, storageReady]);

  // Follow the live event stream for whichever job is running. This covers a
  // search started from this page and a search restored from the saved
  // session: the popup closes whenever it loses focus (for example when the
  // Steel sign-in tab opens), which drops the stream mid-search. The server
  // replays the job's full event log on every connection, so subscribing again
  // rebuilds each marketplace's phase and its authoritative listing count.
  useEffect(() => {
    if (!storageReady || !state.jobId || state.status !== "running") return;
    let live = true;
    const cancel = searchApi.subscribe(
      state.jobId,
      (searchEvent) => { if (live) dispatch({ type: "event", event: searchEvent }); },
      (error) => { if (live) dispatch({ type: "error", message: describeSearchError(error) }); },
    );
    return () => { live = false; cancel(); };
  }, [state.jobId, state.status, storageReady]);

  // Once a job is complete, show the server's final ranked, deduplicated feed
  // rather than the order the batches happened to stream in.
  useEffect(() => {
    if (!storageReady || !state.jobId || state.status !== "complete") return;
    let live = true;
    void searchApi.getSearchJob(state.jobId)
      .then((snapshot) => { if (live) dispatch({ type: "replace_listings", listings: snapshot.listings }); })
      .catch(() => undefined);
    return () => { live = false; };
  }, [state.jobId, state.status, storageReady]);

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
    try {
      const { jobId } = await searchApi.startSearch(query, state.selectedSourceIds);
      dispatch({ type: "start", jobId, sourceIds: state.selectedSourceIds });
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

  // =============================================================
  // WEB PAGE (Facebook Marketplace Layout)
  // =============================================================
  if (isWorkspace) {
    return (
      <main className="web-workspace">
        <aside className="web-sidebar">
          <header className="web-sidebar-header">
            <div className="brand">
              <div className="brand-mark" aria-hidden="true">S</div>
              <h1>Scout</h1>
            </div>
            {searchApi.isMock && <span className="demo-badge">Demo</span>}
          </header>

          <form className="web-search-form" onSubmit={handleSearch}>
            <div className="query-row">
              <input
                id="web-query"
                value={state.query}
                onChange={(event) => dispatch({ type: "set_query", query: event.target.value })}
                placeholder="Search secondhand..."
                autoComplete="off"
              />
              <button type="submit" disabled={state.status === "running"}>
                {state.status === "running" ? "…" : "Search"}
              </button>
            </div>
          </form>

          <section className="source-section" aria-label="Marketplace selection">
            <div className="section-heading">
              <h2>Marketplaces</h2>
            </div>
            <div className="source-list-vertical">
              {sources.map((source) => (
                <SourceToggle
                  key={source.id}
                  source={source}
                  checked={state.selectedSourceIds.includes(source.id)}
                  onToggle={() => dispatch({ type: "toggle_source", sourceId: source.id })}
                />
              ))}
            </div>
          </section>

          <section className="filter-section" aria-label="Filters">
            <div className="section-heading">
              <h2>Filters</h2>
            </div>
            <div className="sidebar-filters">
              <div className="filter-row">
                <label htmlFor="web-sort">Sort by</label>
                <select
                  id="web-sort"
                  value={sort}
                  onChange={(event) => setSort(event.target.value as "relevance" | "price")}
                >
                  <option value="relevance">Relevance</option>
                  <option value="price">Lowest price</option>
                </select>
              </div>
              <div className="filter-row">
                <label htmlFor="web-source-filter">Marketplace</label>
                <select
                  id="web-source-filter"
                  value={marketplaceFilter}
                  onChange={(event) => setMarketplaceFilter(event.target.value)}
                >
                  <option value="all">All marketplaces</option>
                  {sources.map((source) => (
                    <option key={source.id} value={source.id}>{source.name}</option>
                  ))}
                </select>
              </div>
              <div className="filter-row">
                <label htmlFor="web-max-price">Max price</label>
                <input
                  id="web-max-price"
                  value={maxPrice}
                  onChange={(event) => setMaxPrice(event.target.value.replace(/[^0-9]/g, ""))}
                  inputMode="numeric"
                  placeholder="$ Any"
                />
              </div>
            </div>
          </section>

          {state.error && <div className="error-banner" role="alert">{state.error}</div>}
          {hasSearch && <SignInPrompt sources={sources} progress={state.sourceProgress} />}
          {hasSearch && <ActivityPanel sources={sources} selectedIds={state.selectedSourceIds} progress={state.sourceProgress} />}
        </aside>

        <section className="web-main" aria-live="polite">
          <div className="web-results-heading">
            <div>
              <h2>{state.query ? `Results for "${state.query}"` : "Today's picks"}</h2>
              <p>
                {state.status === "running"
                  ? "Scanning marketplaces live…"
                  : state.listings.length
                  ? `${visibleListings.length} listing${visibleListings.length === 1 ? "" : "s"} found`
                  : "Enter a search in the sidebar to scan all secondhand marketplaces."}
              </p>
            </div>
          </div>

          {!hasSearch ? (
            <div className="empty-state">
              <span aria-hidden="true">⌕</span>
              <h3>No search entered yet</h3>
              <p>Type what you're looking for in the sidebar to search Facebook, Kijiji, and eBay simultaneously.</p>
            </div>
          ) : visibleListings.length ? (
            <div className="web-listing-grid">
              {visibleListings.map((listing) => (
                <WebListingCard key={listing.id} listing={listing} />
              ))}
            </div>
          ) : (
            <div className="empty-state compact">
              {state.status === "running" ? (
                <>
                  <span className="loader" aria-hidden="true" />
                  <p>Agents are checking listings…</p>
                </>
              ) : (
                <p>No listings match those filters.</p>
              )}
            </div>
          )}
        </section>
      </main>
    );
  }

  // =============================================================
  // EXTENSION POPUP WIDGET (Exact Layout & Structure from before)
  // =============================================================
  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand-mark" aria-hidden="true">S</div>
        <h1>Scout</h1>
        {searchApi.isMock && <span className="demo-badge">Demo mode</span>}
      </header>

      <form className="search-form" onSubmit={handleSearch}>
        <label htmlFor="query">What are you looking for?</label>
        <div className="query-row">
          <input
            id="query"
            value={state.query}
            onChange={(event) => dispatch({ type: "set_query", query: event.target.value })}
            placeholder="used dumbbells under $50 near Kensington"
            autoComplete="off"
          />
          <button type="submit" disabled={state.status === "running"}>
            {state.status === "running" ? "Searching…" : "Search"}
          </button>
        </div>
      </form>

      <section className="source-section" aria-label="Marketplace selection">
        <div className="section-heading">
          <h2>Search on</h2>
          <button type="button" className="text-button" title="Custom marketplaces are coming next">+ Add marketplace</button>
        </div>
        <div className="source-list">
          {sources.map((source) => (
            <SourceToggle
              key={source.id}
              source={source}
              checked={state.selectedSourceIds.includes(source.id)}
              onToggle={() => dispatch({ type: "toggle_source", sourceId: source.id })}
            />
          ))}
        </div>
      </section>

      {state.error && <div className="error-banner" role="alert">{state.error}</div>}
      {hasSearch && <ActivityPanel sources={sources} selectedIds={state.selectedSourceIds} progress={state.sourceProgress} />}
      {hasSearch && <SignInPrompt sources={sources} progress={state.sourceProgress} />}

      <section className="results-section" aria-live="polite">
        <div className="results-heading">
          <div>
            <h2>Results {state.listings.length ? `(${state.listings.length})` : ""}</h2>
            <p>{state.status === "running" ? "New finds appear as agents finish." : state.status === "complete" ? "Search complete." : "Your best local finds will appear here."}</p>
          </div>
          {hasSearch && (
            <div className="results-actions">
              <button
                type="button"
                className="text-button workspace-button"
                onClick={() => {
                  void saveSearchSession(state);
                  openSearchWorkspace();
                }}
              >
                Keep results open ↗
              </button>
              <div className="controls">
                <select value={sort} onChange={(event) => setSort(event.target.value as "relevance" | "price")} aria-label="Sort results">
                  <option value="relevance">Relevance</option>
                  <option value="price">Lowest price</option>
                </select>
                <select value={marketplaceFilter} onChange={(event) => setMarketplaceFilter(event.target.value)} aria-label="Filter by marketplace">
                  <option value="all">All sources</option>
                  {sources.map((source) => (
                    <option key={source.id} value={source.id}>{source.name}</option>
                  ))}
                </select>
                <input
                  value={maxPrice}
                  onChange={(event) => setMaxPrice(event.target.value.replace(/[^0-9]/g, ""))}
                  inputMode="numeric"
                  placeholder="Max $"
                  aria-label="Maximum price"
                />
              </div>
            </div>
          )}
        </div>

        {!hasSearch ? (
          <div className="empty-state">
            <span aria-hidden="true">⌕</span>
            <h3>One search. Every good find.</h3>
            <p>Pick your marketplaces and Scout’s agents will compare listings for you.</p>
          </div>
        ) : visibleListings.length ? (
          <div className="listing-grid">
            {visibleListings.map((listing) => (
              <WidgetListingCard key={listing.id} listing={listing} />
            ))}
          </div>
        ) : (
          <div className="empty-state compact">
            <span className="loader" aria-hidden="true" />
            <p>{state.status === "running" ? "Agents are checking listings…" : "No listings match those filters."}</p>
          </div>
        )}
      </section>
    </main>
  );
}
