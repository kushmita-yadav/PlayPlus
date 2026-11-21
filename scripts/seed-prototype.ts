import bcrypt from "bcryptjs";
import { createHash } from "node:crypto";
import { env } from "../src/config/env.js";
import { pool } from "../src/database/pool.js";

type PrototypeRow = Record<string, unknown> & { id: string };
type SharedModule =
  | "members" | "plans" | "courts" | "bookings" | "products" | "orders"
  | "menu" | "tables" | "tabs" | "kitchen" | "enquiries" | "staff" | "leave"
  | "transactions" | "expenses" | "invoices" | "notifications";

const moduleKeys: SharedModule[] = [
  "members", "plans", "courts", "bookings", "products", "orders", "menu", "tables",
  "tabs", "kitchen", "enquiries", "staff", "leave", "transactions", "expenses",
  "invoices", "notifications",
];
const emptyState: Record<SharedModule, PrototypeRow[]> = {
  members: [], plans: [], courts: [], bookings: [], products: [], orders: [],
  menu: [], tables: [], tabs: [], kitchen: [], enquiries: [], staff: [], leave: [],
  transactions: [], expenses: [], invoices: [], notifications: [],
};
const prototypePassword = "Prototype!2026";
const roles = ["admin", "manager", "front_desk", "staff", "member"] as const;

const planSpecs = [
  { code: "GOLD", name: "Gold", price: 2500, court: 20, shop: 10, cafe: 10, sessions: 1, description: "Prototype sample plan" },
  { code: "SILVER", name: "Silver", price: 1500, court: 10, shop: 5, cafe: 5, sessions: 0, description: "Prototype sample plan" },
  { code: "JUNIOR", name: "Junior", price: 750, court: 5, shop: 0, cafe: 0, sessions: 0, description: "Prototype sample plan for members under 18" },
];

const memberSpecs = [
  { name: "Aarav Mehta", phone: "9990001001", email: "member@champions.club", plan: "GOLD", expiresIn: 12, birth: "2000-01-15", balance: 0 },
  { name: "Mira Shah", phone: "9990001002", email: "mira@example.test", plan: "SILVER", expiresIn: 60, birth: "1998-06-02", balance: 850 },
  { name: "Kabir Rao", phone: "9990001003", email: "kabir@example.test", plan: "GOLD", expiresIn: 95, birth: "1992-11-12", balance: 0 },
  { name: "Anaya Iyer", phone: "9990001004", email: "anaya@example.test", plan: "JUNIOR", expiresIn: 150, birth: "2011-04-20", balance: 250 },
  { name: "Dev Malhotra", phone: "9990001005", email: "dev@example.test", plan: "SILVER", expiresIn: 42, birth: "1995-03-08", balance: 0 },
  { name: "Riya Nair", phone: "9990001006", email: "riya@example.test", plan: "GOLD", expiresIn: 180, birth: "2001-08-27", balance: 1200 },
  { name: "Ishaan Kapoor", phone: "9990001007", email: "ishaan@example.test", plan: "SILVER", expiresIn: 75, birth: "1997-12-03", balance: 0 },
  { name: "Tara Menon", phone: "9990001008", email: "tara@example.test", plan: "JUNIOR", expiresIn: 110, birth: "2010-09-11", balance: 0 },
];

const courtSpecs = [
  { code: "PROTO-TENNIS-1", name: "Tennis Court 1", sport: "TENNIS", price: 1200, status: "Available" },
  { code: "PROTO-PADEL-1", name: "Padel Court 1", sport: "PADEL", price: 1500, status: "Available" },
  { code: "PROTO-BADMINTON-1", name: "Badminton Court 1", sport: "BADMINTON", price: 700, status: "Available" },
  { code: "PROTO-CRICKET-1", name: "Cricket Nets 1", sport: "CRICKET", price: 1000, status: "Maintenance" },
];

const productSpecs = [
  { sku: "PROTO-RACKET-01", name: "Club Tennis Racket", description: "Prototype racket listing", category: "Rackets", price: 4200, stock: 18, threshold: 5 },
  { sku: "PROTO-SHOE-01", name: "Court Training Shoes", description: "Prototype footwear listing", category: "Footwear", price: 3200, stock: 3, threshold: 5 },
  { sku: "PROTO-BALL-01", name: "Tennis Ball Can", description: "Three-ball prototype pack", category: "Balls", price: 450, stock: 32, threshold: 8 },
  { sku: "PROTO-PADEL-01", name: "Padel Ball Tube", description: "Prototype padel balls", category: "Balls", price: 750, stock: 2, threshold: 6 },
  { sku: "PROTO-GRIP-01", name: "Overgrip Pack", description: "Prototype grip pack", category: "Accessories", price: 300, stock: 25, threshold: 10 },
  { sku: "PROTO-BOTTLE-01", name: "Club Water Bottle", description: "Prototype reusable bottle", category: "Accessories", price: 550, stock: 0, threshold: 4 },
];

const menuSpecs = [
  { name: "Masala Lemonade", category: "Drinks", price: 120 },
  { name: "Club Sandwich", category: "Food", price: 280 },
  { name: "Cold Coffee", category: "Drinks", price: 180 },
  { name: "Fruit Bowl", category: "Food", price: 220 },
  { name: "Protein Smoothie", category: "Drinks", price: 240 },
];

function localDate(daysFromToday: number, hour = 0, minute = 0): Date {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  date.setHours(hour, minute, 0, 0);
  return date;
}

function dateOnly(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function timeOnly(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function stableUuid(value: string): string {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function isRecord(value: unknown): value is PrototypeRow {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).id === "string";
}

function mergePrototypeRows(existing: unknown, seedRows: PrototypeRow[]): PrototypeRow[] {
  const rows = Array.isArray(existing) ? existing.filter(isRecord) : [];
  return [...rows.filter((row) => !row.id.startsWith("PROTO-")), ...seedRows];
}

function requirePrototypeDatabase(): void {
  if (env.NODE_ENV !== "development") {
    throw new Error("Prototype data can only be seeded when NODE_ENV=development");
  }
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const url = new URL(env.DATABASE_URL);
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname) || url.pathname !== "/playplus") {
    throw new Error("Prototype seeding requires the dedicated local 'playplus' database");
  }
  if (!pool) throw new Error("DATABASE_URL is required");
}

