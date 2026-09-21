-- Loop database schema (PostgreSQL) — NOT currently in use.
-- The app currently runs on an in-memory store (src/store/memoryStore.ts)
-- with the exact same field shapes as this schema, so switching to
-- Postgres later means replacing the store's internals, not its API.
--
-- When ready: run this against a real Postgres database, then swap
-- src/store/memoryStore.ts for a Postgres-backed implementation (Kysely
-- or plain `pg` both work) that exposes the same exported functions.

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- for gen_random_uuid()

CREATE TABLE sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_transcript  TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TYPE task_category AS ENUM ('task', 'reminder', 'open_loop');
CREATE TYPE task_status AS ENUM ('open', 'done', 'snoozed');

CREATE TABLE tasks (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  origin_session_id   UUID REFERENCES sessions(id),
  text                TEXT NOT NULL,
  category            task_category NOT NULL,
  status              task_status NOT NULL DEFAULT 'open',
  urgency             SMALLINT NOT NULL DEFAULT 3 CHECK (urgency BETWEEN 1 AND 5),
  first_flagged_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  snoozed_until       TIMESTAMPTZ,
  snooze_reason       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_category ON tasks(category);

CREATE TABLE task_updates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id         UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  session_id      UUID REFERENCES sessions(id),
  raw_input       TEXT NOT NULL,
  change_summary  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_task_updates_task_id ON task_updates(task_id);

CREATE TABLE guide_me_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id           UUID REFERENCES tasks(id),
  time_available    TEXT NOT NULL,
  energy_level      TEXT NOT NULL,
  reason_given      TEXT,
  first_step_given  TEXT,
  accepted          BOOLEAN,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_guide_me_events_created ON guide_me_events(created_at);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tasks_set_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
