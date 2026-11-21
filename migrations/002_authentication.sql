CREATE TABLE IF NOT EXISTS roles (
  id smallserial PRIMARY KEY,
  name text UNIQUE NOT NULL,
  description text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS permissions (
  id smallserial PRIMARY KEY,
  code text UNIQUE NOT NULL,
  description text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id smallint NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id smallint NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  full_name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
  role_id smallint NOT NULL REFERENCES roles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_accounts_email ON accounts (lower(email));
CREATE INDEX IF NOT EXISTS idx_accounts_role ON accounts (role_id);

INSERT INTO roles (name, description) VALUES
  ('member', 'Self-service club member'),
  ('front_desk', 'Front desk operations'),
  ('staff', 'General club staff'),
  ('manager', 'Club operations manager'),
  ('admin', 'System administrator')
ON CONFLICT (name) DO NOTHING;

INSERT INTO permissions (code, description) VALUES
  ('members.read', 'View member records'),
  ('members.write', 'Create and update member records'),
  ('auth.admin', 'Manage administrator accounts'),
  ('memberships.manage', 'Manage membership plans and renewals'),
  ('courts.manage', 'Manage courts and reservations'),
  ('shop.manage', 'Manage shop catalog and inventory'),
  ('bar.manage', 'Manage bar and cafeteria operations'),
  ('finance.read', 'View financial reports'),
  ('finance.manage', 'Manage invoices and expenses'),
  ('staff.manage', 'Manage staff and leave')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON (
  (r.name = 'front_desk' AND p.code IN ('members.read', 'members.write'))
  OR (r.name = 'staff' AND p.code IN ('members.read', 'courts.manage', 'shop.manage', 'bar.manage'))
  OR (r.name = 'manager' AND p.code IN (
    'members.read', 'members.write', 'memberships.manage', 'courts.manage',
    'shop.manage', 'bar.manage', 'finance.read', 'finance.manage', 'staff.manage'
  ))
  OR (r.name = 'admin')
)
ON CONFLICT DO NOTHING;
