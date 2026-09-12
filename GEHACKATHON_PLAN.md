# GeHackathon — Universal Secondhand Marketplace Web Agent

> **Status:** Implementation plan
> **Project type:** Browser extension + web-agent backend
> **Track:** Web Agents
> **Team:** 2 people + 2 coding agents
> **Primary goal:** Build a polished browser extension that lets a user describe what they want to buy, then launches web agents that search multiple secondhand marketplaces in parallel and return normalized, ranked listings.

---

## 1. Product Vision

### The problem

Shopping for used goods is fragmented. A person looking for something like:

- `free bicycle near me`
- `used dumbbells under $50 near Kensington Market`
- `used ThinkPad under $400 in Toronto`
- `cheap desk, pickup only, within 10 km`

has to search several marketplaces independently, repeat filters, compare inconsistent listings, and manually open a large number of tabs.

### The solution

A browser extension acts as a **universal marketplace search agent**.

The user gives the extension a natural-language request and selects which marketplaces to search. The system then creates browser sessions for the selected sites, navigates them as a human would, extracts listing information, normalizes it into a common schema, removes obvious duplicates, and ranks the results.

The important architectural principle is:

> **The product should not fundamentally depend on one API, RSS feed, or hand-written scraper for each marketplace. The agent should be able to operate a website through a real browser session.**

The initial marketplaces are useful defaults, not hard-coded architectural dependencies.

### Core value proposition

**Search once. Let the web agents do the tab-switching.**

---

# 2. Hackathon Strategy

This project should optimize for three things simultaneously:

1. **A convincing agent demo** — judges can see an actual browser agent searching the web.
2. **A useful consumer product** — the result is not just a technical demo; it solves an annoying workflow.
3. **Extensibility** — adding another marketplace should not require writing another dedicated scraper from scratch.

The demo should make the following progression visible:

```text
Natural language request
        ↓
Extension parses intent
        ↓
Selected marketplace agents launch in parallel
        ↓
Agents navigate real websites
        ↓
Listings are extracted into one schema
        ↓
Listings are deduplicated + ranked
        ↓
One unified result feed
```

### The strongest demo moment

The ideal demo is:

1. Enter a realistic request.
2. Show 3–4 marketplace agents working simultaneously.
3. Open/expand the agent activity panel.
4. Let the audience watch at least one real browser session navigate a marketplace.
5. Results begin appearing before all agents finish.
6. The extension merges everything into one clean feed.
7. Demonstrate that a new marketplace can be added without writing a marketplace-specific scraper.

A cached/mock result path should exist as a **demo safety net**, but the primary demo should visibly use real agent sessions.

---

# 3. Scope

## 3.1 MVP — must work

The MVP is complete when all of the following work together:

- Browser extension opens as the main user interface.
- User enters a natural-language shopping query.
- User can toggle marketplaces on/off.
- Extension sends a search job to backend.
- Backend launches one browser-agent task per selected marketplace.
- Agents search websites through browser sessions.
- Agents return structured listings.
- Listings are normalized into one shared schema.
- Results appear incrementally as agents finish.
- User can open an individual listing on the original marketplace.
- At least 2–3 real marketplaces work reliably enough for the demo.
- At least one marketplace is demonstrated primarily through browser interaction rather than a dedicated official API integration.

## 3.2 Stretch goals

Only implement these after the MVP is reliable:

- Add marketplace by URL.
- Agent discovers an unfamiliar marketplace workflow automatically.
- Save/reuse a learned site recipe.
- Distance-based ranking.
- Price/value ranking.
- User-defined preferences such as `pickup only`, `newest first`, or `within 5 km`.
- Favorite/save listing functionality.
- Search history.
- Background re-search / alerts.
- Compare two listings side-by-side.
- Explain *why* a result was ranked highly.
- Human-in-the-loop login flow inside the extension.

## 3.3 Explicit non-goals for MVP

Do not spend the majority of hackathon time on:

- Building a full account system.
- Complex social features.
- Production-grade marketplace authentication management.
- Automated checkout/purchasing.
- Sophisticated machine-learning ranking models.
- Perfect support for every marketplace on the internet.
- A giant database of marketplace-specific selectors.

---

# 4. System Architecture

## 4.1 High-level architecture

