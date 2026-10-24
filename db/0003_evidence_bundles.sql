CREATE TABLE evidence_bundles (
  bundle_id TEXT PRIMARY KEY,
  bundle JSONB NOT NULL CHECK (jsonb_typeof(bundle) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
