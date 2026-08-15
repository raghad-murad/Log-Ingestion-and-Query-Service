# Log Ingestion & Query Service — Requirements Reference

A **performance-constrained** service that ingests high-volume structured logs, makes them queryable and aggregatable, and enforces retention with **PostgreSQL as the single source of truth** for reads and writes.



## 1. Functional Requirements — *what the system does*

### 1.1 API surface

| Method | Path                 | Purpose                       | Notes |
|--------|----------------------|-------------------------------|-------|
| GET    | `/health`            | Readiness check               | Always public |
| POST   | `/logs`              | Batch ingest                  | Always a batch (batch of 1 is valid) |
| GET    | `/logs`              | Query + cursor pagination     | All filters optional, freely combinable |
| GET    | `/logs/aggregate`    | Time-bucketed counts          | `since`/`until`/`bucket` required |

- Service listens on **port 8080** inside the container, exposed as **localhost:8080**.
- `/health` returns 200 **only after** DB connected + migrations applied + ready to accept logs.

### 1.2 Ingestion — `POST /logs`

- Request shape: `{ "logs": [ { ...entry }, ... ] }`.
- **Per-entry validation with partial acceptance** — one bad entry must not fail the batch.
- Response: `{ "accepted": <n>, "rejected": [ { "index": <i>, "reason": "<why>" } ] }`.
- Status: **200** if ≥1 entry accepted. **400** if all rejected, malformed JSON, or wrong top-level shape.
- **Durability rule (functional):** never return 200 for a batch not **durably** persisted.

**Per-entry validation rules**

| Field        | Required | Rule |
|--------------|----------|------|
| `timestamp`  | yes      | Valid ISO 8601; **not more than 5 min in the future** |
| `level`      | yes      | One of `debug` \| `info` \| `warn` \| `error` (exact) |
| `service`    | yes      | Non-empty string |
| `message`    | yes      | Non-empty string |
| `attributes` | no       | **Flat** object; values are `string`\|`number`\|`boolean`; **no** nested objects or arrays |

### 1.3 Query — `GET /logs`

All params optional and **freely combinable**.

| Param        | Meaning |
|--------------|---------|
| `service`    | Exact match (not substring) |
| `level`      | Exact match |
| `since`      | **Inclusive** — `timestamp >= since` |
| `until`      | **Exclusive** — `timestamp < until` |
| `attr.<key>` | Attribute equality, **compared as string** (so `attr.retries=3` matches stored `3` or `"3"`) |
| `q`          | **Case-insensitive substring** match on `message` |
| `limit`      | Default **100**, max **1000** |
| `cursor`     | Opaque value from previous response, passed back unchanged |

- **Sort:** `timestamp DESC` with a **deterministic tiebreaker** (e.g. `id DESC`).
- **Response:** `{ "logs": [...], "next_cursor": <str|null> }`; `null` when no more results.
- Invalid params → **400** `{ "error": "<description>" }` (bad timestamp, `until < since`, bad level, non-numeric/out-of-range limit, invalid cursor).

### 1.4 Aggregation — `GET /logs/aggregate`

- Supports the same filters: `service`, `level`, `attr.<key>`, `q`.
- **Required:** `since`, `until`, `bucket` (one of `1m` \| `5m` \| `1h` \| `1d`).
- **Optional:** `group_by` (`service` \| `level`).
- Output: one row per `bucket × group`; **ascending** by bucket start (opposite of `/logs`).
- Empty buckets **may** be omitted; `group` is **null** when `group_by` absent.
- Response: `{ "buckets": [ { "start", "group", "count" } ] }`.
- Invalid params → **400** `{ "error": "..." }`.

### 1.5 Retention

- **Configurable** (e.g. `RETENTION_DAYS`) — not hardcoded.
- Deletes/expires data older than the window.
- Must run **automatically** (system-triggered, not a user request).



## 2. Non-Functional Requirements — *how well it does it*

### 2.1 Performance targets

| Target | Value |
|--------|-------|
| Sustained ingestion | **≥ 15,000 logs/sec** (no dropped requests, no crashes) |
| Aggregation latency | **p95 < 1 second** |
| Query under load | Stays fast **while ingestion is active** |
| Dataset size | **~1,000,000 rows** (~1 month of data) |
| Ingest → queryable | Within **20 seconds** |
| Concurrent read load | **≥ 1 aggregation/sec** during ingest test |
| Bonus (extra credit) | 20k / 25k+ logs/sec |

### 2.2 Resource limits (hard)

| Container  | CPU | RAM |
|------------|-----|-----|
| Application | 0.5 | 256 MB |
| PostgreSQL  | 1.0 | 1 GB |

- Extra infrastructure allowed **only if** PostgreSQL stays the source of truth for reads and writes.

### 2.3 Other quality attributes

- **Reliability:** gracefully handle invalid logs, malformed JSON, bad timestamps, invalid cursors, empty ranges, bad params, partial-batch failures.
- **Security:** parameterized queries + safe dynamic-query construction. **SQL injection is disqualifying.**
- **Code quality:** readable TypeScript, strong typing, clear abstractions.
- **Separation of concerns:** HTTP handlers separated from query-building and persistence.
- **Infrastructure:** `docker compose up` works on first run; migrations applied automatically.
- **CI:** meaningful pipeline — build + typecheck + lint + test (+ contract smoke test).
- **Documentation:** README covering setup, API, schema, index design, attribute strategy, retention, measured performance, known limitations, optional features.



## 3. Contract rules for optional extras (the "golden rule")

- **Additive, never subtractive** — extras may add endpoints/headers/fields/config, but must never remove/rename an endpoint, change a required response shape, add a required param, or break a request that would have succeeded.
- **Zero-config default:** bare `docker compose up` (no env file, no args) = plain core service, unauthenticated, no rate limit the load generator could hit.
- **If auth implemented:** `AUTH_ENABLED=false` by default; `Authorization: Bearer` must work; an unknown `Authorization` header is **ignored** (not rejected) when auth is off; `/health` always public; `LOADGEN_API_KEY` seeded idempotently at startup.
- **Rate limiting:** off by default, or exempt the seeded loadgen key.
- **Backpressure:** `429`/`503` + `Retry-After` is legitimate, but shed requests count as **not ingested**.



## 4. Scope decision 

**In scope (must succeed):** the 4 core endpoints, per-entry validation, cursor pagination,
aggregation, retention, performance targets, tests, README, CI.

**Deferred (only if time remains):** auth, multi-tenancy, rate limiting, dashboard, live-tail,
alerting, compression, custom query language, pre-aggregated rollups (*unless* the perf
measurements prove they're needed).



## 5. Derived design tensions (the real decisions ahead)

These come straight from the requirements above and are what the next design sessions resolve:

1. **Attribute storage** — query speed vs. ingest cost vs. flexibility (JSONB+GIN vs. JSONB no-index vs. EAV).
2. **Index set** — more indexes = faster reads but slower 15k/s ingest (each index is maintained per row).
3. **`q` filter** — `ILIKE '%...%'` gets no help from a B-tree → trigram GIN (write cost) or scan within the time-pruned window.
4. **Aggregation p95 under concurrent writes** — may require rollup tables if raw scans miss the 1s target.
5. **Retention mechanism** — time-range **partitioning** (`DROP` a partition) vs. a large `DELETE` (locks + bloat).