```text
┌───────────────────────────────────────────────────────┐
│                  Browser Extension                    │
│                                                       │
│  Search UI    Marketplace Toggles    Results Feed    │
│      │                │                    ▲          │
│      └────────────────┴────────────┐       │          │
│                                   │       │          │
│                            Extension API   │          │
└───────────────────────────────────┼───────┼──────────┘
                                    │       │
                                    ▼       │
                         ┌──────────────────┐
                         │   Backend API    │
                         │                  │
                         │ Query Parser     │
                         │ Job Orchestrator │
                         │ Normalizer       │
                         │ Deduper/Ranker   │
                         └────────┬─────────┘
                                  │
                    ┌─────────────┼─────────────┐
                    ▼             ▼             ▼
              ┌──────────┐ ┌──────────┐ ┌──────────┐
              │ Steel    │ │ Steel    │ │ Steel    │
              │ Session  │ │ Session  │ │ Session  │
              │ Site A   │ │ Site B   │ │ Site C   │
              └────┬─────┘ └────┬─────┘ └────┬─────┘
                   │             │             │
                   ▼             ▼             ▼
              Marketplace   Marketplace   Marketplace
```

## 4.2 Recommended technology split

### Extension

- **TypeScript**
- **React** for UI
- **Vite** or equivalent extension-oriented bundler
- **Manifest V3** for Chromium-based browsers
- Browser storage for lightweight local preferences
- Server-Sent Events (SSE) or WebSocket for incremental result updates

### Backend

- **TypeScript / Node.js**
- REST API for search jobs
- SSE for streaming search progress/results
- Steel.dev browser sessions
- Stagehand and/or Playwright for browser control
- Zod or equivalent for structured extraction validation
- In-memory state for MVP; Redis/database only if actually needed

### LLM

Use one LLM provider initially.

LLM responsibilities should be narrow and explicit:

- Convert natural-language query into structured search intent.
- Drive unfamiliar sites when deterministic automation is insufficient.
- Extract or validate listing information when page structure is ambiguous.
- Optionally generate a learned site recipe.

Do **not** use an LLM for every trivial operation. Browser interaction should be deterministic whenever a reliable recipe already exists.

---

# 5. Shared Data Contracts

This is the most important coordination point between the two people/agents.

Both workstreams should implement against these interfaces before integrating.

## 5.1 Search intent

```ts
export interface SearchIntent {
  rawQuery: string;
  item: string;
  category?: string;
  maxPrice?: number;
  minPrice?: number;
  currency?: string;
  location?: {
    raw: string;
    latitude?: number;
    longitude?: number;
    radiusKm?: number;
  };
  condition?: "new" | "used" | "any";
  keywords?: string[];
  exclusions?: string[];
  pickupOnly?: boolean;
}
```

## 5.2 Marketplace source

```ts
export interface MarketplaceSource {
  id: string;
  name: string;
  domain: string;
  enabled: boolean;
  requiresLogin?: boolean;
  status?: "ready" | "learning" | "needs_login" | "error";
}
```

## 5.3 Listing

```ts
export interface Listing {
  id: string;
  sourceId: string;
  sourceName: string;
  title: string;
  price?: number;
  currency?: string;
  imageUrl?: string;
  url: string;
  location?: string;
  seller?: string;
  condition?: string;
  postedAt?: string;
  description?: string;
  extractedAt: string;
  confidence?: number;
}
```

## 5.4 Search job events

```ts
export type SearchEvent =
  | {
      type: "job_started";
      jobId: string;
    }
  | {
      type: "source_started";
      sourceId: string;
      sourceName: string;
    }
  | {
      type: "source_status";
      sourceId: string;
      status: "searching" | "extracting" | "complete" | "error";
      message?: string;
    }
  | {
      type: "listing_batch";
      sourceId: string;
      listings: Listing[];
    }
  | {
      type: "source_complete";
      sourceId: string;
      count: number;
    }
  | {
      type: "job_complete";
      jobId: string;
    };
```

These contracts should live in a shared package, e.g.:

```text
packages/shared/src/types.ts
```

Do this early to prevent both agents from independently inventing incompatible shapes.

---

# 6. Repository Structure

Recommended monorepo:

