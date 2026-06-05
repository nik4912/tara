# Tara – Design Document

## Overview

Tara is a Finance Research Agent that answers natural-language questions about personal
finances using structured data stored in PostgreSQL. The key design constraint is
**zero hallucination**: every number in every answer must originate from a database query,
not from the LLM's parametric memory.

---

## Schema Design

### `transactions`

```sql
id                  VARCHAR(50)   PRIMARY KEY
date                DATE          NOT NULL
merchant            VARCHAR(255)  NOT NULL   -- raw merchant string as received
merchant_normalized VARCHAR(255)  NOT NULL   -- canonical group key (see normalization)
category            VARCHAR(100)  NOT NULL
amount              NUMERIC(15,2) NOT NULL   -- negative = refund
currency            VARCHAR(10)   DEFAULT 'INR'
memo                TEXT
```

**Decision**: Store both raw and normalized merchant. The raw value preserves the original
data for auditing; the normalized value powers all grouping queries.

**Refunds**: Negative `amount` values represent refunds. They are stored as-is. SQL `SUM`
automatically nets them out — no special handling needed at the application layer.

### `funds`

```sql
id        VARCHAR(50)   PRIMARY KEY
name      VARCHAR(255)  NOT NULL
category  VARCHAR(100)  NOT NULL   -- Equity, Debt, Hybrid, etc.
```

### `fund_nav_history`

```sql
id        SERIAL        PRIMARY KEY
fund_id   VARCHAR(50)   NOT NULL FK → funds.id (CASCADE)
nav_date  DATE          NOT NULL
nav       NUMERIC(15,4) NOT NULL
UNIQUE (fund_id, nav_date)
```

**Decision**: Separate NAV history table (not embedded JSON) enables SQL-level date
filtering and return calculations entirely in the database.

### `holdings`

```sql
id            VARCHAR(50)   PRIMARY KEY
fund_id       VARCHAR(50)   NOT NULL FK → funds.id (CASCADE)
units         NUMERIC(15,4) NOT NULL
purchase_date DATE          NOT NULL
purchase_nav  NUMERIC(15,4) NOT NULL
```

---

## Indexes

| Index | Columns | Rationale |
|---|---|---|
| `idx_txn_date` | `transactions.date` | Date range queries |
| `idx_txn_category` | `transactions.category` | Category filter |
| `idx_txn_merchant_norm` | `transactions.merchant_normalized` | Merchant group queries |
| `idx_txn_amount` | `transactions.amount` | Max/top-N queries |
| `idx_txn_date_category` | `transactions(date, category)` | Combined date+category |
| `idx_nav_fund_date` | `fund_nav_history(fund_id, nav_date)` | Latest NAV, period return |
| `uniq_fund_nav_date` | unique on `(fund_id, nav_date)` | Prevent duplicate NAV rows |
| `idx_holdings_fund_id` | `holdings.fund_id` | Join to fund_nav_history |

---

## Foreign Keys

- `fund_nav_history.fund_id → funds.id ON DELETE CASCADE`
- `holdings.fund_id → funds.id ON DELETE CASCADE`

Cascades allow a full data reload (ingest) to simply truncate `funds` and have all
dependent data removed automatically.

---

## Merchant Matching Strategy

### Problem

The same merchant can appear with many textual variants:

```
SWIGGY*ORDER
SWIGGY BANGALORE
Swiggy Instamart
SWIGGY*FOOD
```

### Solution: Generic Normalization (no hardcoded names)

The `normalizeMerchant()` function (`src/services/merchantNormalizer.ts`) applies a
three-step pipeline:

1. **Uppercase + trim** — case-insensitive, removes leading/trailing whitespace.
2. **Strip asterisk codes** — `SWIGGY*ORDER` → `SWIGGY`. The part after `*` is typically
   an order reference or internal code, never a meaningful brand component.
3. **Strip location/legal suffixes** — removes common terminal words like city names
   (`BANGALORE`, `MUMBAI`) and legal suffixes (`LTD`, `PVT`), allowing `SWIGGY BANGALORE`
   → `SWIGGY`. The regex is data-driven, not merchant-specific.
