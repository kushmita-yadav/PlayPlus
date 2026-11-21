ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS failed_login_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until timestamptz,
  ADD COLUMN IF NOT EXISTS email_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS password_changed_at timestamptz;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash text UNIQUE NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash text UNIQUE NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS security_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid REFERENCES accounts(id),
  event_type text NOT NULL,
  ip_address inet,
  user_agent text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_security_audit_created ON security_audit_events(created_at DESC);

ALTER TABLE staff_profiles
  ADD COLUMN IF NOT EXISTS annual_leave_days numeric(5,2) NOT NULL DEFAULT 18,
  ADD COLUMN IF NOT EXISTS used_leave_days numeric(5,2) NOT NULL DEFAULT 0;

ALTER TABLE staff_shifts
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'completed', 'cancelled')),
  ADD COLUMN IF NOT EXISTS break_minutes integer NOT NULL DEFAULT 0;
ALTER TABLE staff_shifts
  ADD COLUMN IF NOT EXISTS shift_period tstzrange
  GENERATED ALWAYS AS (tstzrange(starts_at, ends_at, '[)')) STORED;
ALTER TABLE staff_shifts
  DROP CONSTRAINT IF EXISTS uq_staff_shift_no_overlap;
ALTER TABLE staff_shifts
  ADD CONSTRAINT uq_staff_shift_no_overlap
  EXCLUDE USING gist (staff_id WITH =, shift_period WITH &&)
  WHERE (status <> 'cancelled');

CREATE TABLE IF NOT EXISTS tax_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  rate_percent numeric(5,2) NOT NULL CHECK (rate_percent BETWEEN 0 AND 100),
  applies_from date NOT NULL,
  applies_until date,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS ledger_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  account_type text NOT NULL CHECK (account_type IN ('asset', 'liability', 'equity', 'income', 'expense')),
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_id uuid NOT NULL,
  account_id uuid NOT NULL REFERENCES ledger_accounts(id) ON DELETE RESTRICT,
  debit numeric(14,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit numeric(14,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  reference_type text,
  reference_id text,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0))
);

CREATE INDEX IF NOT EXISTS idx_ledger_entries_account ON ledger_entries(account_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_journal ON ledger_entries(journal_id);

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS paid_amount numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_code text;

CREATE TABLE IF NOT EXISTS invoice_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  method text NOT NULL CHECK (method IN ('cash', 'card', 'upi', 'bank', 'online')),
  reference text,
  paid_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS expense_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES staff_profiles(id) ON DELETE RESTRICT,
  category text NOT NULL,
  description text NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  status text NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'approved', 'rejected', 'paid')),
  approved_by uuid REFERENCES accounts(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE cafeteria_orders
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS split_method jsonb;

ALTER TABLE shop_orders
  ADD COLUMN IF NOT EXISTS tracking_number text,
  ADD COLUMN IF NOT EXISTS carrier text,
  ADD COLUMN IF NOT EXISTS shipped_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz;

CREATE TABLE IF NOT EXISTS shop_order_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES shop_orders(id) ON DELETE CASCADE,
  status text NOT NULL,
  note text,
  created_by uuid REFERENCES accounts(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS product_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES shop_products(id) ON DELETE CASCADE,
  variant_sku text UNIQUE NOT NULL,
  name text NOT NULL,
  stock_quantity integer NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  price_override numeric(12,2) CHECK (price_override >= 0),
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS receipt_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number text UNIQUE NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('shop', 'cafeteria', 'court', 'membership')),
  source_id uuid NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  method text,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO ledger_accounts (code, name, account_type) VALUES
  ('1000', 'Cash and equivalents', 'asset'),
  ('1100', 'Accounts receivable', 'asset'),
  ('2000', 'Accounts payable', 'liability'),
  ('3000', 'Club equity', 'equity'),
  ('4000', 'Court revenue', 'income'),
  ('4100', 'Shop revenue', 'income'),
  ('4200', 'Cafeteria revenue', 'income'),
  ('4300', 'Membership revenue', 'income'),
  ('5000', 'Club expenses', 'expense'),
  ('5100', 'Payroll expense', 'expense')
ON CONFLICT (code) DO NOTHING;
