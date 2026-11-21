import type { DemoState } from "../types";

const today = new Date();
const date = (offset: number) => {
  const value = new Date(today);
  value.setDate(value.getDate() + offset);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
};

export const initialDemoState: DemoState = {
  members: [
    { id: "M-1001", name: "Aarav Mehta", plan: "Gold", phone: "98765 43210", expiry: date(120), balance: 0 },
    { id: "M-1002", name: "Isha Kapoor", plan: "Silver", phone: "98765 01234", expiry: date(75), balance: 850 },
    { id: "M-1003", name: "Rohan Verma", plan: "Junior", phone: "98765 12345", expiry: date(30), balance: 0 },
  ],
  plans: [
    { code: "GOLD", name: "Gold", price: 5000, courtDiscount: 100, shopDiscount: 15, barDiscount: 15, freeSessions: 2 },
    { code: "SILVER", name: "Silver", price: 3000, courtDiscount: 25, shopDiscount: 10, barDiscount: 10, freeSessions: 0 },
    { code: "JUNIOR", name: "Junior", price: 1500, courtDiscount: 50, shopDiscount: 15, barDiscount: 10, freeSessions: 1 },
  ],
  courts: [
    { id: "C-1", name: "Tennis Court 1", sport: "Tennis", price: 1200, status: "Available" },
    { id: "C-2", name: "Tennis Court 2", sport: "Tennis", price: 1200, status: "Available" },
    { id: "C-3", name: "Padel Court 1", sport: "Padel", price: 1000, status: "Maintenance" },
    { id: "C-4", name: "Badminton Court 1", sport: "Badminton", price: 800, status: "Available" },
  ],
  bookings: [
    { id: "B-301", memberId: "M-1001", courtId: "C-1", court: "Tennis Court 1", date: date(0), time: "18:00", status: "Confirmed", amount: 0 },
  ],
  products: [
    { id: "P-1", sku: "RKT-001", name: "Champions Pro Racket", category: "Rackets", price: 4200, stock: 8, threshold: 5, icon: "🎾" },
    { id: "P-2", sku: "SHO-001", name: "Court Training Shoes", category: "Footwear", price: 3200, stock: 3, threshold: 5, icon: "👟" },
    { id: "P-3", sku: "BAL-001", name: "Padel Balls - 3 Pack", category: "Balls", price: 750, stock: 24, threshold: 8, icon: "⚪" },
    { id: "P-4", sku: "APP-001", name: "Dry-Fit Club Tee", category: "Apparel", price: 1200, stock: 2, threshold: 5, icon: "👕" },
  ],
  orders: [{ id: "SHOP-001", memberId: "M-1001", channel: "Counter", fulfillment: "Pickup", status: "Confirmed", total: 3570, date: date(-1) }],
  menu: [
    { id: "F-1", name: "Masala Lemonade", category: "Drinks", price: 120, available: true },
    { id: "F-2", name: "Club Sandwich", category: "Food", price: 280, available: true },
    { id: "F-3", name: "Cold Coffee", category: "Drinks", price: 180, available: true },
  ],
  tables: [
    { id: "T-1", number: "1", seats: 4, status: "Occupied" },
    { id: "T-2", number: "2", seats: 4, status: "Available" },
    { id: "T-3", number: "3", seats: 6, status: "Reserved" },
  ],
  tabs: [{ id: "TAB-101", tableId: "T-1", owner: "Aarav Mehta", memberId: "M-1001", status: "Open", balance: 680 }],
  kitchen: [{ id: "K-101", table: "1", items: "Club Sandwich, Lemonade", status: "Preparing", time: "18:12" }],
  enquiries: [{ id: "E-1", name: "Kabir Anand", phone: "98990 01122", interest: "Tennis trial", status: "New", followUp: date(1) }],
  staff: [
    { id: "S-1", name: "Priya Shah", role: "Front Desk", department: "Operations", shift: "08:00–16:00", leave: "Available", salary: 32000 },
    { id: "S-2", name: "Vikram Rao", role: "Court Staff", department: "Sports", shift: "14:00–22:00", leave: "Available", salary: 28000 },
  ],
  leave: [{ id: "L-1", staffId: "S-2", name: "Vikram Rao", dates: `${date(3)} to ${date(4)}`, reason: "Personal", status: "Pending" }],
  transactions: [
    { id: "T-001", source: "Court", amount: 2400, method: "UPI", date: date(0), status: "Recorded" },
    { id: "T-002", source: "Shop", amount: 3570, method: "Card", date: date(-1), status: "Recorded" },
    { id: "T-003", source: "Membership", amount: 5000, method: "Online", date: date(-2), status: "Recorded" },
  ],
  expenses: [{ id: "EXP-1", category: "Utilities", description: "Electricity", amount: 12000, date: date(-2), status: "Paid" }],
  invoices: [{ id: "INV-001", customer: "Nova Sports LLP", amount: 59000, paid: 30000, status: "Partially Paid", due: date(10) }],
  notifications: [
    { id: "N-1", type: "Low stock", title: "Court Training Shoes", detail: "Only 3 units remain", status: "Unread", time: "12 min ago" },
    { id: "N-2", type: "Membership", title: "Rohan Verma", detail: "Membership renewal approaching", status: "Unread", time: "38 min ago" },
  ],
};
