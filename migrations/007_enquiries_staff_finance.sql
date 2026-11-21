CREATE TABLE IF NOT EXISTS enquiries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text NOT NULL,
  email text,
  interest text NOT NULL,
  source text NOT NULL DEFAULT 'website',
  status text NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'follow_up', 'quoted', 'converted', 'closed')),
  assigned_to uuid REFERENCES accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS enquiry_followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enquiry_id uuid NOT NULL REFERENCES enquiries(id) ON DELETE CASCADE,
  note text NOT NULL,
  follow_up_at timestamptz,
  created_by uuid REFERENCES accounts(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_number text UNIQUE NOT NULL,
  enquiry_id uuid REFERENCES enquiries(id) ON DELETE SET NULL,
  member_id uuid REFERENCES members(id) ON DELETE SET NULL,
  subtotal numeric(12,2) NOT NULL CHECK (subtotal >= 0),
  tax_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  total_amount numeric(12,2) NOT NULL CHECK (total_amount >= 0),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'accepted', 'rejected', 'expired', 'converted')),
  valid_until date,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS staff_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid UNIQUE REFERENCES accounts(id) ON DELETE SET NULL,
  employee_number text UNIQUE NOT NULL,
  full_name text NOT NULL,
  department text NOT NULL,
  base_salary numeric(12,2) CHECK (base_salary >= 0),
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS staff_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES staff_profiles(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  role text NOT NULL,
  CHECK (ends_at > starts_at)
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES staff_profiles(id) ON DELETE CASCADE,
  starts_at date NOT NULL,
  ends_at date NOT NULL,
  reason text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by uuid REFERENCES accounts(id),
  reviewed_at timestamptz,
  CHECK (ends_at >= starts_at)
);

CREATE TABLE IF NOT EXISTS expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL,
  description text NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  expense_date date NOT NULL DEFAULT CURRENT_DATE,
  vendor text,
  status text NOT NULL DEFAULT 'recorded'
    CHECK (status IN ('recorded', 'paid', 'void')),
  created_by uuid REFERENCES accounts(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text UNIQUE NOT NULL,
  business_name text NOT NULL,
  billing_email text,
  subtotal numeric(12,2) NOT NULL CHECK (subtotal >= 0),
  tax_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  total_amount numeric(12,2) NOT NULL CHECK (total_amount >= 0),
  status text NOT NULL DEFAULT 'issued'
    CHECK (status IN ('draft', 'issued', 'partially_paid', 'paid', 'overdue', 'void')),
  issued_at date NOT NULL DEFAULT CURRENT_DATE,
  due_at date,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description text NOT NULL,
  quantity numeric(12,2) NOT NULL CHECK (quantity > 0),
  unit_price numeric(12,2) NOT NULL CHECK (unit_price >= 0),
  line_total numeric(12,2) NOT NULL CHECK (line_total >= 0)
);

CREATE TABLE IF NOT EXISTS payroll_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES staff_profiles(id) ON DELETE RESTRICT,
  period_start date NOT NULL,
  period_end date NOT NULL,
  gross_amount numeric(12,2) NOT NULL CHECK (gross_amount >= 0),
  deductions numeric(12,2) NOT NULL DEFAULT 0 CHECK (deductions >= 0),
  net_amount numeric(12,2) NOT NULL CHECK (net_amount >= 0),
  status text NOT NULL DEFAULT 'estimated'
    CHECK (status IN ('estimated', 'approved', 'paid')),
  created_at timestamptz NOT NULL DEFAULT now()
);
