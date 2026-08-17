# Log Ingestion & Query Service

A high-performance service that ingests structured logs in bulk, makes them queryable and
aggregatable, and enforces retention — with **PostgreSQL as the single source of truth**.
Built to sustain **15,000+ logs/sec** and keep aggregation under **1 s at p95** over **1M+ rows**,
within tight container limits (app: 0.5 CPU / 256 MB, Postgres: 1 CPU / 1 GB).

> Design rationale, performance math, and all diagrams live in
> [`docs/design.md`](docs/design.md). Full requirements in [`docs/requirements.md`](docs/requirements.md).

<!-- CI badge placeholder: add once the pipeline is live -->
<!-- ![CI](https://github.com/raghad-murad/<repo>/actions/workflows/ci.yml/badge.svg) -->

## Table of contents

- [Quick start](#quick-start)
- [Architecture](#architecture)
- [API](#api)
- [Schema & index design](#schema--index-design)
- [Attribute storage strategy](#attribute-storage-strategy)
- [Retention strategy](#retention-strategy)
- [Performance](#performance)
- [Configuration](#configuration)
- [Optional features](#optional-features)
- [Known limitations](#known-limitations)
- [Development](#development)

## Quick start

The complete system starts with a single command — no env file, no manual setup:

```bash
docker compose up
```

This brings up the application and PostgreSQL, applies migrations automatically, and exposes
the service at `localhost:8080`. The service reports healthy only once the database is
connected, migrations are applied, and it is ready to accept logs:

```bash
curl http://localhost:8080/health        # → 200 once ready
```

## Architecture

Layered, with a strict dependency direction (each layer knows only the one below):

```
HTTP routes  →  validation  →  service layer  →  repository  →  PostgreSQL
                                                  ↑
                          QueryBuilder (safe parameterized SQL) · CursorCodec
RetentionScheduler (timer) → RetentionService → DROP expired partitions
```

All dynamic SQL is built in a single place (`QueryBuilder`) using parameterized placeholders
only — the SQL-injection boundary is centralized and auditable. See
[`docs/design.md`](docs/design.md) for the full architecture, sequence flows, and class diagram.

## API

Four endpoints. `localhost:8080`. All error responses use `{ "error": "<description>" }`.

### `GET /health`
Returns `200` once the service is ready (DB connected, migrations applied). Always unauthenticated.

### `POST /logs` — ingest

Always accepts a **batch** (a batch of one is valid). Each entry is validated independently;
valid entries are accepted even if others in the batch are rejected.

**Request**
```json
{
  "logs": [
    {
      "timestamp": "2026-07-20T14:32:01.123Z",
      "level": "error",
      "service": "checkout",
      "message": "payment declined",
      "attributes": { "user_id": "42", "region": "eu-west", "retries": 3 }
    }
  ]
}
```

**Validation** — `timestamp` (valid ISO 8601, not >5 min in the future), `level`
(`debug`|`info`|`warn`|`error`), `service` (non-empty), `message` (non-empty), `attributes`
(optional flat object; values `string`|`number`|`boolean`; no nested objects or arrays).

**Response** — `200` when at least one entry is accepted:
```json
{ "accepted": 9, "rejected": [ { "index": 3, "reason": "invalid level: 'critical'" } ] }
```
`400` when all entries are rejected, the JSON is malformed, or the top-level shape is wrong.

### `GET /logs` — query

All parameters optional and freely combinable. Results sorted by `timestamp` **descending**,
with a deterministic tiebreak on `id`.

| Param | Meaning |
|-------|---------|
| `service` | exact service-name match |
| `level` | exact level match |
| `since` | inclusive start (`timestamp >= since`) |
| `until` | exclusive end (`timestamp < until`) |
| `attr.<key>` | attribute equality, compared as a string |
| `q` | case-insensitive substring match on `message` |
| `limit` | default 100, max 1000 |
| `cursor` | opaque cursor from a previous response |

**Response**
```json
{ "logs": [ /* ... */ ], "next_cursor": "eyJ0cyI6..." }
```
`next_cursor` is `null` when there are no more results. Pagination is keyset-based; the cursor
is opaque and passed back unchanged. Invalid parameters → `400`.

### `GET /logs/aggregate` — time-bucketed counts

Supports the same filters as `/logs` (`service`, `level`, `attr.<key>`, `q`), plus:

| Param | Required | Meaning |
|-------|----------|---------|
| `since` | yes | inclusive start of range |
| `until` | yes | exclusive end of range |
| `bucket` | yes | `1m` \| `5m` \| `1h` \| `1d` |
| `group_by` | no | `service` \| `level` |

**Response** — one row per bucket × group, ordered by bucket start **ascending**; empty buckets
may be omitted; `group` is `null` when `group_by` is absent:
```json
{
  "buckets": [
    { "start": "2026-07-20T14:00:00Z", "group": "checkout", "count": 118 },
    { "start": "2026-07-20T14:01:00Z", "group": "checkout", "count": 97 }
  ]
}
```
Invalid parameters → `400`.

## Schema & index design

A single `logs` table, **range-partitioned by `timestamp`** (daily partitions):

```sql
CREATE TABLE logs (
  id          bigint       GENERATED ALWAYS AS IDENTITY,
  timestamp   timestamptz  NOT NULL,
  level       text         NOT NULL,
  service     text         NOT NULL,
  message     text         NOT NULL,
  attributes  jsonb        NOT NULL DEFAULT '{}',
  PRIMARY KEY (timestamp, id)
) PARTITION BY RANGE (timestamp);
```

- **`PRIMARY KEY (timestamp, id)`** satisfies the partitioned-table requirement (the PK must
  include the partition key) **and** doubles as the sort + keyset-cursor index: its btree is
  scanned backward to serve `ORDER BY timestamp DESC, id DESC`. No separate ordering index needed.
- **Baseline index set: the PK only.** Each additional index is a per-insert write tax that
  competes with the 15k/s ingestion budget, so indexes are added only against a measured need
  (candidate: `(service, timestamp DESC, id DESC)` for hot service filters). Verified with
  `EXPLAIN ANALYZE`.
- `id` is `bigint` in the DB but serialized as a `string` at the API boundary (JS integer
  precision), not a UUID.

## Attribute storage strategy

Attributes are stored as a single **`jsonb`** column and queried with the `->>` operator, which
extracts values **as text regardless of stored type** — so `attr.retries=3` becomes
`WHERE attributes->>'retries' = '3'` and matches a stored `3` or `"3"`, exactly satisfying the
"compared as strings" contract with **no normalization** and **preserving original types in the
response**.

- **EAV (separate key/value table) was rejected** — ~5 extra rows per log ≈ 60k rows/s at
  target load, which breaks the ingestion budget.
- **No GIN index by default** — GIN maintenance is expensive per insert. The baseline relies on
  time-range filtering to bound the candidate set, then filters attributes as a cheap recheck.
- **Escalation (only if measurement proves it):** add an index that *preserves string-equality
  semantics* — e.g. a text-normalized generated column indexed with GIN, or expression indexes
  on known hot keys. A naive switch to `@>` is avoided because JSONB containment is type-sensitive
  and would break the string-comparison contract.

## Retention strategy

Configurable via `RETENTION_DAYS` (default 30). Retention is enforced by **dropping whole daily
partitions** past the window — an O(1) metadata operation with **no row-by-row `DELETE`, no long
locks, no table bloat, and no contention with ingestion**.

A `RetentionScheduler` (when) runs one maintenance cycle immediately after startup and then hourly,
driving a `RetentionService` (what) that calls the `PartitionManager` (how) to (1) ensure the
retention window + look-ahead partitions exist and (2) drop expired partitions. Partition creation
is kept **off the ingestion hot path** (startup + periodic maintenance only). A failed maintenance
cycle is logged and retried next interval — it never takes the service down; a startup failure, by
contrast, keeps the service not-ready. Retention is enforced at **daily granularity** — up to ~1 day
beyond `RETENTION_DAYS` may persist until the next drop.

## Performance

**Targets**

| Metric | Target |
|--------|--------|
| Sustained ingestion | ≥ 15,000 logs/sec (no drops, no crashes) |
| Aggregation latency | p95 < 1 s |
| Dataset | ~1,000,000 rows (~1 month) |
| Ingest → queryable | ≤ 20 s |
| Concurrent read | ≥ 1 aggregation/sec during ingest |

**Methodology.** A custom TypeScript load generator (`scripts/loadgen/`, separate from the service)
runs staged workloads against the containerized service under its real resource limits. Ingestion is
closed-loop: a fixed pool of workers each POST a batch, await the response, and send the next;
throughput = accepted logs ÷ elapsed. Aggregation latency is probed concurrently. Run with
`npx tsx scripts/loadgen/run.ts <smoke|ingest|concurrent|seed>`.

**Result summary — all targets met with no added indexes or rollups.**

| Dimension | Result |
|-----------|--------|
| Test environment | Docker Compose on WSL2; app 0.5 CPU / 256 MB, Postgres 16 / 1 CPU / 1 GB |
| Dataset size | 1,016,000 rows (~1 month, spread across 30 daily partitions) |
| Best batch config | 8 workers × 1,000 (best throughput/latency balance) |
| Sustained ingestion | **19,000–25,000 logs/sec**, 0 errors (target ≥ 15,000) |
| Ingest during seed | ~23,000 logs/sec (1.01M rows in 44 s) |
| Aggregation p95 (under concurrent ingest) | **~620–800 ms** (target < 1,000 ms) |
| Query latency, 1M rows — `/logs` time-bounded | ~1 ms execution (see EXPLAIN below) |
| Query latency, 1M rows — `/logs/aggregate` 7-day window, grouped | ~0.5 s wall |
| Query latency, 1M rows — `attr.<key>` filter (`->>`, no GIN) | ~40 ms wall |
| Resource usage under load | app ~50% of 0.5 CPU, 37 MB / 256 MB; Postgres ~61% of 1 CPU, 363 MB / 1 GB |

**Ingestion ramp** (8 s per config):

| workers | batch | throughput/s | p95 (ms) | errors |
|--------:|------:|-------------:|---------:|-------:|
| 2 | 100 | 9,822 | 66 | 0 |
| 4 | 250 | 16,896 | 102 | 0 |
| 4 | 500 | 17,308 | 194 | 0 |
| 8 | 500 | 17,839 | 362 | 0 |
| 8 | 1000 | 19,178 | 610 | 0 |
| 16 | 1000 | 19,815 | 995 | 0 |
| 16 | 2000 | 21,220 | 1,977 | 0 |

The trade-off is visible: throughput keeps rising with load, but p95 rises with it. `8×1000` is the
chosen operating point — it clears 15k/s comfortably while keeping p95 well under a second.

**Bottleneck.** The app container runs at ~50% of its 0.5 CPU while ingesting ~19k/s — matching the
budget math (§1a: 15k/s leaves almost no CPU headroom). Postgres CPU (not memory) is the shared
constraint, which is why aggregation p95 rises as ingestion workers increase (§1e). Memory was never
close to its limit on either container.

**`EXPLAIN ANALYZE` — the key architectural decisions, proven.** For a time-bounded `/logs` query
over the 1M-row table:

```
Limit  (actual time=0.053..0.845 rows=100)
  ->  Append
        Subplans Removed: 29                          <- partition pruning: 29 of 33 partitions skipped
        ->  Index Scan Backward using logs_2026_08_17_pkey ...   <- PK (timestamp,id) serves DESC order
        ->  Index Scan Backward using logs_2026_08_16_pkey ... (never executed)  <- LIMIT stopped early
Execution Time: 1.007 ms
```

This confirms, on real data: **partition pruning** removes irrelevant partitions, the **composite PK
`(timestamp, id)` is scanned backward** to satisfy `ORDER BY timestamp DESC, id DESC` with no extra
index, and the **`LIMIT` bounds the work** regardless of table size.

**Deferred decisions — measured, not needed.** The design deferred a `service` composite index, an
attribute index, and rollup tables pending measurement. Benchmarks show the baseline meets every
target, so **none were added**. The simplest design that satisfies the requirements is the one shipped.

## Configuration

All configuration is via environment variables with sensible defaults; a bare
`docker compose up` needs none.

| Variable | Default | Meaning |
|----------|---------|---------|
| `PORT` | `8080` | HTTP port inside the container |
| `DATABASE_URL` | (set by compose) | PostgreSQL connection string |
| `RETENTION_DAYS` | `30` | Age past which daily partitions are dropped |
| `DB_POOL_SIZE` | `8` | Connection pool size (kept small for the 1-CPU Postgres) |
| `STATEMENT_TIMEOUT_MS` | `2000` | Per-query timeout |
| `MAINTENANCE_INTERVAL_MS` | `3600000` | Retention maintenance interval (1 hour) |

## Optional features

**None enabled.** This submission implements the plain core service only. A bare
`docker compose up` with no configuration serves all four endpoints unauthenticated, with no
rate limit, quota, or tenancy restriction — exactly the configuration graded for performance.

## Known limitations

- **Query performance depends on the time window, not just dataset size.** Time-bounded queries
  are fast via partition pruning; `/logs` filters *without* `since`/`until` (a rare `service`,
  `attr`, or `q` value) are worst-case scans, not guaranteed-fast.
- **`q` substring** uses `ILIKE` within the requested time window rather than a trigram index (a
  write-cost trade-off).
- **Attribute values are compared as strings**; numeric or range predicates on attributes are not supported.
- **Retention is enforced at daily-partition granularity** (see above).
- Connection-pool size and statement timeout are benchmark-tuned starting values, not derived from requirements.

## Development

```bash
npm install
npm run dev          # run locally against a dev database
npm test             # unit + integration tests (Vitest)
npm run typecheck
npm run build
```

Project layout (layers mirror the architecture):

```
src/
  routes/       HTTP handlers (thin, no SQL)
  validation/   per-entry + query-param validation
  services/     business logic
  repository/   the only layer that knows SQL (+ QueryBuilder, PartitionManager)
  infra/        db pool, migrator
  lib/          cursor codec
  scheduler/    retention scheduler
migrations/     SQL migrations applied automatically at startup
scripts/loadgen/ data generator + load test (not part of the service)
docs/           requirements.md, design.md
```