CREATE TABLE IF NOT EXISTS player_profiles (
  member_id uuid PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  skill_level smallint NOT NULL CHECK (skill_level BETWEEN 1 AND 5),
  preferred_sports text[] NOT NULL DEFAULT '{}',
  availability jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS matchmaking_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_member_id uuid NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  sport_code text NOT NULL,
  preferred_starts_at timestamptz,
  skill_floor smallint CHECK (skill_floor BETWEEN 1 AND 5),
  skill_ceiling smallint CHECK (skill_ceiling BETWEEN 1 AND 5),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'matched', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS matchmaking_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES matchmaking_requests(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  compatibility_score numeric(5,2) NOT NULL CHECK (compatibility_score BETWEEN 0 AND 100),
  explanation jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS assistant_action_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid REFERENCES accounts(id),
  intent text NOT NULL,
  user_message text NOT NULL,
  result jsonb NOT NULL,
  confirmed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
