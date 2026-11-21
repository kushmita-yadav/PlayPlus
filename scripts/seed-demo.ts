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