4. **Normalize whitespace** — collapse multiple spaces.

**Result stored as `merchant_normalized`**, used in all GROUP BY and LIKE queries.

**Why not edit distance / ML?** The rule-based approach is deterministic, auditable,
and zero-cost at query time. It handles the patterns seen in realistic bank statement data.

---

## Refund Handling

- Refunds arrive as transactions with negative `amount`.
- They are inserted verbatim — no transformation at ingestion time.
- SQL `SUM(amount)` automatically nets refunds out of totals.
- Tools expose an `excludeRefunds` flag (default `false`) for cases where the user
  wants gross-spend-only figures.
- The agent system prompt informs Tara that refunds are already handled by tools.

---

## Transfer Handling

- Transfers (category = `'Transfer'`) represent money moved between the user's own accounts.
- They are **excluded from all spending queries by default** via the `excludeTransfers`
  filter (default `true`).
- Users can ask explicitly about transfers (`excludeTransfers: false`) and the tool will
  include them.
- This mirrors standard personal finance accounting: transfers inflate apparent spend.

---

## Fund Return Formula

Period return is computed entirely in SQL (never in TypeScript or the LLM):

```sql
return_percent = ROUND(
  ((last_nav.nav - first_nav.nav) / first_nav.nav) * 100
, 2)
```

`first_nav` and `last_nav` are resolved using `LATERAL` subqueries ordered by `nav_date`,
making the formula correct for any date range without any application-level date math.

---

## Holding Return Formula

```sql
purchase_cost  = units * purchase_nav
current_value  = units * latest_nav       -- latest_nav from fund_nav_history
profit         = current_value - purchase_cost
return_percent = ROUND((profit / purchase_cost) * 100, 2)
```

All four values are computed in a single CTE (`HOLDING_METRICS_CTE` in
`src/tools/portfolioAnalysis.ts`). The agent reads the results — it never recomputes.

---

## Tool Design

### `queryTransactions`

A Swiss-army knife for transaction queries. Uses a dynamic WHERE clause builder
(`buildWhereFragments`) that respects date ranges, category filters, merchant LIKE patterns,
transfer exclusion, and refund inclusion/exclusion.

Eight distinct `operation` modes avoid parameter explosion while keeping the schema strict.

### `fundAnalysis`

Uses `LATERAL` joins to efficiently retrieve the first and last NAV in one pass per fund.
`resolveFundId` allows the agent to pass either an ID or a name fragment, making it
robust to variations in how the user refers to a fund.

### `portfolioAnalysis`

All holding metrics are computed in a single CTE (`HOLDING_METRICS_CTE`) joined via
`DISTINCT ON (fund_id)` to get the latest NAV without a separate round-trip. Aggregates
(portfolio totals) are computed with a wrapper `WITH metrics AS (...)` CTE.

### `subscriptionDetection`

Detects recurring charges using two statistical criteria:
1. **Frequency**: Merchant appears in ≥ N distinct calendar months.
2. **Consistency**: Coefficient of variation (StdDev/Mean) of amounts ≤ threshold.

Both thresholds are configurable tool inputs (default: `minOccurrences=2`,
`maxAmountVariance=0.15`). The approach is fully data-driven — no subscription merchant
list is hardcoded.

---

## Orchestration

Mastra's `Agent.generate()` natively supports multi-step tool calling via the LLM's
function-calling interface. When answering "Compare food and travel spending" the agent
calls `queryTransactions` with `operation: 'spending_comparison'` in one shot.

For more complex questions like "Find the best holding and compare it to its fund's return":
1. `portfolioAnalysis` with `operation: 'best_holding'` → identifies holding and fund_id.
2. `fundAnalysis` with `operation: 'fund_return'` + `fundId` → retrieves fund return.

The LLM synthesizes both results into a single grounded answer.

---

## Observability

Every `POST /ask` request is logged to `src/logs/requests.jsonl` in JSON Lines format:

```json
{
  "requestId": "uuid",
  "timestamp": "ISO-8601",
  "question": "user question",
  "taskType": "spending_query",
  "toolsCalled": ["queryTransactions"],
  "toolInputs": [{ "tool": "queryTransactions", "operation": "biggest_expense" }],
  "tablesRead": ["transactions"],
  "latencyMs": 1234,
  "status": "success"
}
```

