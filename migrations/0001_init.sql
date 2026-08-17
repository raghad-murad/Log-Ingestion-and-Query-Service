-- Migration tracking table (idempotent).
CREATE TABLE IF NOT EXISTS schema_migrations (
  version     text        PRIMARY KEY,
  applied_at  timestamptz NOT NULL DEFAULT now()
);

-- Core logs table, range-partitioned by event timestamp (see DESIGN.md §2, §5).
-- The composite PRIMARY KEY (timestamp, id):
--   * must include the partition key (a Postgres requirement for partitioned PKs),
--   * doubles as the sort + keyset-cursor index (scanned backward for DESC), and
--   * uses id as the deterministic tiebreaker when timestamps collide.
CREATE TABLE IF NOT EXISTS logs (
  id          bigint       GENERATED ALWAYS AS IDENTITY,
  timestamp   timestamptz  NOT NULL,
  level       text         NOT NULL,
  service     text         NOT NULL,
  message     text         NOT NULL,
  attributes  jsonb        NOT NULL DEFAULT '{}',
  PRIMARY KEY (timestamp, id)
) PARTITION BY RANGE (timestamp);
