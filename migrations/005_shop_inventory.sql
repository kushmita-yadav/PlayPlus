CREATE TABLE IF NOT EXISTS shop_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku text UNIQUE NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  category text NOT NULL,
  price numeric(12,2) NOT NULL CHECK (price >= 0),
  stock_quantity integer NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  low_stock_threshold integer NOT NULL DEFAULT 5 CHECK (low_stock_threshold >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES shop_products(id) ON DELETE RESTRICT,
  movement_type text NOT NULL CHECK (movement_type IN ('purchase', 'sale', 'adjustment', 'return', 'cancellation')),
  quantity_change integer NOT NULL,
  reference_type text,
  reference_id text,
  note text,
  created_by uuid REFERENCES accounts(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shop_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number text UNIQUE NOT NULL,
  member_id uuid REFERENCES members(id) ON DELETE RESTRICT,
  channel text NOT NULL CHECK (channel IN ('counter', 'online')),
  fulfillment text NOT NULL CHECK (fulfillment IN ('pickup', 'delivery')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'fulfilled', 'cancelled')),
  idempotency_key text,
  subtotal numeric(12,2) NOT NULL DEFAULT 0,
  discount_amount numeric(12,2) NOT NULL DEFAULT 0,
  total_amount numeric(12,2) NOT NULL DEFAULT 0,
  delivery_address text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_shop_order_idempotency
  ON shop_orders (idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS shop_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES shop_orders(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES shop_products(id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price numeric(12,2) NOT NULL CHECK (unit_price >= 0),
  discount_percent numeric(5,2) NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 100),
  line_total numeric(12,2) NOT NULL CHECK (line_total >= 0),
  UNIQUE (order_id, product_id)
);

CREATE TABLE IF NOT EXISTS shop_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES shop_orders(id) ON DELETE RESTRICT,
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  method text NOT NULL CHECK (method IN ('cash', 'card', 'upi', 'online')),
  status text NOT NULL DEFAULT 'recorded'
    CHECK (status IN ('recorded', 'voided', 'refunded')),
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_shop_payment_idempotency
  ON shop_payments (idempotency_key) WHERE idempotency_key IS NOT NULL;