Fields captured:
- `requestId` — UUID returned in the response for correlation
- `question` — original user question (sanitized; no secrets)
- `taskType` — detected intent category (spending_query, fund_analysis, comparison_query, etc.)
- `toolsCalled` — ordered list of tools invoked
- `toolInputs` — sanitized tool arguments (no API keys or DB credentials)
- `tablesRead` — which PostgreSQL tables were queried
- `latencyMs` — wall-clock time from request to response
- `status` / `error` — success or the error message on failure

Secrets (`DATABASE_URL`, `GROQ_API_KEY`) are never logged.
Log writes are non-blocking (`appendFileSync` in a try/catch that never propagates).

---

## Async Long-Running Tool Milestone

**Decision: Not implemented.**

All tools execute synchronously within the agent turn. Rationale:
- All tool operations are pure SQL queries against a local/hosted Postgres instance
- Observed latency is <500ms per tool call on the sample datasets — well within acceptable response time
- The assignment states this milestone is optional

If implemented, the pattern would be:
1. Tool's `execute` returns `{ job_id, status: "running" }` immediately
2. A BullMQ worker performs the real computation in the background
3. A polling endpoint (`GET /jobs/:id`) or webhook re-injects the result into a fresh agent turn via a synthetic system prompt: `<async_tool_completion>job_id=...</async_tool_completion>`
4. Job state is persisted in Postgres so a restart doesn't lose in-flight jobs

The main tradeoff skipping this: portfolio computations across many holdings with a large NAV history could become slow at scale (hundreds of holdings × years of history). The current synchronous approach is correct and sufficient for the submitted dataset sizes.

---

## Eval Methodology

The eval suite (`src/eval/run-evals.ts`) tests **tool correctness directly** — no LLM
required. Each case runs a raw SQL query against the ingested database and compares the
result to a known expected value derived from the sample_a dataset.

### Coverage

| ID | Topic |
|---|---|
| E01 | Food spending with refund netted out |
| E02 | Refund handling: negative amounts reduce totals |
| E03 | Transfer exclusion |
| E04 | Biggest single expense |
| E05 | Top merchants list |
| E06 | Merchant alias normalization (Swiggy variants) |
| E07 | No-data / empty result handling |
| E08 | Subscription detection: frequency check (Netflix) |
| E09 | Subscription detection: amount consistency (Spotify) |
| E10 | Fund return formula (HDFC Mid-Cap ≈ 16.58%) |
| E11 | Best performing fund identification |
| E12 | Portfolio total value calculation |
| E13 | Individual holding return (hold_001 ≈ 36.7%) |
| E14 | Category comparison (Travel > Food) |
| E15 | Subscription monthly total > ₹500 |

### Pass/Fail Criterion

Numeric comparisons use a tolerance of ±0.05 to handle floating-point rounding in
Postgres → JavaScript conversion. Structural checks (count, ordering) are exact.

---

## Known Limitations

1. **Single-user model**: The schema has no `user_id`. Designed for single-user or
   single-tenant deployment. Multi-tenancy would require adding user partitioning.

2. **Static NAV history**: NAV is loaded from snapshots. A production system would
   pull live NAV data from a fund data API.

3. **Currency**: All amounts assumed INR unless specified. Multi-currency aggregation
   would require FX conversion rates.

4. **Merchant normalization depth**: The current rule-based normalizer handles common
   patterns. Highly unusual formats (e.g. scrambled abbreviations) may not group correctly.
   An ML-based approach could improve recall at the cost of determinism.

5. **No authentication**: The `/ask` endpoint has no auth. Production deployment should
   add an API key or OAuth guard.

6. **LLM reliability**: Using Groq's Llama 4 Scout model via an OpenAI-compatible endpoint.
   Tool-call schema uses flat parameters and `z.coerce` types to handle LLM type coercion
   quirks. In rare cases the model may still fail to produce a valid tool call on the first
   attempt — retrying the question resolves this.

7. **No async milestone**: All tools run synchronously. See the Async section above for
   the design that would be implemented with more time.