```text
gehackathon/
├── apps/
│   ├── extension/
│   │   ├── src/
│   │   │   ├── popup/
│   │   │   ├── options/
│   │   │   ├── background/
│   │   │   ├── content/
│   │   │   ├── components/
│   │   │   └── lib/
│   │   ├── public/
│   │   ├── manifest.json
│   │   └── package.json
│   │
│   └── server/
│       ├── src/
│       │   ├── api/
│       │   ├── agents/
│       │   ├── orchestration/
│       │   ├── extraction/
│       │   ├── ranking/
│       │   ├── recipes/
│       │   └── lib/
│       └── package.json
│
├── packages/
│   └── shared/
│       ├── src/
│       │   ├── types.ts
│       │   ├── schemas.ts
│       │   └── constants.ts
│       └── package.json
│
├── docs/
│   ├── architecture.md
│   ├── demo.md
│   └── marketplace-notes.md
│
├── .env.example
├── package.json
├── README.md
└── pnpm-workspace.yaml
```

A simpler npm workspace is fine if the team prefers it. The important part is that the extension and server can develop independently while sharing the same types.

---

# 7. Work Allocation

The division below is intentionally designed so that neither person is just doing “frontend” or “backend” in isolation. Each workstream owns a substantial vertical slice.

## Person / Agent A — Agent Infrastructure + Marketplace Search

**Primary ownership:** browser agents, Steel integration, extraction, site recipes, backend search orchestration.

### A1. Project scaffolding

- Create server application.
- Create shared package.
- Add environment configuration.
- Add basic health endpoint.
- Add typed API client definitions.
- Add linting/typechecking/testing.

### A2. Query parsing

Implement:

```text
raw natural-language query
        ↓
LLM
        ↓
SearchIntent
```

Requirements:

- Stable JSON/schema output.
- Handle missing fields gracefully.
- Preserve the original query.
- Never reject reasonable vague requests just because a field is absent.

Example:

```text
"free bicycle near downtown Toronto"
```

becomes approximately:

```json
{
  "rawQuery": "free bicycle near downtown Toronto",
  "item": "bicycle",
  "maxPrice": 0,
  "location": {
    "raw": "downtown Toronto"
  },
  "condition": "any"
}
```

### A3. Steel session abstraction

Build one generic interface around Steel:

```ts
interface BrowserAgent {
  search(
    source: MarketplaceSource,
    intent: SearchIntent
  ): Promise<Listing[]>;
}
```

The rest of the backend should not need to know the details of Steel sessions.

Responsibilities:

- Create/reuse sessions.
- Configure sessions.
- Connect through Playwright or Stagehand.
- Capture logs/traces.
- Handle timeouts.
- Close/clean up sessions.
- Surface a debug/live session URL when useful.

### A4. Generic marketplace discovery

Build the agent capable of:

1. Open a marketplace.
2. Understand the site's page.
3. Find the search interaction.
4. Perform the search.
5. Apply useful filters where feasible.
6. Extract listing cards.
7. Produce the common `Listing` schema.

The agent should prioritize structured page information/DOM where possible and use screenshots/vision reasoning only when needed.

### A5. Learned site recipes

After successful discovery, store a lightweight recipe such as:

```ts
interface SiteRecipe {
  domain: string;
  searchUrlTemplate?: string;
  searchSteps: Array<{
    action: string;
    target: string;
  }>;
  resultSelector?: string;
  fieldSelectors?: {
    title?: string;
    price?: string;
    image?: string;
    location?: string;
    url?: string;
  };
  learnedAt: string;
}
```

The recipe is a performance optimization, not the source of truth.

Flow:

```text
Known recipe?
   ├─ yes → deterministic execution
   └─ no  → agent discovery
                 ↓
             successful?
                 ↓
             save recipe
```

### A6. Search orchestration

Implement parallel execution:

```ts
await Promise.allSettled(
  selectedSources.map(source => runSourceSearch(source, intent))
);
```

Important requirements:

- One failing marketplace must not kill the whole search.
- Results should be emitted incrementally.
- Each source has a status.
- Timeout each source independently.
- Preserve partial results.

### A7. Normalization / deduplication / ranking

Normalize all sources into `Listing`.

Basic dedupe strategy:

- Same canonical URL → duplicate.
- Similar title + similar price + similar location → probable duplicate.

Basic ranking strategy:

```text
score =
  relevanceScore
  + priceScore
  + recencyScore
  + locationScore
  + completenessScore
```

Do not overengineer this. A deterministic heuristic is sufficient for MVP.

### A8. Backend tests

At minimum:

- Query parser schema tests.
- Listing schema validation.
- Recipe serialization tests.
- Deduplication tests.
- Ranking tests.
- Mocked marketplace agent integration test.
- Failure/timeout test.

---

