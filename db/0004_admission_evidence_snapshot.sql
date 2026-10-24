ALTER TABLE admissions
  ADD COLUMN evidence_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb
  CHECK (jsonb_typeof(evidence_snapshot) = 'object');
