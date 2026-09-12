# Listing quality scoring

Scout ranks relevant listings using search relevance, explicit budget fit,
location, recency, listing completeness, available seller/product ratings, and
visible product quality.

## Seller and product ratings

When a marketplace result card exposes them, ratings are normalized onto a
five-star scale. For example, eBay `99.2% positive feedback` becomes `4.96/5`.
Each rating contributes up to five deterministic ranking points. Missing ratings
do not penalize a listing; they simply contribute no rating bonus.

## Image-quality assessment

For live Steel searches only, Scout captures the visible listing image from the
Steel browser session. It sends that screenshot and the listing context to the
configured OpenAI or Anthropic vision model. The model returns:

- `imageQualityScore` — 0–100 apparent product condition/desirability from
  visible evidence.
- `imageQualityConfidence` — 0–1 confidence in that assessment.
- `imageQualityRationale` — a short description of the visible evidence and
  uncertainty.

The score is weighted by confidence and contributes up to eight ranking points:
`8 × (imageQualityScore / 100) × imageQualityConfidence`. Blurry, dark,
obstructed, incomplete, stock, or ambiguous photos naturally carry less weight.

The assessment prompt lives in
`apps/server/src/image-quality-service.ts`. It explicitly directs the model to
inspect wear, damage, completeness, material/build clues, photo coverage, and
uncertainty; it also prohibits inferring hidden defects or following instructions
found in the image.

Set `IMAGE_QUALITY_MAX_LISTINGS` (default `4`, maximum `12`) to control the
number of image-bearing results assessed per marketplace source. If no LLM is
configured, an image cannot be captured, or a vision request fails, Scout keeps
the listing and omits the image-quality bonus rather than blocking the search.