## Person / Agent B — Extension Product + User Experience

**Primary ownership:** browser extension, user flow, streaming UI, marketplace controls, agent activity, demo polish.

### B1. Extension scaffolding

- Manifest V3.
- React + TypeScript.
- Popup/page architecture.
- Build/load instructions.
- Development mode.
- API client.

The extension should have a layout that feels like a real product, not a debug panel.

### B2. Main search interface

Build the primary screen around:

```text
┌───────────────────────────────────────────────┐
│ What are you looking for?                     │
│                                               │
│ used dumbbells under $50 near Kensington      │
│                                   [ Search ]  │
├───────────────────────────────────────────────┤
│ Search on                                      │
│ [✓ Facebook] [✓ Kijiji] [✓ eBay] [✓ Craigslist] │
│                           [+ Add marketplace] │
├───────────────────────────────────────────────┤
│ Agent activity                                │
│ ● Facebook Marketplace   Searching...        │
│ ● Kijiji                  14 listings         │
│ ● eBay                    Extracting...       │
├───────────────────────────────────────────────┤
│ Results (27)                                  │
│                                               │
│ [listing] [listing] [listing]                 │
│ [listing] [listing] [listing]                 │
└───────────────────────────────────────────────┘
```

### B3. Marketplace toggles

Users should be able to:

- Enable/disable default marketplaces.
- See whether a source is ready.
- See whether a source requires login.
- Add a custom marketplace URL later.

For MVP, the default sources should be visible as configurable toggles even if only some are fully operational.

### B4. Streaming results

The UI should react to backend events:

```text
job started
→ source started
→ source status
→ listing batch
→ source complete
→ job complete
```

This is important to the agent demo. Do **not** wait for every marketplace to finish before rendering results.

### B5. Agent activity UI

Build a compact activity panel showing:

- Which site is being searched.
- Current phase.
- Number of listings found.
- Errors.
- Optional `Watch agent` / `Open session` action.

Example:

```text
Facebook Marketplace
Searching listings…

[ Watch live ]
```

This is where Steel's browser-session visibility becomes a product feature rather than a behind-the-scenes implementation detail.

### B6. Listing cards

Each card should show:

- image
- title
- price
- marketplace badge
- location
- condition if available
- freshness if available
- `Open listing` button

Do not overload cards with extracted text. The extension is an aggregator, so scanability matters.

### B7. Result controls

MVP:

- Sort by relevance.
- Sort by price.
- Filter by marketplace.
- Filter by maximum price.

Stretch:

- distance radius
- pickup only
- condition
- newest first

### B8. Extension state management

The UI needs a small state model:

```ts
interface SearchState {
  query: string;
  intent?: SearchIntent;
  status: "idle" | "running" | "complete" | "error";
  selectedSources: string[];
  sourceStatuses: Record<string, string>;
  listings: Listing[];
}
```

Do not introduce a large state-management library unless the app actually needs one.

### B9. UX polish

Focus on:

- fast first paint
- clear empty state
- loading skeletons
- obvious search action
- responsive listing grid
- clean typography
- source badges
- helpful error states
- keyboard accessibility

The visual quality of this extension is part of the hackathon judging experience.

### B10. Extension tests

At minimum:

- Search form tests.
- Marketplace toggle tests.
- Listing card tests.
- Streaming event reducer/state tests.
- Error state tests.
- End-to-end test against a mocked backend event stream.

---

# 8. Shared Integration Responsibilities

Neither person owns these alone.

## 8.1 Shared API contract

Backend and extension must agree on:

```text
POST /search
GET  /search/:jobId/events
GET  /sources
```

Example request:

```json
{
  "query": "used laptop under $500 near Toronto",
  "sources": ["facebook", "kijiji", "ebay"]
}
```

Example response:

```json
{
  "jobId": "job_123"
}
```

The extension then subscribes to the event stream.

## 8.2 Local development mode

Add a mock mode to the backend:

```text
MOCK_AGENTS=true
```

This returns deterministic sample results and lets the extension be developed without Steel sessions.

This dramatically reduces cross-team blocking.

## 8.3 Contract fixtures

Commit fixtures like:

```text
fixtures/
├── search-intent.json
├── listings.json
└── events.json
```

Both workstreams should use these for local development and tests.

---

# 9. Agent Design

## 9.1 The universal agent mental model

The backend should treat every marketplace as:

