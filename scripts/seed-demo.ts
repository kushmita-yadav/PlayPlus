import bcrypt from "bcryptjs";
import { pool } from "../src/database/pool.js";

if (!pool) throw new Error("DATABASE_URL is required");

const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT 1");

  const passwordHash = await bcrypt.hash("DemoPassword123!", 12);
  await client.query(
    `INSERT INTO accounts (email, password_hash, full_name, role_id)
     SELECT $1,$2,$3,r.id FROM roles r WHERE r.name='admin'
     ON CONFLICT (email) DO UPDATE SET full_name=EXCLUDED.full_name`,
    ["admin@champions.local", passwordHash, "Champions Club Admin"],
  );
  await client.query(
    `INSERT INTO accounts (email, password_hash, full_name, role_id)
     SELECT $1,$2,$3,r.id FROM roles r WHERE r.name='member'
     ON CONFLICT (email) DO UPDATE SET full_name=EXCLUDED.full_name`,
    ["member@champions.local", passwordHash, "Demo Member"],
  );

  const member = await client.query(
    `INSERT INTO members (member_number, full_name, phone, email, date_of_birth)
     VALUES ('CC-DEMO-001','Demo Member','9876543210','member@champions.local','2000-01-01')
     ON CONFLICT (member_number) DO UPDATE SET full_name=EXCLUDED.full_name
     RETURNING id`,
  );
  const gold = await client.query("SELECT id FROM membership_plans WHERE code='GOLD'");
  if (gold.rowCount) {
    await client.query(
      `INSERT INTO membership_records (member_id, plan_id, starts_at, expires_at, status)
       SELECT $1,$2,now(),now()+interval '365 days','active'
       WHERE NOT EXISTS (
         SELECT 1 FROM membership_records WHERE member_id=$1 AND status='active'
       )`,
      [member.rows[0].id, gold.rows[0].id],
    );
    await client.query(
      `INSERT INTO membership_records (member_id,plan_id,starts_at,expires_at,status)
       SELECT $1,$2,now()-interval '730 days',now()-interval '365 days','expired'
       WHERE NOT EXISTS (
         SELECT 1 FROM membership_records
         WHERE member_id=$1 AND plan_id=$2 AND status='expired'
       )`,
      [member.rows[0].id,gold.rows[0].id],
    );
    await client.query(
      `INSERT INTO membership_history
         (member_id,action,to_plan_id,note)
       SELECT $1,'renewed',$2,'Demo renewal history'
       WHERE NOT EXISTS (
         SELECT 1 FROM membership_history
         WHERE member_id=$1 AND action='renewed'
       )`,
      [member.rows[0].id,gold.rows[0].id],
    );
  }

  await client.query(
    `INSERT INTO shop_products (sku,name,description,category,price,stock_quantity,low_stock_threshold)
     VALUES
       ('RACKET-DEMO','Champions Tennis Racket','Demo racket','Rackets',4200,20,5),
       ('SHOE-DEMO','Court Training Shoes','Demo shoes','Footwear',3200,4,5),
       ('BALL-DEMO','Champions Padel Balls','Three-ball tube','Balls',750,30,8)
     ON CONFLICT (sku) DO UPDATE SET
       name=EXCLUDED.name, price=EXCLUDED.price`,
  );
  await client.query(
    `INSERT INTO cafeteria_menu_items (name,category,price)
     VALUES ('Masala Lemonade','Drinks',120),('Club Sandwich','Food',280),('Cold Coffee','Drinks',180)
     ON CONFLICT DO NOTHING`,
  );
  await client.query(
    `INSERT INTO cafeteria_tables (table_number,seats,status)
     VALUES ('T1',4,'available'),('T2',4,'available'),('T3',6,'available')
     ON CONFLICT (table_number) DO NOTHING`,
  );

  await client.query(
    `INSERT INTO customer_tabs (member_id,table_id,guest_name,status)
     SELECT m.id,t.id,NULL,'open'
     FROM members m
     JOIN cafeteria_tables t ON t.table_number='T1'
     WHERE m.member_number='CC-DEMO-001'
       AND NOT EXISTS (
         SELECT 1 FROM customer_tabs ct
         WHERE ct.member_id=m.id AND ct.status='open'
       )
     LIMIT 1`,
  );
  await client.query(
    `INSERT INTO cafeteria_orders
       (order_number,tab_id,table_id,member_id,guest_name,status,subtotal,discount_amount,total_amount,notes)
     SELECT 'BAR-DEMO-001',ct.id,ct.table_id,ct.member_id,NULL,'placed',400,40,360,'Demo tab order'
     FROM customer_tabs ct
     WHERE ct.status='open'
       AND NOT EXISTS (
         SELECT 1 FROM cafeteria_orders WHERE order_number='BAR-DEMO-001'
       )
     LIMIT 1`,
  );

  await client.query(
    `INSERT INTO shop_orders
       (order_number,member_id,channel,fulfillment,status,subtotal,discount_amount,total_amount,delivery_address)
     SELECT 'SHOP-DEMO-001',m.id,'counter','pickup','confirmed',4200,420,3780,NULL
     FROM members m
     WHERE m.member_number='CC-DEMO-001'
       AND NOT EXISTS (
         SELECT 1 FROM shop_orders WHERE order_number='SHOP-DEMO-001'
       )`,
  );

  await client.query(
    `INSERT INTO members (member_number,full_name,phone,email,date_of_birth)
     VALUES
       ('CC-DEMO-002','Silver Demo','9876543211','silver@champions.local','1995-05-15'),
       ('CC-DEMO-003','Junior Demo','9876543212','junior@champions.local','2012-08-20')
     ON CONFLICT (member_number) DO UPDATE SET full_name=EXCLUDED.full_name`,
  );

  await client.query(
    `INSERT INTO staff_profiles (employee_number,full_name,department,base_salary,status)
     VALUES
       ('EMP-DEMO-001','Front Desk Demo','Front Desk',32000,'active'),
       ('EMP-DEMO-002','Bar Staff Demo','Cafeteria',28000,'active')
     ON CONFLICT (employee_number) DO UPDATE SET full_name=EXCLUDED.full_name`,
  );
  await client.query(
    `INSERT INTO staff_shifts (staff_id,starts_at,ends_at,role,status)
     SELECT sp.id,now()+interval '1 day',now()+interval '1 day'+interval '8 hours','Front desk','scheduled'
     FROM staff_profiles sp
     WHERE sp.employee_number='EMP-DEMO-001'
       AND NOT EXISTS (
         SELECT 1 FROM staff_shifts ss
         WHERE ss.staff_id=sp.id AND ss.status='scheduled'
       )`,
  );
  await client.query(
    `INSERT INTO leave_requests (staff_id,starts_at,ends_at,reason,status)
     SELECT sp.id,CURRENT_DATE+30,CURRENT_DATE+31,'Demo leave','pending'
     FROM staff_profiles sp
     WHERE sp.employee_number='EMP-DEMO-002'
       AND NOT EXISTS (
         SELECT 1 FROM leave_requests lr
         WHERE lr.staff_id=sp.id AND lr.reason='Demo leave'
       )`,
  );

  const tennisCourt = await client.query(
    `SELECT id FROM courts WHERE code='TENNIS-1' LIMIT 1`,
  );
  if (tennisCourt.rowCount) {
    await client.query(
      `INSERT INTO court_reservations
         (court_id,member_id,starts_at,ends_at,status,booking_type,base_amount,discount_amount,final_amount)
       SELECT $1,$2,date_trunc('hour',now()+interval '26 hours'),
              date_trunc('hour',now()+interval '27 hours'),
              'confirmed','individual',1200,300,900
       WHERE NOT EXISTS (
         SELECT 1 FROM court_reservations
         WHERE court_id=$1 AND member_id=$2
           AND starts_at=date_trunc('hour',now()+interval '26 hours')
       )`,
      [tennisCourt.rows[0].id, member.rows[0].id],
    );
  }

  await client.query(
    `INSERT INTO enquiries (name,phone,email,interest,source,status)
     VALUES
       ('Trial Visitor','9876500001','trial@example.com','Tennis trial','website','new'),
       ('Corporate Visitor','9876500002','corporate@example.com','Business court package','phone','follow_up')
     ON CONFLICT DO NOTHING`,
  );

  await client.query(
    `INSERT INTO expenses (category,description,amount,expense_date,vendor,status)
     VALUES
       ('Maintenance','Demo court maintenance',4500,CURRENT_DATE,'Local Vendor','recorded'),
       ('Utilities','Demo monthly electricity',12000,CURRENT_DATE,'Utility Board','recorded')
     ON CONFLICT DO NOTHING`,
  );

  await client.query(
    `INSERT INTO invoices
       (invoice_number,business_name,billing_email,subtotal,tax_amount,total_amount,status,issued_at,due_at)
     VALUES
       ('INV-DEMO-001','Nova Sports LLP','accounts@nova.example',50000,9000,59000,'issued',CURRENT_DATE,CURRENT_DATE+30)
     ON CONFLICT (invoice_number) DO UPDATE SET business_name=EXCLUDED.business_name`,
  );

  await client.query("COMMIT");
  console.log("Demo data seeded");
  console.log("Admin: admin@champions.local");
  console.log("Member: member@champions.local");
  console.log("Demo password: DemoPassword123!");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
