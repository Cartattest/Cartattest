CREATE TABLE step_up_sessions (
  session_id TEXT PRIMARY KEY,
  context JSONB NOT NULL CHECK (jsonb_typeof(context) = 'object'),
  context_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL CHECK (expires_at > created_at),
  consumed_at TIMESTAMPTZ
);

CREATE INDEX step_up_sessions_expiry_idx ON step_up_sessions (expires_at) WHERE consumed_at IS NULL;