```text
Marketplace URL
+ SearchIntent
        ↓
Browser session
        ↓
Observe page
        ↓
Choose interaction
        ↓
Search
        ↓
Extract listings
        ↓
Validate schema
```

The agent is allowed to be uncertain.

For example:

```text
"I cannot find a search box."
        ↓
Try navigation/search URL inference
        ↓
If still uncertain → use visual inspection
        ↓
If blocked → surface failure
```

Do not build an enormous autonomous browser system. Build the smallest reliable loop that solves the marketplace-search problem.

## 9.2 Stagehand / Playwright layering

A practical hierarchy:

### Level 1 — deterministic browser automation

Use known selectors/URLs when reliable.

### Level 2 — Stagehand semantic actions

For actions such as:

```text
"Search for used bicycles"
```

### Level 3 — visual/LLM fallback

Use when the site layout or interaction is ambiguous.

This gives the system a useful balance between reliability and flexibility.

---

# 10. Marketplace Strategy

Start with 3–4 sources, but do not make the architecture source-specific.

A sensible initial set:

- Facebook Marketplace
- Kijiji
- eBay
- Craigslist

Treat them as **preconfigured sources**.

## 10.1 Source registry

```ts
const defaultSources: MarketplaceSource[] = [
  {
    id: "facebook",
    name: "Facebook Marketplace",
    domain: "facebook.com",
    enabled: true,
  },
  {
    id: "kijiji",
    name: "Kijiji",
    domain: "kijiji.ca",
    enabled: true,
  },
  {
    id: "ebay",
    name: "eBay",
    domain: "ebay.com",
    enabled: true,
  },
  {
    id: "craigslist",
    name: "Craigslist",
    domain: "craigslist.org",
    enabled: true,
  },
];
```

The agent implementation should not contain giant branches such as:

```ts
if (source === "facebook") ...
else if (source === "kijiji") ...
```

Only source-specific configuration should be source-specific.

---

# 11. Custom Marketplace Addition

This is a major stretch feature because it makes the product concept much more compelling.

User flow:

```text
+ Add marketplace
        ↓
Paste marketplace URL
        ↓
Agent opens site
        ↓
Agent discovers search workflow
        ↓
Agent performs a test search
        ↓
Agent extracts sample results
        ↓
User confirms
        ↓
Save marketplace
```

The stored object can be:

```ts
interface LearnedMarketplace {
  source: MarketplaceSource;
  recipe?: SiteRecipe;
  exampleQuery?: string;
  verifiedAt?: string;
}
```

This feature is more valuable in the demo than adding ten manually coded marketplaces.

---

# 12. Login / Human-in-the-Loop

Some marketplaces may require authentication, bot checks, or user interaction.

Do not attempt to make the system invisibly defeat every anti-bot mechanism.

Instead:

```text
Agent encounters login / challenge
        ↓
Status = needs_login
        ↓
Extension shows:
"This marketplace needs you to sign in"
        ↓
User opens the live browser session
        ↓
User completes required interaction
        ↓
Agent resumes
```

This also creates a compelling visible agent demo.

Store browser identity/session data only through the appropriate Steel/browser mechanisms. Never hard-code credentials into source code.

---

# 13. Error Handling

Each source must fail independently.

Example:

```text
Facebook       ✓ 12 listings
Kijiji         ✓ 9 listings
eBay           ✓ 16 listings
Craigslist     ✗ timed out
```

The result page should still display 37 listings.

Useful statuses:

```text
idle
starting
searching
extracting
complete
needs_login
blocked
timeout
error
```

The backend should convert technical errors into short user-facing messages.

Bad:

```text
TargetCloseError: frame detached
```

Better:

```text
Craigslist stopped responding, so we skipped it.
```

---

# 14. Ranking and Recommendation

The product is more than a search-result dump. It should feel like a recommendation engine.

## 14.1 MVP score

Start with transparent heuristics.

Potential normalized signals:

```text
relevance: 0–1
priceFit: 0–1
locationFit: 0–1
recency: 0–1
completeness: 0–1
```

Then:

```text
score =
  0.40 * relevance +
  0.25 * priceFit +
  0.20 * locationFit +
  0.10 * recency +
  0.05 * completeness
```

Weights should be constants in one file so they are easy to tune during the hackathon.

## 14.2 Recommendation explanation

A strong stretch feature is a small explanation:

> **Best match:** under budget, close to your requested area, and posted recently.

This makes the ranking feel intentional instead of arbitrary.

---

