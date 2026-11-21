export type DemoRole = "admin" | "member" | "visitor" | "manager" | "staff" | "front_desk";

export type DemoSession = {
  role: DemoRole;
  name: string;
  email: string;
};

export type DemoRow = Record<string, string | number | boolean | null | undefined>;

export type ModuleKey = "members" | "plans" | "courts" | "bookings" | "products" | "orders" |
  "menu" | "tables" | "tabs" | "kitchen" | "enquiries" | "staff" | "leave" |
  "transactions" | "expenses" | "invoices" | "notifications";
export type DemoState = Record<ModuleKey, DemoRow[]>;

export type PublicState = {
  version: number;
  courts: Array<{ id: string; name: string; sport: string; price: number; status: string }>;
  plans: Array<{
    name: string;
    price: number;
    courtDiscount: number;
    shopDiscount: number;
    barDiscount: number;
    freeSessions: number;
  }>;
  bookings: Array<{ courtId: string; date: string; time: string; durationMinutes?: number; status: string }>;
  products: Array<{ id: string; name: string; category: string; price: number; icon?: string }>;
  member?: {
    id: string;
    name: string;
    plan: string;
    expiry: string;
    phone: string;
    balance: number;
  } | null;
  memberBookings?: Array<{ courtId: string; date: string; time: string; status: string }>;
  memberOrders?: Array<{
    id: string;
    memberId: string | null;
    channel: string;
    fulfillment: string;
    status: string;
    total: number;
    date: string;
  }>;
};

export type SyncStatus = "connecting" | "live" | "error";
