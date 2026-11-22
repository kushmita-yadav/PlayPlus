ALTER TABLE membership_records
  DROP CONSTRAINT IF EXISTS membership_records_status_check;

ALTER TABLE membership_records
  ADD CONSTRAINT membership_records_status_check
  CHECK (status IN ('pending', 'active', 'expired', 'cancelled', 'suspended'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_membership_per_member
  ON membership_records (member_id) WHERE status = 'pending';

ALTER TABLE shop_orders
  ADD COLUMN IF NOT EXISTS customer_name text,
  ADD COLUMN IF NOT EXISTS customer_email text,
  ADD COLUMN IF NOT EXISTS customer_phone text;
