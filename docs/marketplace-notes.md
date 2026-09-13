# Marketplace notes

| Source | Recipe | Login | Notes |
| --- | --- | --- | --- |
| eBay | Deterministic search URL + extraction from both the legacy `li.s-item` and newer `li.s-card` layouts | No | Sends the user's original wording; budget is enforced after extraction. Detects eBay's transient first-request error page and reloads in-session. A "0 results" page with near-match cards is extracted at lower confidence for the relevance judge. |
| Kijiji | Toronto search URL + `data-testid` extraction, including `listing-card-image` photos | No | Price range is enforced after extraction; current recipe is Toronto-focused. A visible `No results for …` page is a successful empty search: it returns zero listings immediately rather than waiting for cards that will never exist. |
| Facebook Marketplace | Persistent Steel profile + human-in-the-loop live session | Usually | Never automate credentials, MFA, or checkpoints. Surface a live-session link and resume only after the user completes Facebook's own login flow. |
| Craigslist | Generic discovery fallback | No | Validate the local-market URL before relying on it in the demo. |

Marketplace layouts change. A source failure is intentionally isolated: it emits an error and completion event but never ends the whole job.