requirePrototypeDatabase();

const client = await pool!.connect();
try {
  await client.query("BEGIN");

  const roleRows = await client.query("SELECT id, name FROM roles WHERE name = ANY($1::text[])", [roles]);
  const roleIds = new Map(roleRows.rows.map((row) => [String(row.name), Number(row.id)]));
  for (const role of roles) {
    if (!roleIds.has(role)) throw new Error(`Required role '${role}' is missing; run migrations first`);
  }

  const passwordHash = await bcrypt.hash(prototypePassword, 12);
  const accountIds = new Map<string, string>();
  const accountSpecs = [
    { key: "admin", email: "admin@champions.club", name: "Prototype Administrator", role: "admin" },
    { key: "manager", email: "manager@champions.club", name: "Prototype Manager", role: "manager" },
    { key: "front_desk", email: "desk@champions.club", name: "Prototype Front Desk", role: "front_desk" },
    { key: "staff", email: "staff@champions.club", name: "Prototype Staff", role: "staff" },
    { key: "member", email: "member@champions.club", name: "Aarav Mehta", role: "member" },
  ];

  for (const account of accountSpecs) {
    const result = await client.query(
      `INSERT INTO accounts
         (email, password_hash, full_name, role_id, status, failed_login_attempts, locked_until)
       VALUES ($1,$2,$3,$4,'active',0,NULL)
       ON CONFLICT (email) DO UPDATE SET
         password_hash=EXCLUDED.password_hash,
         full_name=EXCLUDED.full_name,
         role_id=EXCLUDED.role_id,
         status='active',
         failed_login_attempts=0,
         locked_until=NULL,
         updated_at=now()
       RETURNING id`,
      [account.email, passwordHash, account.name, roleIds.get(account.role)],
    );
    accountIds.set(account.key, String(result.rows[0].id));
  }

  const planIds = new Map<string, string>();
  for (const plan of planSpecs) {
    const benefits = {
      courtFreeSessionsPerDay: plan.sessions,
      courtDiscountPercent: plan.court,
      shopDiscountPercent: plan.shop,
      barDiscountPercent: plan.cafe,
    };
    const result = await client.query(
      `INSERT INTO membership_plans (code,name,description,monthly_price,benefits)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (code) DO UPDATE SET
         name=EXCLUDED.name, description=EXCLUDED.description,
         monthly_price=EXCLUDED.monthly_price, benefits=EXCLUDED.benefits,
         is_active=true, updated_at=now()
       RETURNING id`,
      [plan.code, plan.name, plan.description, plan.price, JSON.stringify(benefits)],
    );
    planIds.set(plan.code, String(result.rows[0].id));
  }

  const members: Array<{ id: string; memberNumber: string; name: string; phone: string; email: string; plan: string; expiry: string; balance: number }> = [];
  const normalizedMemberIds: string[] = [];
  for (const [index, member] of memberSpecs.entries()) {
    const memberNumber = `PROTO-M-${String(index + 1).padStart(3, "0")}`;
    const accountId = index === 0 ? accountIds.get("member") : null;
    const result = await client.query(
      `INSERT INTO members
         (account_id,member_number,full_name,phone,email,date_of_birth,status)
       VALUES ($1,$2,$3,$4,$5,$6,'active')
       ON CONFLICT (member_number) DO UPDATE SET
         account_id=COALESCE(EXCLUDED.account_id,members.account_id),
         full_name=EXCLUDED.full_name, phone=EXCLUDED.phone, email=EXCLUDED.email,
         date_of_birth=EXCLUDED.date_of_birth, status='active', updated_at=now()
       RETURNING id`,
      [accountId, memberNumber, member.name, member.phone, member.email, member.birth],
    );
    const memberId = String(result.rows[0].id);
    normalizedMemberIds.push(memberId);
    const planId = planIds.get(member.plan);
    if (!planId) throw new Error(`Prototype plan '${member.plan}' was not created`);
    const startsAt = localDate(-30);
    const expiresAt = localDate(member.expiresIn);
    await client.query(
      `INSERT INTO membership_records (member_id,plan_id,starts_at,expires_at,status)
       VALUES ($1,$2,$3,$4,'active')
       ON CONFLICT (member_id) WHERE status='active' DO UPDATE SET
         plan_id=EXCLUDED.plan_id, starts_at=EXCLUDED.starts_at, expires_at=EXCLUDED.expires_at`,
      [memberId, planId, startsAt, expiresAt],
    );
    await client.query(
      `INSERT INTO membership_history (member_id,action,to_plan_id,note)
       SELECT $1,'registered',$2,'Prototype seed registration'
       WHERE NOT EXISTS (
         SELECT 1 FROM membership_history WHERE member_id=$1 AND note='Prototype seed registration'
       )`,
      [memberId, planId],
    );
    members.push({
      id: `PROTO-M-${String(index + 1).padStart(3, "0")}`,
      memberNumber,
      name: member.name,
      phone: member.phone,
      email: member.email,
      plan: planSpecs.find((entry) => entry.code === member.plan)!.name,
      expiry: dateOnly(expiresAt),
      balance: member.balance,
    });
  }

  const sportRows = await client.query("SELECT id, code FROM sports WHERE code = ANY($1::text[])", [
    [...new Set(courtSpecs.map((court) => court.sport))],
  ]);
  const sportIds = new Map(sportRows.rows.map((row) => [String(row.code), String(row.id)]));
  const courts: PrototypeRow[] = [];
  const courtIds = new Map<string, string>();
  for (const [index, court] of courtSpecs.entries()) {
    const sportId = sportIds.get(court.sport);
    if (!sportId) throw new Error(`Required sport '${court.sport}' is missing`);
    const result = await client.query(
      `INSERT INTO courts (sport_id,code,name,base_hourly_price,is_active)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (code) DO UPDATE SET
         sport_id=EXCLUDED.sport_id, name=EXCLUDED.name,
         base_hourly_price=EXCLUDED.base_hourly_price, is_active=EXCLUDED.is_active
       RETURNING id`,
      [sportId, court.code, court.name, court.price, court.status === "Available"],
    );
    const id = String(result.rows[0].id);
    courtIds.set(court.code, id);
    courts.push({
      id: `PROTO-C-${String(index + 1).padStart(3, "0")}`,
      name: court.name,
      sport: court.sport[0] + court.sport.slice(1).toLowerCase(),
      price: court.price,
      status: court.status,
    });
    for (let weekday = 0; weekday < 7; weekday++) {
      await client.query(
        `INSERT INTO court_schedule_rules (court_id,weekday,opens_at,closes_at,social_play)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (court_id,weekday) DO UPDATE SET
           opens_at=EXCLUDED.opens_at, closes_at=EXCLUDED.closes_at,
           social_play=EXCLUDED.social_play`,
        [id, weekday, weekday === 0 ? "08:00" : "07:00", weekday === 0 ? "22:00" : "23:00", weekday === 6],
      );
    }
  }

  const normalizedBookings = [
    { court: "PROTO-TENNIS-1", member: 0, days: 0, hour: 18, status: "confirmed", type: "individual" },
    { court: "PROTO-TENNIS-1", member: 1, days: 1, hour: 19, status: "confirmed", type: "individual" },
    { court: "PROTO-PADEL-1", member: 2, days: 1, hour: 17, status: "confirmed", type: "social" },
    { court: "PROTO-BADMINTON-1", member: 3, days: 2, hour: 16, status: "confirmed", type: "walk_in" },
    { court: "PROTO-CRICKET-1", member: 4, days: 2, hour: 18, status: "cancelled", type: "individual" },
  ];
  const sharedBookings: PrototypeRow[] = [];
  for (const [index, booking] of normalizedBookings.entries()) {
    const courtId = courtIds.get(booking.court);
    if (!courtId) throw new Error(`Required prototype court '${booking.court}' is missing`);
    const start = localDate(booking.days, booking.hour);
    const result = await client.query(
      `INSERT INTO court_reservations
         (court_id,member_id,participant_name,starts_at,ends_at,status,booking_type,
          idempotency_key,base_amount,discount_amount,final_amount)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
       RETURNING id,starts_at,status`,
      [
        courtId, normalizedMemberIds[booking.member],
        memberSpecs[booking.member].name, start, new Date(start.getTime() + 60 * 60 * 1000),
        booking.status, booking.type, `PROTO-BOOKING-${String(index + 1).padStart(3, "0")}`,
        courtSpecs.find((entry) => entry.code === booking.court)!.price, 0,
        courtSpecs.find((entry) => entry.code === booking.court)!.price,
      ],
    );
    const stored = result.rowCount
      ? result.rows[0]
      : (await client.query(
        "SELECT id,starts_at,status FROM court_reservations WHERE idempotency_key=$1",
        [`PROTO-BOOKING-${String(index + 1).padStart(3, "0")}`],
      )).rows[0];
    if (!stored) throw new Error("Prototype reservation could not be loaded");
    const storedStart = new Date(stored.starts_at);
    sharedBookings.push({
      id: `PROTO-B-${String(index + 1).padStart(3, "0")}`,
      courtId: `PROTO-C-${String(courtSpecs.findIndex((entry) => entry.code === booking.court) + 1).padStart(3, "0")}`,
      court: courtSpecs.find((entry) => entry.code === booking.court)!.name,
      memberId: members[booking.member].id,
      participantName: memberSpecs[booking.member].name,
      date: dateOnly(storedStart),
      time: timeOnly(storedStart),
      durationMinutes: 60,
      status: String(stored.status).replace(/^./, (letter: string) => letter.toUpperCase()),
      amount: courtSpecs.find((entry) => entry.code === booking.court)!.price,
    });
    if (booking.type === "social" && result.rowCount) {
      const participantName = "Prototype Guest";
      await client.query(
        `INSERT INTO reservation_participants (reservation_id,participant_name)
         SELECT $1,$2 WHERE NOT EXISTS (
           SELECT 1 FROM reservation_participants WHERE reservation_id=$1 AND participant_name=$2
         )`,
        [stored.id, participantName],
      );
    }
    if (String(stored.status) !== "cancelled") {
      await client.query(
        `INSERT INTO receipt_records (receipt_number,source_type,source_id,amount,method)
         VALUES ($1,'court',$2,$3,'online') ON CONFLICT (receipt_number) DO NOTHING`,
        [`PROTO-COURT-RECEIPT-${String(index + 1).padStart(3, "0")}`, stored.id, courtSpecs.find((entry) => entry.code === booking.court)!.price],
      );
    }
  }

  const products: PrototypeRow[] = [];
  const productIds = new Map<string, string>();
  for (const [index, product] of productSpecs.entries()) {
    const result = await client.query(
      `INSERT INTO shop_products (sku,name,description,category,price,stock_quantity,low_stock_threshold)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (sku) DO UPDATE SET
         name=EXCLUDED.name, description=EXCLUDED.description, category=EXCLUDED.category,
         price=EXCLUDED.price, stock_quantity=EXCLUDED.stock_quantity,
         low_stock_threshold=EXCLUDED.low_stock_threshold, is_active=true, updated_at=now()
       RETURNING id`,
      [product.sku, product.name, product.description, product.category, product.price, product.stock, product.threshold],
    );
    const id = String(result.rows[0].id);
    productIds.set(product.sku, id);
    products.push({
      id: `PROTO-P-${String(index + 1).padStart(3, "0")}`,
      name: product.name,
      category: product.category,
      price: product.price,
      stock: product.stock,
      threshold: product.threshold,
    });
    await client.query(
      `INSERT INTO stock_movements (product_id,movement_type,quantity_change,reference_type,reference_id,note)
       SELECT $1,'purchase',$2,'prototype_opening_stock',$3,'Prototype sample opening stock'
       WHERE NOT EXISTS (
         SELECT 1 FROM stock_movements
         WHERE product_id=$1 AND reference_type='prototype_opening_stock' AND reference_id=$3
       )`,
      [id, Math.max(product.stock, 1), product.sku],
    );
  }

  const shopOrderSpecs = [
    { number: "PROTO-SHOP-001", member: 0, status: "confirmed", product: "PROTO-RACKET-01", quantity: 1, channel: "online", fulfillment: "delivery", total: 4200 },
    { number: "PROTO-SHOP-002", member: 1, status: "fulfilled", product: "PROTO-BALL-01", quantity: 2, channel: "counter", fulfillment: "pickup", total: 900 },
    { number: "PROTO-SHOP-003", member: 2, status: "pending", product: "PROTO-GRIP-01", quantity: 1, channel: "online", fulfillment: "pickup", total: 300 },
  ];
  const shopOrders: PrototypeRow[] = [];
  for (const order of shopOrderSpecs) {
    const productId = productIds.get(order.product);
    if (!productId) throw new Error(`Prototype product '${order.product}' is missing`);
    const result = await client.query(
      `INSERT INTO shop_orders
         (order_number,member_id,channel,fulfillment,status,subtotal,total_amount)
       VALUES ($1,(SELECT id FROM members WHERE member_number=$2),$3,$4,$5,$6,$6)
       ON CONFLICT (order_number) DO UPDATE SET
         status=EXCLUDED.status, subtotal=EXCLUDED.subtotal, total_amount=EXCLUDED.total_amount,
         updated_at=now()
       RETURNING id,member_id,created_at`,
      [order.number, members[order.member].memberNumber, order.channel, order.fulfillment, order.status, order.total],
    );
    const orderId = String(result.rows[0].id);
    await client.query(
      `INSERT INTO shop_order_items (order_id,product_id,quantity,unit_price,line_total)
       SELECT $1,$2,$3,$4,$5 WHERE NOT EXISTS (
         SELECT 1 FROM shop_order_items WHERE order_id=$1 AND product_id=$2
       )`,
      [orderId, productId, order.quantity, productSpecs.find((entry) => entry.sku === order.product)!.price, order.total],
    );
    if (order.status !== "cancelled") {
      await client.query(
        `INSERT INTO shop_payments (order_id,amount,method,status,idempotency_key)
         VALUES ($1,$2,'upi','recorded',$3)
         ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
        [orderId, order.total, `${order.number}:payment`],
      );
    }
    shopOrders.push({
      id: `PROTO-${order.number}`,
      memberId: members[order.member].id,
      channel: order.channel,
      fulfillment: order.fulfillment,
      status: order.status,
      total: order.total,
      date: dateOnly(new Date(result.rows[0].created_at)),
      orderNumber: order.number,
    });
  }

  const menuItems: Array<{ id: string; name: string; category: string; price: number }> = [];
  for (const menu of menuSpecs) {
    let result = await client.query(
      "SELECT id FROM cafeteria_menu_items WHERE name=$1 AND category=$2 AND price=$3 ORDER BY created_at LIMIT 1",
      [menu.name, menu.category, menu.price],
    );
    if (!result.rowCount) {
      result = await client.query(
        "INSERT INTO cafeteria_menu_items (name,category,price) VALUES ($1,$2,$3) RETURNING id",
        [menu.name, menu.category, menu.price],
      );
    }
    menuItems.push({ id: String(result.rows[0].id), ...menu });
  }

  const tableSpecs = [
    { number: "P-T1", seats: 4, status: "occupied" },
    { number: "P-T2", seats: 4, status: "reserved" },
    { number: "P-T3", seats: 6, status: "available" },
    { number: "P-T4", seats: 2, status: "available" },
  ];
  const tables: PrototypeRow[] = [];
  const tableIds = new Map<string, string>();
  for (const [index, table] of tableSpecs.entries()) {
    const result = await client.query(
      `INSERT INTO cafeteria_tables (table_number,seats,status)
       VALUES ($1,$2,$3)
       ON CONFLICT (table_number) DO UPDATE SET seats=EXCLUDED.seats,status=EXCLUDED.status
       RETURNING id`,
      [table.number, table.seats, table.status],
    );
    const id = String(result.rows[0].id);
    tableIds.set(table.number, id);
    tables.push({ id: `PROTO-TABLE-${index + 1}`, tableNumber: table.number, seats: table.seats, status: table.status });
  }

  const openTabResult = await client.query(
    `SELECT id FROM customer_tabs
     WHERE member_id=(SELECT id FROM members WHERE member_number='PROTO-M-001')
       AND table_id=$1 AND status='open'
     ORDER BY opened_at LIMIT 1`,
    [tableIds.get("P-T1")],
  );
  const openTabId = openTabResult.rowCount
    ? String(openTabResult.rows[0].id)
    : String((await client.query(
      `INSERT INTO customer_tabs (member_id,table_id)
       VALUES ((SELECT id FROM members WHERE member_number='PROTO-M-001'),$1)
       RETURNING id`,
      [tableIds.get("P-T1")],
    )).rows[0].id);
  const settledTabResult = await client.query(
    `SELECT id FROM customer_tabs
     WHERE guest_name='Prototype Guest' AND table_id=$1 AND status='settled'
     ORDER BY opened_at LIMIT 1`,
    [tableIds.get("P-T2")],
  );
  const settledTabId = settledTabResult.rowCount
    ? String(settledTabResult.rows[0].id)
    : String((await client.query(
      `INSERT INTO customer_tabs (guest_name,table_id,status,settled_at)
       VALUES ('Prototype Guest',$1,'settled',now())
       RETURNING id`,
      [tableIds.get("P-T2")],
    )).rows[0].id);

  const cafeteriaOrderSpecs = [
    { number: "PROTO-BAR-001", tab: openTabId, table: "P-T1", member: 0, guest: null, status: "preparing", menu: 1, quantity: 1, total: 280 },
    { number: "PROTO-BAR-002", tab: settledTabId, table: "P-T2", member: null, guest: "Prototype Guest", status: "served", menu: 0, quantity: 2, total: 240 },
  ];
  const kitchen: PrototypeRow[] = [];
  for (const [index, order] of cafeteriaOrderSpecs.entries()) {
    const menuItem = menuItems[order.menu];
    const result = await client.query(
      `INSERT INTO cafeteria_orders
         (order_number,tab_id,table_id,member_id,guest_name,status,subtotal,total_amount,notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8)
       ON CONFLICT (order_number) DO UPDATE SET
         status=EXCLUDED.status,subtotal=EXCLUDED.subtotal,total_amount=EXCLUDED.total_amount,
         notes=EXCLUDED.notes,updated_at=now()
       RETURNING id,created_at`,
      [
        order.number, order.tab, tableIds.get(order.table),
        order.member === null ? null : normalizedMemberIds[order.member],
        order.guest, order.status, order.total, "Prototype sample kitchen order",
      ],
    );
    const orderId = String(result.rows[0].id);
    await client.query(
      `INSERT INTO cafeteria_order_items (order_id,menu_item_id,quantity,unit_price,line_total)
       SELECT $1,$2,$3,$4,$5 WHERE NOT EXISTS (
         SELECT 1 FROM cafeteria_order_items WHERE order_id=$1 AND menu_item_id=$2
       )`,
      [orderId, menuItem.id, order.quantity, menuItem.price, order.total],
    );
    kitchen.push({
      id: `PROTO-KITCHEN-${index + 1}`,
      orderNumber: order.number,
      table: order.table,
      items: `${order.quantity} × ${menuItem.name}`,
      status: order.status,
      createdAt: dateOnly(new Date(result.rows[0].created_at)),
    });
  }
  await client.query(
    `INSERT INTO cafeteria_payments (tab_id,amount,method,status,idempotency_key)
     VALUES ($1,240,'upi','recorded','PROTO-BAR-PAYMENT-002')
     ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
    [settledTabId],
  );

  const staffSpecs = [
    { employee: "PROTO-EMP-001", name: "Prototype Manager", department: "Operations", role: "Manager", account: "manager", salary: 52000 },
    { employee: "PROTO-EMP-002", name: "Prototype Front Desk", department: "Front Desk", role: "Front desk", account: "front_desk", salary: 32000 },
    { employee: "PROTO-EMP-003", name: "Prototype Staff", department: "Facilities", role: "Court attendant", account: "staff", salary: 28000 },
    { employee: "PROTO-EMP-004", name: "Nisha Rao", department: "Cafeteria", role: "Cafeteria team", account: null, salary: 30000 },
  ];
  const staffRows: PrototypeRow[] = [];
  const staffIds = new Map<string, string>();
  for (const [index, staff] of staffSpecs.entries()) {
    const result = await client.query(
      `INSERT INTO staff_profiles (account_id,employee_number,full_name,department,base_salary,status)
       VALUES ($1,$2,$3,$4,$5,'active')
       ON CONFLICT (employee_number) DO UPDATE SET
         account_id=COALESCE(EXCLUDED.account_id,staff_profiles.account_id),
         full_name=EXCLUDED.full_name,department=EXCLUDED.department,
         base_salary=EXCLUDED.base_salary,status='active'
       RETURNING id`,
      [staff.account ? accountIds.get(staff.account) : null, staff.employee, staff.name, staff.department, staff.salary],
    );
    const id = String(result.rows[0].id);
    staffIds.set(staff.employee, id);
    const shiftStart = localDate(1 + index, 8 + (index % 3));
    const shiftEnd = new Date(shiftStart.getTime() + 8 * 60 * 60 * 1000);
    await client.query(
      `INSERT INTO staff_shifts (staff_id,starts_at,ends_at,role,status,break_minutes)
       SELECT $1,$2,$3,$4,'scheduled',30
       WHERE NOT EXISTS (SELECT 1 FROM staff_shifts WHERE staff_id=$1 AND starts_at=$2)`,
      [id, shiftStart, shiftEnd, staff.role],
    );
    await client.query(
      `INSERT INTO payroll_records (staff_id,period_start,period_end,gross_amount,deductions,net_amount,status)
       SELECT $1,date_trunc('month',CURRENT_DATE)::date,
              (date_trunc('month',CURRENT_DATE)+interval '1 month'-interval '1 day')::date,
              $2::numeric,$3::numeric,$2::numeric-$3::numeric,'estimated'
       WHERE NOT EXISTS (
         SELECT 1 FROM payroll_records
         WHERE staff_id=$1 AND period_start=date_trunc('month',CURRENT_DATE)::date
       )`,
      [id, staff.salary, Math.round(staff.salary * 0.08)],
    );
    staffRows.push({
      id: `PROTO-STAFF-${index + 1}`,
      name: staff.name,
      role: staff.role,
      department: staff.department,
      shift: `${timeOnly(shiftStart)}–${timeOnly(shiftEnd)}`,
      salary: staff.salary,
      status: "Active",
    });
  }

  const leaveSpecs = [
    { employee: "PROTO-EMP-004", days: 14, reason: "Prototype personal leave", status: "pending" },
    { employee: "PROTO-EMP-003", days: 30, reason: "Prototype training leave", status: "approved" },
  ];
  const leaveRows: PrototypeRow[] = [];
  for (const [index, leave] of leaveSpecs.entries()) {
    const staffId = staffIds.get(leave.employee);
    if (!staffId) throw new Error(`Prototype employee '${leave.employee}' is missing`);
    const start = localDate(leave.days);
    const end = localDate(leave.days + 1);
    let result = await client.query(
      "SELECT id,starts_at,ends_at,status FROM leave_requests WHERE staff_id=$1 AND reason=$2 ORDER BY starts_at LIMIT 1",
      [staffId, leave.reason],
    );
    if (!result.rowCount) {
      result = await client.query(
        `INSERT INTO leave_requests (staff_id,starts_at,ends_at,reason,status)
         VALUES ($1,$2::date,$3::date,$4,$5) RETURNING id,starts_at,ends_at,status`,
        [staffId, dateOnly(start), dateOnly(end), leave.reason, leave.status],
      );
    }
    leaveRows.push({
      id: `PROTO-LEAVE-${index + 1}`,
      name: staffSpecs.find((staff) => staff.employee === leave.employee)!.name,
      dates: `${dateOnly(new Date(result.rows[0].starts_at))} – ${dateOnly(new Date(result.rows[0].ends_at))}`,
      reason: leave.reason,
      status: String(result.rows[0].status).replace(/^./, (letter: string) => letter.toUpperCase()),
    });
  }

  const enquirySpecs = [
    { name: "Sam Taylor", phone: "9990002001", email: "sam@example.test", interest: "Tennis trial", source: "website", status: "new" },
    { name: "Priya Das", phone: "9990002002", email: "priya@example.test", interest: "Family membership", source: "referral", status: "follow_up" },
    { name: "Arjun Bose", phone: "9990002003", email: "arjun@example.test", interest: "Padel coaching", source: "social", status: "quoted" },
    { name: "Leah George", phone: "9990002004", email: "leah@example.test", interest: "Corporate court package", source: "phone", status: "converted" },
    { name: "Neil Roy", phone: "9990002005", email: "neil@example.test", interest: "Badminton trial", source: "website", status: "new" },
  ];
  const enquiries: PrototypeRow[] = [];
  const enquiryIds = new Map<string, string>();
  for (const [index, enquiry] of enquirySpecs.entries()) {
    let result = await client.query(
      "SELECT id FROM enquiries WHERE email=$1 ORDER BY created_at LIMIT 1",
      [enquiry.email],
    );
    if (!result.rowCount) {
      result = await client.query(
        `INSERT INTO enquiries (name,phone,email,interest,source,status)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [enquiry.name, enquiry.phone, enquiry.email, enquiry.interest, enquiry.source, enquiry.status],
      );
    } else {
      await client.query("UPDATE enquiries SET status=$2 WHERE id=$1", [result.rows[0].id, enquiry.status]);
    }
    const id = String(result.rows[0].id);
    enquiryIds.set(enquiry.email, id);
    enquiries.push({
      id: `PROTO-ENQUIRY-${index + 1}`,
      name: enquiry.name,
      phone: enquiry.phone,
      email: enquiry.email,
      interest: enquiry.interest,
      source: enquiry.source,
      status: enquiry.status.replace(/^./, (letter) => letter.toUpperCase()),
      followUp: dateOnly(localDate(index + 2)),
    });
  }
  const followupEnquiryId = enquiryIds.get("priya@example.test");
  if (followupEnquiryId) {
    await client.query(
      `INSERT INTO enquiry_followups (enquiry_id,note,follow_up_at,created_by)
       SELECT $1,'Prototype follow-up call scheduled',now()+interval '2 days',$2
       WHERE NOT EXISTS (
         SELECT 1 FROM enquiry_followups WHERE enquiry_id=$1 AND note='Prototype follow-up call scheduled'
       )`,
      [followupEnquiryId, accountIds.get("front_desk")],
    );
  }
  const quotationEnquiryId = enquiryIds.get("arjun@example.test");
  await client.query(
    `INSERT INTO quotations (quotation_number,enquiry_id,subtotal,tax_amount,total_amount,status,valid_until)
     VALUES ('PROTO-QT-001',$1,5000,250,5250,'sent',CURRENT_DATE+14)
     ON CONFLICT (quotation_number) DO UPDATE SET
       enquiry_id=EXCLUDED.enquiry_id,subtotal=EXCLUDED.subtotal,
       tax_amount=EXCLUDED.tax_amount,total_amount=EXCLUDED.total_amount,status=EXCLUDED.status`,
    [quotationEnquiryId ?? null],
  );

  const expenseSpecs = [
    { category: "Maintenance", description: "Prototype court surface maintenance", amount: 4500, vendor: "Sample Facilities Co." },
    { category: "Utilities", description: "Prototype electricity bill", amount: 12000, vendor: "Sample Utility Co." },
    { category: "Equipment", description: "Prototype training equipment", amount: 7800, vendor: "Sample Sports Supply" },
    { category: "Cleaning", description: "Prototype cleaning supplies", amount: 1850, vendor: "Sample Facility Store" },
  ];
  const expenses: PrototypeRow[] = [];
  for (const [index, expense] of expenseSpecs.entries()) {
    await client.query(
      `INSERT INTO expenses (category,description,amount,expense_date,vendor,status,created_by)
       SELECT $1,$2,$3,$4::date,$5,'recorded',$6
       WHERE NOT EXISTS (SELECT 1 FROM expenses WHERE description=$2)`,
      [expense.category, expense.description, expense.amount, dateOnly(localDate(-index)), expense.vendor, accountIds.get("manager")],
    );
    expenses.push({
      id: `PROTO-EXPENSE-${index + 1}`,
      category: expense.category,
      description: expense.description,
      amount: expense.amount,
      date: dateOnly(localDate(-index)),
      vendor: expense.vendor,
      status: "Recorded",
    });
  }

  await client.query(
    `INSERT INTO tax_rates (code,name,rate_percent,applies_from,is_active)
     VALUES ('PROTO-SAMPLE','Prototype-only sample tax rate',5,CURRENT_DATE,true)
     ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name,rate_percent=EXCLUDED.rate_percent,
       applies_from=EXCLUDED.applies_from,is_active=true`,
  );

  const invoiceSpecs = [
    { number: "PROTO-INV-001", business: "Northstar Sports (sample)", email: "accounts@northstar.example.test", subtotal: 50000, tax: 2500, paid: 25000, daysDue: 10, status: "partially_paid" },
    { number: "PROTO-INV-002", business: "Rally Events (sample)", email: "finance@rally.example.test", subtotal: 18000, tax: 900, paid: 0, daysDue: -4, status: "overdue" },
    { number: "PROTO-INV-003", business: "CourtSide Academy (sample)", email: "office@courtside.example.test", subtotal: 12000, tax: 600, paid: 12600, daysDue: 20, status: "paid" },
  ];
  const invoices: PrototypeRow[] = [];
  for (const [index, invoice] of invoiceSpecs.entries()) {
    const result = await client.query(
      `INSERT INTO invoices
         (invoice_number,business_name,billing_email,subtotal,tax_amount,total_amount,paid_amount,status,issued_at,due_at,tax_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,CURRENT_DATE-$9::int,CURRENT_DATE+$10::int,'PROTO-SAMPLE')
       ON CONFLICT (invoice_number) DO UPDATE SET
         business_name=EXCLUDED.business_name,billing_email=EXCLUDED.billing_email,
         subtotal=EXCLUDED.subtotal,tax_amount=EXCLUDED.tax_amount,total_amount=EXCLUDED.total_amount,
         paid_amount=EXCLUDED.paid_amount,status=EXCLUDED.status,due_at=EXCLUDED.due_at,
         tax_code=EXCLUDED.tax_code
       RETURNING id,invoice_number,business_name,total_amount,paid_amount,due_at,status`,
      [invoice.number, invoice.business, invoice.email, invoice.subtotal, invoice.tax,
        invoice.subtotal + invoice.tax, invoice.paid, invoice.status, index + 3, invoice.daysDue],
    );
    const invoiceId = String(result.rows[0].id);
    await client.query(
      `INSERT INTO invoice_items (invoice_id,description,quantity,unit_price,line_total)
       SELECT $1,'Prototype facility booking package',1,$2,$2
       WHERE NOT EXISTS (
         SELECT 1 FROM invoice_items WHERE invoice_id=$1 AND description='Prototype facility booking package'
       )`,
      [invoiceId, invoice.subtotal],
    );
    if (invoice.paid > 0) {
      await client.query(
        `INSERT INTO invoice_payments (invoice_id,amount,method,reference)
         SELECT $1,$2,'upi',$3
         WHERE NOT EXISTS (SELECT 1 FROM invoice_payments WHERE invoice_id=$1 AND reference=$3)`,
        [invoiceId, invoice.paid, `${invoice.number}-PAYMENT`],
      );
    }
    invoices.push({
      id: `PROTO-INVOICE-${index + 1}`,
      invoiceNumber: invoice.number,
      customer: invoice.business,
      amount: invoice.subtotal + invoice.tax,
      paid: invoice.paid,
      due: dateOnly(localDate(invoice.daysDue)),
      status: invoice.status.replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase()),
    });
  }

  const ledgerAccounts = await client.query("SELECT id,code FROM ledger_accounts WHERE code = ANY($1::text[])", [
    ["1000", "4000", "4100", "4200", "5000"],
  ]);
  const ledgerIds = new Map(ledgerAccounts.rows.map((row) => [String(row.code), String(row.id)]));
  const ledgerSpecs = [
    { id: "PROTO-JOURNAL-001", debit: "1000", credit: "4000", amount: 1200, text: "Prototype court booking revenue" },
    { id: "PROTO-JOURNAL-002", debit: "1000", credit: "4100", amount: 900, text: "Prototype shop sales" },
    { id: "PROTO-JOURNAL-003", debit: "1000", credit: "4200", amount: 240, text: "Prototype cafeteria payment" },
    { id: "PROTO-JOURNAL-004", debit: "5000", credit: "1000", amount: 4500, text: "Prototype maintenance expense" },
  ];
  for (const entry of ledgerSpecs) {
    const debitId = ledgerIds.get(entry.debit);
    const creditId = ledgerIds.get(entry.credit);
    if (!debitId || !creditId) throw new Error("Required prototype ledger accounts are missing");
    await client.query(
      `INSERT INTO ledger_entries (journal_id,account_id,debit,credit,reference_type,reference_id,description)
       SELECT $1,$2,$3,0,'prototype',$4,$5
       WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE journal_id=$1 AND account_id=$2)`,
      [stableUuid(entry.id), debitId, entry.amount, entry.id, entry.text],
    );
    await client.query(
      `INSERT INTO ledger_entries (journal_id,account_id,debit,credit,reference_type,reference_id,description)
       SELECT $1,$2,0,$3,'prototype',$4,$5
       WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE journal_id=$1 AND account_id=$2)`,
      [stableUuid(entry.id), creditId, entry.amount, entry.id, entry.text],
    );
  }

  for (const [index, member] of members.entries()) {
    const preferred = index % 2 === 0 ? ["TENNIS", "PADEL"] : ["BADMINTON", "TENNIS"];
    await client.query(
      `INSERT INTO player_profiles (member_id,skill_level,preferred_sports,availability)
       VALUES ((SELECT id FROM members WHERE member_number=$1),$2,$3,$4)
       ON CONFLICT (member_id) DO UPDATE SET
         skill_level=EXCLUDED.skill_level,preferred_sports=EXCLUDED.preferred_sports,
         availability=EXCLUDED.availability,updated_at=now()`,
      [member.memberNumber, 2 + (index % 4), preferred, JSON.stringify({ weekdayEvenings: true, weekends: index % 2 === 0 })],
    );
  }
  const matchRequest = await client.query(
    `SELECT id FROM matchmaking_requests
     WHERE requester_member_id=(SELECT id FROM members WHERE member_number='PROTO-M-001')
       AND sport_code='TENNIS' AND status='open'
     ORDER BY created_at LIMIT 1`,
  );
  const matchRequestId = matchRequest.rowCount
    ? String(matchRequest.rows[0].id)
    : String((await client.query(
      `INSERT INTO matchmaking_requests
         (requester_member_id,sport_code,preferred_starts_at,skill_floor,skill_ceiling)
       VALUES ((SELECT id FROM members WHERE member_number='PROTO-M-001'),'TENNIS',$1,2,5)
       RETURNING id`,
      [localDate(2, 18)],
    )).rows[0].id);
  for (const candidate of members.slice(1, 5)) {
    const candidateId = (await client.query("SELECT id FROM members WHERE member_number=$1", [candidate.memberNumber])).rows[0].id;
    await client.query(
      `INSERT INTO matchmaking_recommendations (request_id,member_id,compatibility_score,explanation)
       SELECT $1,$2,$3,$4 WHERE NOT EXISTS (
         SELECT 1 FROM matchmaking_recommendations WHERE request_id=$1 AND member_id=$2
       )`,
      [matchRequestId, candidateId, 70 + members.indexOf(candidate) * 5,
        JSON.stringify({ prototype: true, sharedSport: "TENNIS", skillRange: "2-5" })],
    );
  }

  const notificationSpecs = [
    { recipientType: "member", recipientId: normalizedMemberIds[0], channel: "in_app", event: "prototype_booking", subject: "Booking confirmed", body: "Your sample court reservation is confirmed.", status: "sent" },
    { recipientType: "staff", recipientId: accountIds.get("manager")!, channel: "in_app", event: "prototype_low_stock", subject: "Low stock: Court Training Shoes", body: "Prototype stock has reached the configured threshold.", status: "pending" },
    { recipientType: "member", recipientId: normalizedMemberIds[0], channel: "email", event: "prototype_membership_expiry", subject: "Membership reminder preview", body: "This is a prototype reminder preview; external delivery is not configured.", status: "pending" },
  ];
  const notifications: PrototypeRow[] = [];
  for (const [index, notification] of notificationSpecs.entries()) {
    await client.query(
      `INSERT INTO notification_outbox
         (recipient_type,recipient_id,channel,event_type,subject,body,status,provider,sent_at)
       SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9
       WHERE NOT EXISTS (
         SELECT 1 FROM notification_outbox
         WHERE event_type=$4 AND recipient_id=$2 AND subject=$5
       )`,
      [
        notification.recipientType, notification.recipientId, notification.channel,
        notification.event, notification.subject, notification.body, notification.status,
        notification.status === "sent" ? "in_app" : null,
        notification.status === "sent" ? new Date() : null,
      ],
    );
    notifications.push({
      id: `PROTO-NOTIFICATION-${index + 1}`,
      title: notification.subject,
      body: notification.body,
      type: notification.event,
      status: notification.status.replace(/^./, (letter) => letter.toUpperCase()),
      createdAt: dateOnly(new Date()),
    });
  }

  const transactionRows: PrototypeRow[] = [
    { id: "PROTO-TXN-001", date: dateOnly(localDate(-1)), customer: "Aarav Mehta", amount: 1200, type: "Court booking", status: "Paid" },
    { id: "PROTO-TXN-002", date: dateOnly(localDate(-1)), customer: "Mira Shah", amount: 900, type: "Shop order", status: "Paid" },
    { id: "PROTO-TXN-003", date: dateOnly(localDate(-2)), customer: "Prototype Guest", amount: 240, type: "Cafeteria", status: "Paid" },
    { id: "PROTO-TXN-004", date: dateOnly(localDate(-3)), customer: "Aarav Mehta", amount: 2500, type: "Membership", status: "Paid" },
    { id: "PROTO-TXN-005", date: dateOnly(localDate(-4)), customer: "Riya Nair", amount: 1500, type: "Court booking", status: "Paid" },
  ];

  const sharedState: Record<SharedModule, PrototypeRow[]> = {
    ...emptyState,
    members: members.map((member) => ({
      id: member.id, memberNumber: member.memberNumber, name: member.name,
      plan: member.plan, email: member.email, phone: member.phone,
      expiry: member.expiry, balance: member.balance, status: "Active",
    })),
    plans: planSpecs.map((plan, index) => ({
      id: `PROTO-PLAN-${index + 1}`, code: plan.code, name: plan.name,
      price: plan.price, monthlyPrice: plan.price, description: plan.description,
      courtDiscount: plan.court, shopDiscount: plan.shop, barDiscount: plan.cafe,
      freeSessions: plan.sessions, status: "Active",
    })),
    courts,
    bookings: sharedBookings,
    products,
    orders: shopOrders,
    menu: menuItems.map((menu, index) => ({
      id: `PROTO-MENU-${index + 1}`, name: menu.name, category: menu.category,
      price: menu.price, available: true, status: "Available",
    })),
    tables,
    tabs: [
      { id: "PROTO-TAB-001", member: members[0].name, table: "P-T1", status: "Open", balance: 280 },
      { id: "PROTO-TAB-002", member: "Prototype Guest", table: "P-T2", status: "Settled", balance: 0 },
    ],
    kitchen,
    enquiries,
    staff: staffRows,
    leave: leaveRows,
    transactions: transactionRows,
    expenses,
    invoices,
    notifications,
  };

  const currentState = await client.query(
    "SELECT state FROM shared_demo_state WHERE singleton_key=1 FOR UPDATE",
  );
  const existing = (currentState.rows[0]?.state ?? {}) as Record<string, unknown>;
  const mergedState = Object.fromEntries(
    moduleKeys.map((key) => [key, mergePrototypeRows(existing[key], sharedState[key])]),
  );
  const updatedState = await client.query(
    `INSERT INTO shared_demo_state (singleton_key,state,version,updated_by)
     VALUES (1,$1::jsonb,1,'prototype-seed')
     ON CONFLICT (singleton_key) DO UPDATE SET
       state=EXCLUDED.state,version=shared_demo_state.version+1,
       updated_at=now(),updated_by='prototype-seed'
     RETURNING version`,
    [JSON.stringify(mergedState)],
  );
  await client.query("SELECT pg_notify('playpulse_demo_data',$1)", [String(updatedState.rows[0].version)]);
  await client.query("COMMIT");

  console.log("Prototype data seeded into the local PlayPlus database.");
  console.log("Synthetic records: 8 members, 3 plans, 4 courts, 5 bookings, 6 products,");
  console.log("3 shop orders, 5 menu items, 4 tables, 2 cafeteria tabs, 5 enquiries,");
  console.log("4 staff profiles, 2 leave requests, 5 transactions, 4 expenses, 3 invoices.");
  console.log(`Prototype-only password for all listed accounts: ${prototypePassword}`);
  console.log("Accounts: admin@champions.club, manager@champions.club, desk@champions.club,");
  console.log("staff@champions.club, member@champions.club");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool!.end();
}
