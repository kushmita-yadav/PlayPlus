CREATE TABLE IF NOT EXISTS cafeteria_menu_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category text NOT NULL,
  price numeric(12,2) NOT NULL CHECK (price >= 0),
  is_available boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cafeteria_tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_number text UNIQUE NOT NULL,
  seats integer NOT NULL DEFAULT 4 CHECK (seats > 0),
  status text NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'occupied', 'reserved')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customer_tabs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid REFERENCES members(id) ON DELETE RESTRICT,
  table_id uuid REFERENCES cafeteria_tables(id) ON DELETE RESTRICT,
  guest_name text,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'settled', 'void')),
  opened_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz
);

CREATE TABLE IF NOT EXISTS cafeteria_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number text UNIQUE NOT NULL,
  tab_id uuid REFERENCES customer_tabs(id) ON DELETE RESTRICT,
  table_id uuid REFERENCES cafeteria_tables(id) ON DELETE RESTRICT,
  member_id uuid REFERENCES members(id) ON DELETE RESTRICT,
  guest_name text,
  status text NOT NULL DEFAULT 'placed'
    CHECK (status IN ('placed', 'preparing', 'ready', 'served', 'cancelled')),
  subtotal numeric(12,2) NOT NULL DEFAULT 0,
  discount_amount numeric(12,2) NOT NULL DEFAULT 0,
  total_amount numeric(12,2) NOT NULL DEFAULT 0,
  idempotency_key text,
  created_by uuid REFERENCES accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cafeteria_order_idempotency
  ON cafeteria_orders (idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS cafeteria_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES cafeteria_orders(id) ON DELETE CASCADE,
  menu_item_id uuid NOT NULL REFERENCES cafeteria_menu_items(id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price numeric(12,2) NOT NULL CHECK (unit_price >= 0),
  line_total numeric(12,2) NOT NULL CHECK (line_total >= 0)
);

CREATE TABLE IF NOT EXISTS cafeteria_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tab_id uuid NOT NULL REFERENCES customer_tabs(id) ON DELETE RESTRICT,
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  method text NOT NULL CHECK (method IN ('cash', 'card', 'upi')),
  status text NOT NULL DEFAULT 'recorded'
    CHECK (status IN ('recorded', 'voided', 'refunded')),
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cafeteria_payment_idempotency
  ON cafeteria_payments (idempotency_key) WHERE idempotency_key IS NOT NULL;
