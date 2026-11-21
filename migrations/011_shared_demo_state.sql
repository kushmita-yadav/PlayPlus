CREATE TABLE shared_demo_state (
  singleton_key smallint PRIMARY KEY DEFAULT 1 CHECK (singleton_key = 1),
  state jsonb NOT NULL CHECK (jsonb_typeof(state) = 'object'),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);
