-- The hub's first schema (docs/04-data-and-sync.md). Times are milliseconds since 1970, UTC.

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE connectors (
  id            TEXT PRIMARY KEY,
  enabled       INTEGER NOT NULL DEFAULT 0,
  settings_json TEXT NOT NULL DEFAULT '{}',
  updated_at    INTEGER NOT NULL
);

CREATE TABLE secrets (
  connector_id TEXT NOT NULL,
  name         TEXT NOT NULL,
  value        TEXT NOT NULL,
  PRIMARY KEY (connector_id, name)
);

CREATE TABLE devices (
  id           TEXT PRIMARY KEY,
  connector_id TEXT NOT NULL,
  kind         TEXT NOT NULL,
  name         TEXT NOT NULL,
  room         TEXT,
  info_json    TEXT NOT NULL DEFAULT '{}',
  state_json   TEXT NOT NULL DEFAULT '{}',
  token_hash   TEXT,
  added_at     INTEGER NOT NULL,
  last_seen_at INTEGER,
  removed_at   INTEGER
);

CREATE TABLE events (
  id          INTEGER PRIMARY KEY,
  device_id   TEXT NOT NULL REFERENCES devices(id),
  seq         INTEGER NOT NULL,
  type        TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  who         TEXT,
  who_key     TEXT,
  app         TEXT,
  title       TEXT,
  body        TEXT,
  data_json   TEXT NOT NULL DEFAULT '{}',
  seen_at     INTEGER,
  UNIQUE (device_id, seq)
);
CREATE INDEX events_time ON events (occurred_at DESC);
CREATE INDEX events_type_time ON events (type, occurred_at DESC);
CREATE INDEX events_who ON events (who_key, occurred_at DESC);

CREATE VIRTUAL TABLE events_fts USING fts5 (who, title, body, content='events', content_rowid='id');
CREATE TRIGGER events_fts_add AFTER INSERT ON events BEGIN
  INSERT INTO events_fts (rowid, who, title, body) VALUES (new.id, new.who, new.title, new.body);
END;
CREATE TRIGGER events_fts_remove AFTER DELETE ON events BEGIN
  INSERT INTO events_fts (events_fts, rowid, who, title, body) VALUES ('delete', old.id, old.who, old.title, old.body);
END;

CREATE TABLE sync_state (
  device_id    TEXT PRIMARY KEY REFERENCES devices(id),
  last_seq     INTEGER NOT NULL DEFAULT 0,
  last_sync_at INTEGER,
  gaps_json    TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE collect (
  target     TEXT NOT NULL,
  scope      TEXT NOT NULL,
  enabled    INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (target, scope)
);

CREATE TABLE grants (
  target     TEXT NOT NULL,
  scope      TEXT NOT NULL,
  state      TEXT NOT NULL CHECK (state IN ('off', 'ask', 'on')),
  voice_safe INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (target, scope)
);

CREATE TABLE approvals (
  id           TEXT PRIMARY KEY,
  requested_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  scope        TEXT NOT NULL,
  risk         TEXT NOT NULL,
  device_id    TEXT,
  action       TEXT NOT NULL,
  args_json    TEXT NOT NULL,
  summary      TEXT NOT NULL,
  state        TEXT NOT NULL CHECK (state IN ('waiting', 'yes', 'no', 'expired')),
  decided_at   INTEGER
);

CREATE TABLE audit (
  id        INTEGER PRIMARY KEY,
  at        INTEGER NOT NULL,
  caller    TEXT NOT NULL,
  detail    TEXT,
  action    TEXT NOT NULL,
  target    TEXT,
  scope     TEXT,
  risk      TEXT,
  outcome   TEXT NOT NULL,
  data_json TEXT NOT NULL DEFAULT '{}',
  prev_hash TEXT NOT NULL,
  hash      TEXT NOT NULL
);

CREATE TABLE boards (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  position    INTEGER NOT NULL,
  layout_json TEXT NOT NULL
);

CREATE TABLE settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
