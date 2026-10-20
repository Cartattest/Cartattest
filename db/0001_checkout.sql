CREATE TABLE claim_sets (
  claim_set_id TEXT PRIMARY KEY,
  claim_set_hash TEXT NOT NULL UNIQUE,
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL CHECK (expires_at > created_at)
);

CREATE TABLE admissions (
  admission_id TEXT PRIMARY KEY,
  claim_set_id TEXT NOT NULL REFERENCES claim_sets (claim_set_id),
  subject_ref TEXT NOT NULL,
  subject_hash TEXT NOT NULL,
  resolved_cart_snapshot_hash TEXT NOT NULL,
  evidence_manifest_version TEXT NOT NULL,
  evidence_set_hashes TEXT[] NOT NULL DEFAULT '{}',
  attestation_hashes TEXT[] NOT NULL DEFAULT '{}',
  override_hashes TEXT[] NOT NULL DEFAULT '{}',
  policy_version TEXT NOT NULL,
  cart_binding_profile TEXT NOT NULL CHECK (cart_binding_profile = 'v1'),
  admitted_cart_binding JSONB NOT NULL CHECK (jsonb_typeof(admitted_cart_binding) = 'object'),
  admitted_cart_binding_hash TEXT NOT NULL,
  paypal_order_id TEXT UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('CREATING_ORDER', 'AWAITING_APPROVAL', 'CAPTURE_STARTED', 'CLOSED', 'ABORTED')),
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL CHECK (expires_at > created_at),
  UNIQUE (admission_id, paypal_order_id),
  CONSTRAINT admissions_order_state_check CHECK (
    (state = 'CREATING_ORDER' AND paypal_order_id IS NULL) OR
    state = 'ABORTED' OR
    (state <> 'CREATING_ORDER' AND state <> 'ABORTED' AND paypal_order_id IS NOT NULL)
  )
);

CREATE INDEX admissions_expiry_idx ON admissions (expires_at) WHERE state = 'AWAITING_APPROVAL';

CREATE TABLE capture_attempts (
  attempt_id TEXT PRIMARY KEY,
  admission_id TEXT NOT NULL,
  paypal_order_id TEXT NOT NULL,
  material_hash TEXT NOT NULL,
  paypal_request_id TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN (
    'IN_FLIGHT', 'EXECUTION_UNKNOWN', 'CAPTURE_PENDING', 'CAPTURE_COMPLETED_PENDING_WEBHOOK',
    'CAPTURE_DECLINED', 'CAPTURE_FAILED', 'CLOSED_VERIFIED_WEBHOOK', 'CLOSED_RECONCILED'
  )),
  paypal_capture_id TEXT,
  paypal_capture_status TEXT CHECK (paypal_capture_status IN ('COMPLETED', 'DECLINED', 'PENDING', 'FAILED')),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL CHECK (updated_at >= created_at),
  FOREIGN KEY (admission_id, paypal_order_id) REFERENCES admissions (admission_id, paypal_order_id)
);

CREATE UNIQUE INDEX capture_attempts_one_active_per_order_idx
  ON capture_attempts (paypal_order_id)
  WHERE state IN ('IN_FLIGHT', 'EXECUTION_UNKNOWN', 'CAPTURE_PENDING', 'CAPTURE_COMPLETED_PENDING_WEBHOOK');

CREATE UNIQUE INDEX capture_attempts_one_active_per_admission_idx
  ON capture_attempts (admission_id)
  WHERE state IN ('IN_FLIGHT', 'EXECUTION_UNKNOWN', 'CAPTURE_PENDING', 'CAPTURE_COMPLETED_PENDING_WEBHOOK');

CREATE TABLE paypal_webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  paypal_order_id TEXT,
  paypal_capture_id TEXT,
  verified_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object')
);
