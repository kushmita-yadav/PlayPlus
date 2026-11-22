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
    plan: string | null;
    expiry: string | null;
    phone: string;
    email?: string | null;
    membershipStatus?: string | null;
    balance: number | null;
  } | null;
  memberBookings?: Array<{ courtId: string; courtName?: string; date: string; time: string; status: string }>;
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

export type MemberActivityBooking = {
  id: string;
  courtName: string;
  date: string;
  time: string;
  durationMinutes: number;
  status: string;
  bookingType: string;
  amount: number;
  createdAt: string | null;
};

export type MemberActivityOrder = {
  id: string;
  orderNumber: string;
  channel: string;
  fulfillment: string;
  status: string;
  subtotal: number;
  discountAmount: number;
  totalAmount: number;
  createdAt: string;
  items: Array<{ name: string; quantity: number; lineTotal: number }>;
};

export type MemberActivityPayment = {
  reference: string | null;
  sourceType: string;
  description: string;
  amount: number;
  method: string;
  status: string;
  createdAt: string;
};

export type MemberActivity = {
  bookings: MemberActivityBooking[];
  orders: MemberActivityOrder[];
  payments: MemberActivityPayment[];
};

export type SyncStatus = "connecting" | "live" | "error";

export type RazorpayPaymentResult = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

export type RazorpayCheckoutOptions = {
  key: string;
  amount: number;
  currency: string;
  order_id: string;
  name: string;
  description: string;
  prefill?: { name?: string; email?: string; contact?: string };
  handler: (result: RazorpayPaymentResult) => void;
  modal?: { ondismiss?: () => void };
};

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayCheckoutOptions) => {
      open: () => void;
      on: (event: string, handler: () => void) => void;
    };
  }
}
