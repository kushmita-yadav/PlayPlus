ALTER TABLE membership_records
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'pending'
  CHECK (approval_status IN ('pending', 'approved', 'rejected'));

UPDATE membership_records
SET approval_status='approved'
WHERE status='active' AND approval_status='pending';

CREATE TABLE IF NOT EXISTS payment_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider IN ('razorpay')),
  source_type text NOT NULL CHECK (source_type IN ('shop_order', 'membership')),
  source_id uuid NOT NULL,
  gateway_order_id text NOT NULL UNIQUE,
  gateway_payment_id text UNIQUE,
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  currency text NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'captured', 'failed', 'refunded')),
  signature_verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_transactions_source
  ON payment_transactions (source_type, source_id, created_at DESC);