# 15. Performance

The architecture should embrace parallelism.

Bad:

```text
Search site A
wait
Search site B
wait
Search site C
wait
```

Good:

```text
             ┌─ Search A
             ├─ Search B
Search job ──┼─ Search C
             └─ Search D
```

And stream results as they arrive.

### Practical controls

- Limit concurrent sessions.
- Per-source timeout.
- Overall job timeout.
- Retry at most once for transient errors.
- Cancel remaining work when the user explicitly cancels a job.
- Reuse learned recipes where possible.

---

# 16. Demo Reliability Layer

This deserves its own implementation task.

The app should have three operating modes:

### LIVE

Actually launches Steel sessions.

### MOCK

Uses deterministic local agent fixtures.

### DEMO

Uses live sessions where they are reliable and known-good cached data where necessary.

The UI should still look identical in all three modes.

The point is not to fake the product. The point is to make a live demo robust against an individual marketplace changing its HTML or becoming temporarily unavailable.

## 16.1 Known-good demo query

Choose one query with:

- obvious listings
- relatively stable search behavior
- enough cross-marketplace coverage
- visually interesting results

Keep a known-good fixture from a successful run.

## 16.2 Demo script

```text
1. Open extension.
2. Explain the fragmentation problem in one sentence.
3. Enter query.
4. Toggle 3–4 marketplaces.
5. Search.
6. Show agent activity.
7. Show first marketplace results arriving.
8. Show another marketplace browser session.
9. Show unified ranking.
10. Open one listing.
11. Add/simulate adding a new marketplace if the feature is stable.
```

Do not spend demo time explaining implementation before showing the product working.

---

# 17. Development Milestones

## Milestone 0 — Foundation

**Definition of done:** both workstreams can build/run the repo independently.

Person A:

- server scaffold
- shared contracts
- mock search API

Person B:

- extension scaffold
- UI shell
- mock event stream client

Joint:

- repo setup
- `.env.example`
- README
- branch strategy

---

## Milestone 1 — Vertical Slice

Goal: one query → one marketplace → results displayed in extension.

Person A:

- query parsing
- one Steel browser session
- extraction
- backend result endpoint

Person B:

- search screen
- one source toggle
- listing card
- API integration

Joint acceptance test:

```text
"used bicycle under $200"
        ↓
One browser session
        ↓
Real listings
        ↓
Extension listing cards
```

Do not move on until this works end-to-end.

---

## Milestone 2 — Parallel Multi-Marketplace Search

Person A:

- source registry
- parallel orchestration
- event streaming
- normalization
- dedupe
- ranking

Person B:

- source toggles
- source status UI
- streaming results UI
- error/partial result states

Acceptance test:

```text
3 sources selected
→ 3 searches start
→ results stream in independently
→ one source may fail
→ successful results still display
```

---

## Milestone 3 — Agent Visibility + Reliability

Person A:

- Steel session debug/live links
- recipe cache
- timeout/retry logic
- trace logging

Person B:

- `Watch agent` experience
- activity timeline
- loading states
- polished error states
- responsive result layout

Acceptance test:

A judge can understand *what the agent is doing* without seeing the code.

---

## Milestone 4 — Universal Marketplace Story

Only attempt after the core flow is stable.

Person A:

- custom URL discovery
- recipe generation/validation
- generic extraction fallback

Person B:

- Add marketplace UI
- learning state
- confirmation flow
- source management UI

Acceptance test:

```text
Paste unfamiliar marketplace URL
→ agent explores
→ test query succeeds
→ results appear
→ source becomes reusable
```

---

## Milestone 5 — Final Polish

Joint:

- visual polish
- demo query
- demo fixture
- README screenshots/GIF
- architecture diagram
- judges-facing explanation
- failure recovery
- packaging instructions

---

# 18. Git / Branch Strategy

Use small, focused branches.

Suggested naming:

```text
feat/extension-search-ui
feat/extension-streaming
feat/extension-marketplace-toggles
feat/server-steel-agent
feat/server-search-orchestrator
feat/server-ranking
feat/server-recipe-cache
fix/...
```

Avoid giant branches like:

```text
person-a-everything
person-b-everything
```

## Pull request rule

A PR should ideally represent one coherent change.

Before opening a PR:

```bash
pnpm lint
pnpm typecheck
pnpm test
```

For extension/backend contract changes, update the shared types and include a fixture or test.

---

# 19. Agent Collaboration Rules

