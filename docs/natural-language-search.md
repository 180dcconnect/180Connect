# Natural language charity search (F214)

A CAM types *"small education charities in Leeds"* into the clients list and gets
back a ranked set of real clients. This is what happens in between, and what it
costs.

## The shape: translate, then filter locally

The model **never sees a client record and never returns one.** It receives the
CAM's sentence and a short list of the values this app can filter on, and it
returns a small JSON object — a *filter plan*. The app applies that plan to rows
it already loaded.

```
"small education charities in Leeds"
        │
        ▼   ~700 tokens in / ~150 out
   Gemini Flash-Lite
        │
        ▼   {"cities":["Leeds"],"sectors":["education"],"incomeBands":["10k_100k"]}
   resolve against real data   ← a city nothing is in is dropped here
        │
        ▼
   filterByCity / filterBySector / … (the same F053–F058 filters)
        │
        ▼
   rankByPlan → relevance, then priority score, then name
```

Two consequences worth stating plainly:

- **It cannot fabricate a result** (AC2). Every row came out of Postgres. A place
  the model invents resolves against the cities the list actually holds, finds
  nothing, and is reported to the CAM as ignored rather than applied.
- **The fallback is free** (AC3). Natural language chooses filters; it is not a
  second search engine. When interpretation fails, every manual filter has
  already been applied and the CAM is looking at the list they would have had.

## What it costs

| | |
| --- | --- |
| Model | Gemini 3.5 Flash-Lite — $0.30 / $2.50 per million tokens in/out |
| Per interpretation | ~700 in, ~150 out ≈ **$0.0006** |
| For comparison | One Client Booklet (F082) ≈ $0.0022 — a search is roughly a quarter of one |
| Free tier | Flash-Lite bills $0 and caps throughput instead, which covers this volume |

Rates and the reasoning behind the model split live in
`supabase/migrations/20260925090100_seed_model_pricing.sql` and the *180Connect
LLM Provider Research* doc.

### The five things that keep it there

1. **Plain names never reach the API.** `looksLikeNaturalLanguage` sends only
   strings that read as a description. "Leeds Community Foundation" falls through
   to F052's substring search at zero cost, and the banner says so.
2. **Repeats are cached** (in memory, one hour). Paging through results, two CAMs
   asking the same thing, the same search tomorrow — all free. The cache is
   checked *before* the rate-limit allowance, so paginating costs neither money
   nor budget.
3. **Only the vocabulary goes in the prompt, never the data.** The 382 distinct
   cities are matched *after* the model answers; listing them would cost more
   than the rest of the call. A test asserts the system prompt stays under 2,000
   characters.
4. **Output is capped** at 512 tokens, and the query at 200 characters.
5. **A dedicated rate limit** — 40/user/day in its own bucket, so search cannot
   consume the booklet and draft allowance, and so its worst case is bounded
   independently (25 users × 40 × $0.0006 ≈ $0.60/day at the ceiling).

Every call, success or failure, writes to `API_HEALTH_LOGS` with token counts —
never the query text.

## Keeping `MODEL_PRICING` honest

The rates are **list prices**, so any total built on them is an estimate of what
the usage *would* cost, not an invoice. Two things keep them from rotting:

- **A model with no rate now reports itself.** `src/lib/ai/model-rate.ts` writes
  to ERROR_LOG the first time a generation runs on an unpriced model. This is how
  the table actually goes stale — someone points `GEMINI_MODEL` or
  `GEMINI_SEARCH_MODEL` at a new id, Google having retired the old one, and every
  cost silently records as null.
- **`confirmed_on` and `source_url`** say when a human last checked a rate and
  against what.

Known future change: **Gemini 3.6 Flash doubles on 2027-01-01** ($0.75 → $1.50
in, $3.75 → $7.50 out). The table has no effective-dating, so that is a migration
someone must write — tracked as its own issue.

## Where the code is

| File | What it does |
| --- | --- |
| `src/lib/search/nl-search-plan.ts` | The prompt, and validating a response into a plan. Pure. |
| `src/lib/search/nl-query-shape.ts` | Is this a question or a name? The zero-cost gate. |
| `src/lib/search/interpret-query.ts` | The Gemini call: timeout, API_HEALTH_LOGS, ERROR_LOG. |
| `src/lib/search/nl-plan-cache.ts` | Query → plan, in memory, one hour. |
| `src/lib/search/nl-search-apply.ts` | Grounding a plan in real data, filtering, ranking. |
| `src/lib/search/nl-plan-describe.ts` | Turning a plan into chips and a "convert to filters" link. |
| `src/lib/search/run-nl-search.ts` | The order of the decisions above — where the cost story lives. |

The UI is the `ask` prop on `BrandSearchBar` (opt-in, additive) plus the
interpretation banner in `src/app/clients/page.tsx`.
