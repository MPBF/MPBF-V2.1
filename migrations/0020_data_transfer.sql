BEGIN;
CREATE TABLE IF NOT EXISTS data_transfer_previews (
  id uuid PRIMARY KEY, actor_id integer NOT NULL REFERENCES users(id),
  document jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS data_transfer_operations (
  id uuid PRIMARY KEY, actor_id integer NOT NULL REFERENCES users(id),
  kind text NOT NULL, status text NOT NULL, counts jsonb NOT NULL DEFAULT '{}',
  approval_hash text, result jsonb, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS data_transfer_backups (
  id uuid PRIMARY KEY, actor_id integer NOT NULL REFERENCES users(id),
  document jsonb NOT NULL, checksum text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS data_transfer_templates (
  id uuid PRIMARY KEY, actor_id integer NOT NULL REFERENCES users(id),
  name text NOT NULL, schema_version text NOT NULL, mappings jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON data_transfer_previews, data_transfer_operations, data_transfer_backups, data_transfer_templates FROM PUBLIC;
CREATE INDEX IF NOT EXISTS data_transfer_operations_actor_time ON data_transfer_operations(actor_id,created_at DESC);
CREATE INDEX IF NOT EXISTS data_transfer_previews_expiry ON data_transfer_previews(expires_at);
CREATE INDEX IF NOT EXISTS data_transfer_backups_expiry ON data_transfer_backups(expires_at);
COMMIT;