The two coding agents should **not** modify the same core files casually.

## Agent A owns primarily

```text
apps/server/**
packages/shared/src/**
```

## Agent B owns primarily

```text
apps/extension/**
```

## Joint files

```text
README.md
docs/**
package.json / workspace config
```

Changes to shared contracts should be treated as an explicit coordination point.

### Important rule

**Never let an agent silently change a shared TypeScript interface because it is inconvenient.**

Instead:

1. Update the shared contract.
2. Update affected tests.
3. Update both consumers.

---

# 20. Testing Strategy

Testing should mirror the architecture.

## Unit tests

Test pure logic:

- query parsing adapters
- normalization
- dedupe
- ranking
- event reducers
- schema validation

## Integration tests

Test:

- backend `/search`
- event stream
- mocked Steel session
- extension API client

## Browser tests

Test the extension in Chromium:

```text
enter query
→ select sources
→ search
→ receive events
→ render listings
```

## Live agent smoke tests

Do not run live marketplace tests on every commit.

Instead maintain a small manually triggered smoke-test command.

Example:

```bash
pnpm test:agent -- --source facebook
```

---

# 21. Security and Privacy

The extension may handle sensitive browser/session information.

Principles:

- Never store marketplace passwords in this repo.
- Never log credentials or session cookies.
- Keep secrets in environment variables or Steel's supported credential/session mechanisms.
- Do not collect unnecessary personal information.
- Make it clear when a browser session is being controlled.
- Never automatically purchase or message sellers in the MVP.
- User must remain in control of authenticated actions.

---

# 22. Extension UX Details

## Popup vs full extension page

Do not force the entire experience into a tiny popup if the result feed becomes cramped.

Recommended UX:

- Clicking the extension opens a compact launcher.
- The main experience can open in an extension tab/page for a larger result surface.

This preserves the browser-extension identity while giving enough room for agent activity and listings.

## Empty state

Example:

```text
Search every marketplace at once.

Try:
“Free bike within 5 km”
“ThinkPad under $400”
“Dumbbells under $50 near me”
```

## Loading state

Make the agent feel alive without making the UI noisy.

```text
Searching Facebook Marketplace…
Found 8 listings
```

Avoid fake progress bars that imply precise completion percentages when they are not meaningful.

---

# 23. What Makes This Different From a Normal Aggregator?

This distinction must be obvious in the README and demo.

### Traditional aggregator

```text
Website A API
Website B API
Website C scraper
Website D custom integration
```

Every site becomes a bespoke engineering problem.

### This product

```text
User request
      ↓
Universal browser agent
      ↓
Real websites
```

The marketplace itself becomes a dynamic environment the agent can operate in.

This architecture makes it possible to support marketplaces that:

- do not expose an API,
- change their markup,
- require JavaScript,
- require interactive flows,
- or were never specifically integrated by the product team.

The product's long-term moat is therefore not a giant list of scrapers. It is the **ability to operate web interfaces generically**.

---

# 24. Potential Demo Narrative

The pitch should be approximately:

> Buying used stuff online is ridiculous. If I want a bicycle, I search Facebook Marketplace. Then Kijiji. Then eBay. Then Craigslist. I repeat the same search four times and compare dozens of tabs manually.
>
> We built a browser extension where you describe what you want once. Our web agents open the marketplaces for you, search them in parallel, extract the listings, and bring everything back into one ranked feed.
>
> And because these are browser agents, the marketplace does not need to expose an API for us to use it. We can operate the website like a human would.

Then demonstrate it.

---

# 25. Judge-Facing Technical Story

The technical explanation should focus on three ideas.

### 1. Real browser interaction

The system uses real browser sessions rather than assuming every website provides a clean API.

### 2. Parallel agent orchestration

Each marketplace is an independent agent task; one failing site does not prevent the others from returning results.

### 3. Learned site workflows

When the agent learns how to search an unfamiliar site, it can save what worked and reuse it later, reducing repeated reasoning and latency.

That creates a compelling progression:

```text
Browse manually
      ↓
Agent learns workflow
      ↓
Workflow is reused
      ↓
Marketplace becomes another configurable source
```

---

# 26. Nice-to-Have Features After MVP

These are ordered roughly by value-to-effort ratio.

## High value

- Custom marketplace URL.
- Saved marketplace recipes.
- Distance filtering.
- "Best value" ranking.
- Search history.
- Favorites.
- Live session viewer.

