-- Hosted demo only: the demo buyer key and the receipt-signing key, created on first start of a
-- hosted instance that has no key files. Local runs keep using .codex/keys and leave this table empty.
CREATE TABLE hosted_demo_keys (
  key_set_id TEXT PRIMARY KEY CHECK (key_set_id = 'default'),
  buyer_private_pem TEXT NOT NULL,
  buyer_public_pem TEXT NOT NULL,
  service_private_pem TEXT NOT NULL,
  service_public_pem TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
