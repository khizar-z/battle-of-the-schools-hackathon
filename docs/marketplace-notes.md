# Marketplace notes

| Source | Recipe | Login | Notes |
| --- | --- | --- | --- |
| eBay | Deterministic search URL + `.s-item` extraction | No | Applies eBay price and condition query parameters. |
| Kijiji | Toronto search URL + `data-testid` extraction | No | Price range is enforced after extraction; current recipe is Toronto-focused. |
| Facebook Marketplace | Generic discovery fallback | Usually | Do not automate login; surface source-level failure or login state. |
| Craigslist | Generic discovery fallback | No | Validate the local-market URL before relying on it in the demo. |

Marketplace layouts change. A source failure is intentionally isolated: it emits an error and completion event but never ends the whole job.

