INSERT INTO permissions (code, description) VALUES
  ('membership_plans.manage', 'Manage membership plan configuration and pricing'),
  ('courts.configure', 'Configure court facilities and pricing'),
  ('shop.catalog', 'Configure shop products and pricing'),
  ('staff.provision', 'Create staff profiles and compensation records'),
  ('payroll.manage', 'Manage payroll records')
ON CONFLICT (code) DO NOTHING;

DELETE FROM role_permissions rp
USING roles r, permissions p
WHERE rp.role_id=r.id
  AND rp.permission_id=p.id
  AND r.name='manager'
  AND p.code='finance.manage';

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON r.name='admin'
  AND p.code IN (
    'membership_plans.manage', 'courts.configure', 'shop.catalog',
    'staff.provision', 'payroll.manage'
  )
ON CONFLICT DO NOTHING;

UPDATE refresh_tokens rt
SET revoked_at=now()
FROM accounts a
JOIN roles r ON r.id=a.role_id
WHERE rt.account_id=a.id
  AND r.name='manager'
  AND rt.revoked_at IS NULL;