## Medium value

- Price anomaly detection.
- Comparable-listing analysis.
- Seller quality signals.
- Result clustering.
- Search alerts.

## Low value for this hackathon

- Full user accounts.
- Social feeds.
- Native mobile app.
- Automated checkout.
- Complex recommendation model training.

---

# 27. Definition of Done

The project is demo-ready when:

- [ ] Extension installs successfully in Chromium.
- [ ] Search UI feels polished.
- [ ] Natural-language queries become structured intent.
- [ ] User can toggle sources.
- [ ] At least 2–3 marketplace searches run through real browser sessions.
- [ ] Searches run concurrently.
- [ ] Results stream into the extension.
- [ ] Results share one normalized listing schema.
- [ ] Duplicate results are suppressed reasonably.
- [ ] Results have useful ranking.
- [ ] Individual listings link to their source.
- [ ] A single failed marketplace does not break the search.
- [ ] At least one real agent session can be visibly demonstrated.
- [ ] Login/blocked states fail gracefully.
- [ ] Demo fallback data exists.
- [ ] README explains setup and architecture.
- [ ] `.env.example` exists.
- [ ] No secrets are committed.
- [ ] Two-person task ownership is reflected in Git history/PRs.

---

# 28. Suggested Immediate Task Assignment

## Person A starts with

1. Create monorepo/shared types.
2. Create backend health endpoint.
3. Implement `SearchIntent` parsing.
4. Implement `BrowserAgent` abstraction.
5. Get one marketplace working through a Steel session.
6. Return validated `Listing[]`.
7. Add mocked agent implementation.
8. Add `/search` + SSE.

## Person B starts with

1. Create extension app/Manifest V3.
2. Build main search UI.
3. Build marketplace toggle row.
4. Build listing card component.
5. Build agent activity component.
6. Implement mock event stream consumer.
7. Render fixture listings.
8. Add loading/error/empty states.

## First integration

Do **not** wait until all backend work and all frontend work are finished.

Integrate as soon as this exists:

```text
POST /search
      ↓
jobId
      ↓
SSE listing_batch
      ↓
Extension renders cards
```

At that point, both people can continue improving their own side without blocking each other.

---

# 29. Final Engineering Principle

Build the product as a **universal browser-agent system with marketplaces as configuration**, not as four scrapers pretending to be an agent system.

The difference matters.

The MVP should be narrowly reliable, but the architecture should make the next marketplace mostly a matter of:

```text
URL
+ agent discovery
+ validation
+ optional learned recipe
```

rather than:

```text
new marketplace
→ write scraper
→ write selectors
→ write parser
→ write pagination logic
→ maintain integration forever
```

That is the core idea worth demonstrating at the hackathon.

---

# Appendix A — Recommended API Surface

```text
GET  /health
GET  /sources
POST /search
GET  /search/:jobId/events
POST /sources/validate
POST /sources/learn
GET  /sources/:sourceId
```

Only implement the endpoints needed for the current milestone.

---

# Appendix B — Example Search Lifecycle

```text
User
 │
 │ "used office chair under $100 near downtown Toronto"
 ▼
Extension
 │
 │ POST /search
 ▼
Backend
 │
 ├── Parse intent
 │
 ├── Start Facebook agent ──────────────┐
 ├── Start Kijiji agent ────────────────┤
 ├── Start eBay agent ──────────────────┤
 └── Start Craigslist agent ────────────┤
                                         │
            ┌────────────────────────────┘
            ▼
       Steel Sessions
            │
            ▼
       Browser agents
            │
            ▼
       Extract listings
            │
            ▼
       Validate / normalize
            │
            ▼
       Deduplicate / rank
            │
            ▼
       SSE listing_batch
            │
            ▼
        Extension
            │
            ▼
      Unified result feed
```

---

# Appendix C — Example Agent Recipe Lifecycle

```text
New marketplace URL
        ↓
No recipe exists
        ↓
Agent explores site
        ↓
Finds search interaction
        ↓
Runs test query
        ↓
Extracts listing schema
        ↓
Validation passes
        ↓
Save recipe
        ↓
Future searches reuse recipe
```

If recipe execution fails later:

```text
Recipe execution
      ↓
No/invalid results
      ↓
Invalidate recipe
      ↓
Re-run discovery
      ↓
Save updated recipe
```

This gives the system a practical path toward self-maintaining marketplace integrations without requiring a fully autonomous browser scientist.
