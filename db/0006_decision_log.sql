-- One row per CartAttest decision on an agent's proposal, including blocks that never reach PayPal.
-- The PayPal and capture state are joined live from admissions and capture_attempts when read.
CREATE TABLE decision_log (
  decision_id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('SELECTION', 'STEP_UP_DECISION')),
  claim_set_id TEXT,
  subject_ref TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('ALLOW', 'STEP_UP', 'BLOCK', 'CHOOSE_ANOTHER')),
  reason TEXT,
  admission_id TEXT,
  step_up_session_id TEXT,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(summary) = 'object')
);

CREATE INDEX decision_log_created_idx ON decision_log (created_at DESC);
