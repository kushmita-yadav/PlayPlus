CREATE TABLE IF NOT EXISTS membership_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  monthly_price numeric(12,2) NOT NULL CHECK (monthly_price >= 0),
  is_active boolean NOT NULL DEFAULT true,
  benefits jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid UNIQUE REFERENCES accounts(id) ON DELETE SET NULL,
  member_number text UNIQUE NOT NULL,
  full_name text NOT NULL,
  phone text NOT NULL,
  email text,
  date_of_birth date,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'expired', 'cancelled')),
  emergency_contact jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS membership_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  plan_id uuid NOT NULL REFERENCES membership_plans(id) ON DELETE RESTRICT,
  starts_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'expired', 'cancelled', 'suspended')),
  is_auto_renew boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_membership_records_member ON membership_records (member_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_membership_records_expiry ON membership_records (expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_membership_per_member
  ON membership_records (member_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS membership_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  membership_record_id uuid REFERENCES membership_records(id) ON DELETE SET NULL,
  action text NOT NULL
    CHECK (action IN ('registered', 'renewed', 'upgraded', 'downgraded', 'changed', 'cancelled', 'expired')),
  from_plan_id uuid REFERENCES membership_plans(id),
  to_plan_id uuid REFERENCES membership_plans(id),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
