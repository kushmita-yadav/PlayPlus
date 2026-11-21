CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS sports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS courts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sport_id uuid NOT NULL REFERENCES sports(id) ON DELETE RESTRICT,
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  booking_interval_minutes integer NOT NULL DEFAULT 30 CHECK (booking_interval_minutes > 0),
  session_duration_minutes integer NOT NULL DEFAULT 60 CHECK (session_duration_minutes > 0),
  base_hourly_price numeric(12,2) NOT NULL DEFAULT 0 CHECK (base_hourly_price >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS court_schedule_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  court_id uuid NOT NULL REFERENCES courts(id) ON DELETE CASCADE,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  opens_at time NOT NULL,
  closes_at time NOT NULL,
  price_override numeric(12,2) CHECK (price_override >= 0),
  social_play boolean NOT NULL DEFAULT false,
  CHECK (opens_at < closes_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_court_schedule_weekday
  ON court_schedule_rules (court_id, weekday);

CREATE TABLE IF NOT EXISTS court_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  court_id uuid NOT NULL REFERENCES courts(id) ON DELETE RESTRICT,
  member_id uuid REFERENCES members(id) ON DELETE RESTRICT,
  participant_name text,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('confirmed', 'cancelled', 'completed', 'no_show')),
  booking_type text NOT NULL DEFAULT 'individual'
    CHECK (booking_type IN ('individual', 'walk_in', 'social')),
  idempotency_key text,
  base_amount numeric(12,2) NOT NULL DEFAULT 0,
  discount_amount numeric(12,2) NOT NULL DEFAULT 0,
  final_amount numeric(12,2) NOT NULL DEFAULT 0,
  cancelled_at timestamptz,
  cancellation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_reservation_idempotency
  ON court_reservations (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reservations_court_time
  ON court_reservations (court_id, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_reservations_member_day
  ON court_reservations (member_id, starts_at);

ALTER TABLE court_reservations
  ADD COLUMN IF NOT EXISTS booking_period tstzrange
  GENERATED ALWAYS AS (tstzrange(starts_at, ends_at, '[)')) STORED;

ALTER TABLE court_reservations
  DROP CONSTRAINT IF EXISTS uq_reservations_no_overlap;
ALTER TABLE court_reservations
  ADD CONSTRAINT uq_reservations_no_overlap
  EXCLUDE USING gist (court_id WITH =, booking_period WITH &&)
  WHERE (status = 'confirmed');

CREATE TABLE IF NOT EXISTS reservation_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL REFERENCES court_reservations(id) ON DELETE CASCADE,
  member_id uuid REFERENCES members(id) ON DELETE RESTRICT,
  participant_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO sports (code, name) VALUES
  ('TENNIS', 'Tennis'),
  ('PADEL', 'Padel'),
  ('BADMINTON', 'Badminton'),
  ('CRICKET', 'Cricket')
ON CONFLICT (code) DO NOTHING;

INSERT INTO courts (sport_id, code, name, base_hourly_price)
SELECT s.id, c.code, c.name, c.price
FROM sports s
CROSS JOIN (
  VALUES
    ('TENNIS-1', 'Tennis Court 1', 1200::numeric),
    ('TENNIS-2', 'Tennis Court 2', 1200::numeric),
    ('PADEL-1', 'Padel Court 1', 1000::numeric),
    ('BADMINTON-1', 'Badminton Court 1', 800::numeric),
    ('CRICKET-1', 'Cricket Net 1', 1500::numeric)
) AS c(code, name, price)
WHERE s.code = CASE split_part(c.code, '-', 1)
  WHEN 'TENNIS' THEN 'TENNIS'
  WHEN 'PADEL' THEN 'PADEL'
  WHEN 'BADMINTON' THEN 'BADMINTON'
  WHEN 'CRICKET' THEN 'CRICKET'
END
ON CONFLICT (code) DO NOTHING;
