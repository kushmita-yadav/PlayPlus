import { bookingTimes, firstAvailableBookingTime, isSlotBooked } from "./booking.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

let demoSession = null;
try {
  demoSession = JSON.parse(sessionStorage.getItem("playpulseSession") || "null");
} catch {
  sessionStorage.removeItem("playpulseSession");
}
if (!demoSession || !["admin", "manager", "staff", "front_desk"].includes(demoSession.role)) {
  sessionStorage.removeItem("playpulseSession");
  window.location.replace("/");
  window.playpulseAdminGuardBlocked = true;
}

const rolePermissions = {
  admin: ["dashboard","members","courts","shop","cafeteria","enquiries","staff","finance","assistant","notifications","reports","settings"],
  manager: ["dashboard","members","courts","shop","cafeteria","enquiries","staff","finance","assistant","notifications","reports"],
  staff: ["dashboard","courts","shop","cafeteria","enquiries","assistant","notifications"],
  front_desk: ["dashboard","members","courts","enquiries","notifications"],
};
const permittedViews = rolePermissions[demoSession?.role] || [];

$$(".nav-item").forEach((item) => {
  const view = item.dataset.view;
  if (view && permittedViews.includes(view) === false) {
    item.hidden = true;
  }
});
if (demoSession?.role) {
  const profileName = $("#sidebar .profile strong");
  if (profileName) {
    profileName.textContent = demoSession.name || "Authorized User";
  }
  const roleName = $("#sidebar .profile small");
  if (roleName) {
    roleName.textContent = demoSession.role === "admin" ? "System Administrator" :
      demoSession.role === "manager" ? "Club Manager" : "Club Staff";
  }
}

const money = (value) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);

const defaultData = {
  members: [
    { id: "M-1001", name: "Aarav Mehta", plan: "Gold", phone: "98765 43210", expiry: "2027-02-28", balance: 0, dob: "1994-05-12" },
    { id: "M-1002", name: "Isha Kapoor", plan: "Silver", phone: "98765 01234", expiry: "2027-01-15", balance: 850, dob: "1998-08-22" },
    { id: "M-1003", name: "Rohan Verma", plan: "Junior", phone: "98765 12345", expiry: "2026-12-31", balance: 0, dob: "2012-03-10" },
    { id: "M-1004", name: "Neha Singh", plan: "Gold", phone: "98765 23456", expiry: "2026-11-28", balance: 1200, dob: "1991-11-03" },
    { id: "M-1005", name: "Kabir Anand", plan: "Silver", phone: "98990 01122", expiry: "2027-03-10", balance: 0, dob: "1989-01-19" }
  ],
  plans: [
    { code: "GOLD", name: "Gold", price: 5000, courtDiscount: 100, shopDiscount: 15, barDiscount: 15, freeSessions: 2 },
    { code: "SILVER", name: "Silver", price: 3000, courtDiscount: 25, shopDiscount: 10, barDiscount: 10, freeSessions: 0 },
    { code: "JUNIOR", name: "Junior", price: 1500, courtDiscount: 50, shopDiscount: 15, barDiscount: 10, freeSessions: 1 }
  ],
  courts: [
    { id: "C-1", name: "Tennis Court 1", sport: "Tennis", price: 1200, status: "Available" },
    { id: "C-2", name: "Tennis Court 2", sport: "Tennis", price: 1200, status: "Available" },
    { id: "C-3", name: "Padel Court 1", sport: "Padel", price: 1000, status: "Maintenance" },
    { id: "C-4", name: "Badminton Court 1", sport: "Badminton", price: 800, status: "Available" },
    { id: "C-5", name: "Cricket Net 1", sport: "Cricket", price: 1500, status: "Available" }
  ],
  bookings: [
    { id: "B-301", memberId: "M-1001", courtId: "C-1", court: "Tennis Court 1", date: "2026-11-21", time: "18:00", status: "Confirmed", amount: 0 },
    { id: "B-302", memberId: "M-1002", courtId: "C-2", court: "Tennis Court 2", date: "2026-11-21", time: "18:30", status: "Confirmed", amount: 900 },
    { id: "B-303", memberId: "M-1003", courtId: "C-4", court: "Badminton Court 1", date: "2026-11-21", time: "19:00", status: "Confirmed", amount: 400 },
    { id: "B-304", memberId: "M-1004", courtId: "C-5", court: "Cricket Net 1", date: "2026-11-22", time: "07:00", status: "Confirmed", amount: 1500 }
  ],
  products: [
    { id: "P-1", sku: "RKT-001", name: "Champions Pro Racket", category: "Rackets", price: 4200, stock: 8, threshold: 5, icon: "🎾" },
    { id: "P-2", sku: "SHO-001", name: "Court Training Shoes", category: "Footwear", price: 3200, stock: 3, threshold: 5, icon: "👟" },
    { id: "P-3", sku: "BAL-001", name: "Padel Balls - 3 Pack", category: "Balls", price: 750, stock: 24, threshold: 8, icon: "⚪" },
    { id: "P-4", sku: "APP-001", name: "Dry-Fit Club Tee", category: "Apparel", price: 1200, stock: 2, threshold: 5, icon: "👕" },
    { id: "P-5", sku: "ACC-001", name: "Racket Grip Bundle", category: "Accessories", price: 480, stock: 18, threshold: 5, icon: "⌁" }
  ],
  orders: [
    { id: "SHOP-001", memberId: "M-1001", channel: "Counter", fulfillment: "Pickup", status: "Confirmed", total: 3570, date: "2026-11-21" },
    { id: "SHOP-002", memberId: "M-1002", channel: "Online", fulfillment: "Delivery", status: "Fulfilled", total: 2880, date: "2026-11-20" }
  ],
  menu: [
    { id: "F-1", name: "Masala Lemonade", category: "Drinks", price: 120, available: true },
    { id: "F-2", name: "Club Sandwich", category: "Food", price: 280, available: true },
    { id: "F-3", name: "Cold Coffee", category: "Drinks", price: 180, available: true },
    { id: "F-4", name: "Veg Pasta", category: "Food", price: 360, available: true },
    { id: "F-5", name: "Protein Bowl", category: "Food", price: 420, available: false }
  ],
  tables: [
    { id: "T-1", number: "1", seats: 4, status: "Occupied" },
    { id: "T-2", number: "2", seats: 4, status: "Available" },
    { id: "T-3", number: "3", seats: 6, status: "Occupied" },
    { id: "T-4", number: "4", seats: 4, status: "Available" },
    { id: "T-5", number: "5", seats: 2, status: "Reserved" },
    { id: "T-6", number: "6", seats: 8, status: "Available" }
  ],
  tabs: [
    { id: "TAB-101", tableId: "T-1", owner: "Aarav Mehta", memberId: "M-1001", status: "Open", balance: 680 },
    { id: "TAB-102", tableId: "T-3", owner: "Walk-in Guest", memberId: null, status: "Open", balance: 1240 }
  ],
  kitchen: [
    { id: "K-101", table: "1", items: "Club Sandwich, Lemonade", status: "Preparing", time: "18:12" },
    { id: "K-102", table: "3", items: "2× Veg Pasta, 2× Cold Coffee", status: "Ready", time: "18:08" }
  ],
  enquiries: [
    { id: "E-1", name: "Kabir Anand", phone: "98990 01122", interest: "Tennis trial", status: "New", followUp: "2026-11-22" },
    { id: "E-2", name: "Meera Joshi", phone: "98990 02233", interest: "Gold membership", status: "Follow-up", followUp: "2026-11-21" },
    { id: "E-3", name: "Nova Sports LLP", phone: "98990 03344", interest: "Corporate package", status: "Quoted", followUp: "2026-11-25" }
  ],
  staff: [
    { id: "S-1", name: "Priya Shah", role: "Front Desk", department: "Operations", shift: "08:00–16:00", leave: "Available", salary: 32000 },
    { id: "S-2", name: "Vikram Rao", role: "Court Staff", department: "Sports", shift: "14:00–22:00", leave: "Available", salary: 28000 },
    { id: "S-3", name: "Sara Khan", role: "Bar Manager", department: "Cafeteria", shift: "12:00–20:00", leave: "Approved", salary: 38000 }
  ],
  leave: [
    { id: "L-1", staffId: "S-2", name: "Vikram Rao", dates: "2026-11-24 to 2026-11-25", reason: "Personal", status: "Pending" },
    { id: "L-2", staffId: "S-3", name: "Sara Khan", dates: "2026-11-27 to 2026-11-29", reason: "Family", status: "Approved" }
  ],
  transactions: [
    { id: "T-001", source: "Court", amount: 2400, method: "UPI", date: "2026-11-21", status: "Recorded" },
    { id: "T-002", source: "Shop", amount: 3570, method: "Card", date: "2026-11-21", status: "Recorded" },
    { id: "T-003", source: "Cafeteria", amount: 1920, method: "Cash", date: "2026-11-21", status: "Recorded" },
    { id: "T-004", source: "Membership", amount: 5000, method: "Online", date: "2026-11-20", status: "Recorded" },
    { id: "T-005", source: "Court", amount: 1500, method: "Card", date: "2026-11-20", status: "Recorded" }
  ],
  expenses: [
    { id: "EXP-1", category: "Utilities", description: "Electricity", amount: 12000, date: "2026-11-18", status: "Paid" },
    { id: "EXP-2", category: "Maintenance", description: "Court resurfacing", amount: 4500, date: "2026-11-19", status: "Recorded" }
  ],
  invoices: [
    { id: "INV-001", customer: "Nova Sports LLP", amount: 59000, paid: 30000, status: "Partially Paid", due: "2026-11-30" },
    { id: "INV-002", customer: "Ace Corporate Club", amount: 28000, paid: 28000, status: "Paid", due: "2026-11-15" }
  ],
  notifications: [
    { id: "N-1", type: "Low stock", title: "Court Training Shoes", detail: "Only 3 units remain", status: "Unread", time: "12 min ago" },
    { id: "N-2", type: "Membership", title: "Neha Singh", detail: "Membership expires in 7 days", status: "Unread", time: "38 min ago" },
    { id: "N-3", type: "Booking", title: "Tennis Court 1", detail: "18:00 booking confirmed", status: "Read", time: "1 hr ago" }
  ]
};

let demoDataRecovered = false;
function loadDemoData() {
  const stored = localStorage.getItem("playpulseDemoData");
  if (!stored) return structuredClone(defaultData);
  try {
    const parsed = JSON.parse(stored);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Stored demo data must be an object");
    }
    return parsed;
  } catch (error) {
    console.error("Unable to read browser demo data", error);
    localStorage.removeItem("playpulseDemoData");
    demoDataRecovered = true;
    return structuredClone(defaultData);
  }
}
let data = loadDemoData();
let sharedVersion = 0;
let sharedSyncEnabled = false;
let sharedWriteQueue = Promise.resolve();
let sharedSyncRetryDelay = 1000;
let sharedSyncRetryTimer;
let sharedEventSource;
let sharedEventRetryDelay = 1000;
let sharedEventRetryTimer;
const syncTime = () => new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit"
}).format(new Date());
function updateSyncStatus(state, text) {
  const status = $("#syncStatus");
  if (!status) return;
  status.dataset.state = state;
  status.textContent = text;
}

function scheduleSharedSyncRetry(error) {
  const match = error instanceof Error ? error.message.match(/\((\d{3})\)/) : null;
  const status = match ? Number(match[1]) : null;
  if (status !== null && status < 500) {
    updateSyncStatus("error", "Shared sync unavailable for this account");
    return;
  }
  const delay = sharedSyncRetryDelay;
  sharedSyncRetryDelay = Math.min(sharedSyncRetryDelay * 2, 30_000);
  updateSyncStatus("connecting", `Database sync unavailable · retrying in ${Math.ceil(delay / 1000)}s`);
  clearTimeout(sharedSyncRetryTimer);
  sharedSyncRetryTimer = setTimeout(() => void initializeSharedData(), delay);
}

function save() {
  localStorage.setItem("playpulseDemoData", JSON.stringify(data));
  if (!sharedSyncEnabled) return;
  const snapshot = structuredClone(data);
  sharedWriteQueue = sharedWriteQueue.then(async () => {
    const response = await fetch("/api/v1/demo-data", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: sharedVersion, data: snapshot }),
    });
    if (response.status === 409) {
      await refreshSharedData(false);
      toast("A teammate changed shared data. The latest version was loaded; retry your change.");
      return;
    }
    if (!response.ok) throw new Error(`Shared save failed (${response.status})`);
    const body = await response.json();
    sharedVersion = body.data.version;
    updateSyncStatus("live", `Live sync · ${syncTime()}`);
  }).catch((error) => {
    console.error("Unable to save shared demo data", error);
    updateSyncStatus("error", "Sync failed · saved only in this browser");
    toast("The server could not save this change. Check the connection and try again.");
  });
}

async function refreshSharedData(announce) {
  const response = await fetch("/api/v1/demo-data");
  if (!response.ok) throw new Error(`Shared data refresh failed (${response.status})`);
  const body = await response.json();
  const remoteVersion = Number(body.data.version);
  if (body.data.state && remoteVersion > sharedVersion) {
    data = body.data.state;
    sharedVersion = remoteVersion;
    localStorage.setItem("playpulseDemoData", JSON.stringify(data));
    updateSyncStatus("live", `Live sync · ${syncTime()}`);
    if (!$("#modalBackdrop").classList.contains("open")) {
      render($(".nav-item.active")?.dataset.view || "dashboard");
    }
    if (announce) toast("Shared data updated");
  }
}

function connectSharedEvents() {
  const events = new EventSource("/api/v1/demo-data/events");
  sharedEventSource = events;
  events.onopen = async () => {
    if (sharedEventSource !== events) return;
    clearTimeout(sharedEventRetryTimer);
    sharedEventRetryDelay = 1000;
    updateSyncStatus("live", `Live sync · ${syncTime()}`);
    try {
      await refreshSharedData(false);
    } catch (error) {
      console.error("Unable to catch up with shared demo data", error);
      updateSyncStatus("error", "Live refresh failed");
    }
  };
  events.onmessage = async (event) => {
    try {
      const notification = JSON.parse(event.data);
      if (Number(notification.version) > sharedVersion) {
        await refreshSharedData(true);
      }
    } catch (error) {
      console.error("Unable to refresh shared demo data", error);
      updateSyncStatus("error", "Live refresh failed");
    }
  };
  events.onerror = () => {
    if (sharedEventSource !== events) return;
    events.close();
    sharedEventSource = undefined;
    const delay = sharedEventRetryDelay;
    sharedEventRetryDelay = Math.min(sharedEventRetryDelay * 2, 30_000);
    updateSyncStatus("connecting", `Reconnecting live sync in ${Math.ceil(delay / 1000)}s…`);
    clearTimeout(sharedEventRetryTimer);
    sharedEventRetryTimer = setTimeout(connectSharedEvents, delay);
  };
}

async function initializeSharedData() {
  try {
    const response = await fetch("/api/v1/demo-data");
    if (!response.ok) throw new Error(`Shared data unavailable (${response.status})`);
    const body = await response.json();
    sharedVersion = Number(body.data.version);
    if (body.data.state) {
      data = body.data.state;
      localStorage.setItem("playpulseDemoData", JSON.stringify(data));
    } else {
      const seedResponse = await fetch("/api/v1/demo-data", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: sharedVersion, data }),
      });
      if (seedResponse.status === 409) {
        await refreshSharedData(false);
      } else if (!seedResponse.ok) {
        throw new Error(`Shared demo data initialization failed (${seedResponse.status})`);
      } else {
        const seeded = await seedResponse.json();
        sharedVersion = seeded.data.version;
      }
    }
    sharedSyncEnabled = true;
    sharedSyncRetryDelay = 1000;
    connectSharedEvents();
  } catch (error) {
    console.error("Shared demo data is unavailable", error);
    updateSyncStatus("local", demoDataRecovered
      ? "Local demo only · invalid browser data reset"
      : "Local demo only · sync retrying");
    scheduleSharedSyncRetry(error);
    if (demoDataRecovered) toast("Unreadable browser data was reset to the sample dataset.");
  }
  render("dashboard");
}

window.addEventListener("storage", (event) => {
  if (sharedSyncEnabled || event.key !== "playpulseDemoData" || !event.newValue) return;
  try {
    const updatedData = JSON.parse(event.newValue);
    if (!updatedData || typeof updatedData !== "object") throw new Error("Stored demo data has an invalid shape");
    data = updatedData;
    render($(".nav-item.active")?.dataset.view || "dashboard");
    toast("Demo data updated in another browser tab");
  } catch (error) {
    console.error("Unable to apply browser-tab demo data update", error);
    updateSyncStatus("error", "Local data refresh failed");
  }
});
const localDateValue = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
const formatBookingDate = (date) => new Intl.DateTimeFormat("en-IN", {
  day: "numeric", month: "long", year: "numeric"
}).format(new Date(`${date}T00:00:00`));
let courtScheduleDate = localDateValue();

const pageTitles = {
  dashboard: "Dashboard",
  members: "Members",
  courts: "Courts & Bookings",
  shop: "Sports Shop",
  cafeteria: "Cafeteria & Bar",
  enquiries: "Enquiries & Trials",
  staff: "Staff & Operations",
  finance: "Finance",
  assistant: "Smart Assistant",
  notifications: "Notifications",
  reports: "Reports & Exports",
  settings: "Settings"
};

const quickLabels = {
  dashboard: "+ New booking",
  members: "+ Add member",
  courts: "+ New booking",
  shop: "+ Add product",
  cafeteria: "+ Open tab",
  enquiries: "+ New enquiry",
  staff: "+ Add staff",
  finance: "+ Add invoice",
  assistant: "Ask assistant",
  notifications: "Generate reminders",
  reports: "Export report",
  settings: "Save settings"
};

const memberById = (id) => data.members.find((member) => member.id === id);
const tierClass = (plan) => plan.toLowerCase();

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function badge(value, kind) {
  return `<span class="badge ${kind || "neutral"}">${escapeHtml(value)}</span>`;
}

function actionButton(label, action, extra = "") {
  return `<button class="small-button" data-action="${action}" ${extra}>${escapeHtml(label)}</button>`;
}

function openModal(title, fieldsHtml, submitLabel, submitAction) {
  $("#modal").innerHTML = `
    <h2>${escapeHtml(title)}</h2>
    ${fieldsHtml}
    <div class="modal-actions">
      <button class="secondary-button" type="button" data-close-modal>Cancel</button>
      <button class="primary-button" type="button" data-submit-modal="${submitAction}">${escapeHtml(submitLabel)}</button>
    </div>`;
  $("#modalBackdrop").classList.add("open");
  $("#modalBackdrop").setAttribute("aria-hidden", "false");
  $$("[data-close-modal]", $("#modal")).forEach((button) => button.addEventListener("click", closeModal));
  $("[data-submit-modal]", $("#modal"))?.addEventListener("click", handleModalSubmit);
}

function closeModal() {
  $("#modalBackdrop").classList.remove("open");
  $("#modalBackdrop").setAttribute("aria-hidden", "true");
}

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove("show"), 2600);
}

function renderDashboard() {
  const today = localDateValue();
  const todayTransactionCount = data.transactions.filter((transaction) => transaction.date === today).length;
  const todayRevenue = data.transactions
    .filter((transaction) => transaction.date === today)
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const courtRevenue = data.transactions.filter((item) => item.source === "Court").reduce((sum, item) => sum + item.amount, 0);
  const shopRevenue = data.transactions.filter((item) => item.source === "Shop").reduce((sum, item) => sum + item.amount, 0);
  const barRevenue = data.transactions.filter((item) => item.source === "Cafeteria").reduce((sum, item) => sum + item.amount, 0);

  $("#appView").innerHTML = `
    <div class="stats-grid">
      ${statCard("Today's Revenue", money(todayRevenue), `${todayTransactionCount} transactions today`, "₹", "↑ 12.4%")}
      ${statCard("Active Members", data.members.length, "2 renewals this month", "♙", "↑ 8.1%")}
      ${statCard("Today's Courts", data.bookings.filter((item) => item.date === today).length, "78% utilisation", "◉", "↑ 6.2%")}
      ${statCard("Outstanding", money(data.members.reduce((sum, member) => sum + member.balance, 0)), "3 accounts", "!", "2 overdue")}
    </div>
    <div class="grid-2" style="margin-top:14px">
      <div class="card">
        <div class="card-header"><h3>Recent court bookings</h3><button class="small-button" data-view-link="courts">View all</button></div>
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>Member</th><th>Court</th><th>Date</th><th>Time</th><th>Status</th></tr></thead>
          <tbody>${data.bookings.slice(0, 5).map((booking) => `
            <tr><td><strong>${escapeHtml(memberById(booking.memberId)?.name || "Walk-in")}</strong></td><td>${escapeHtml(booking.court)}</td><td>${booking.date}</td><td>${booking.time}</td><td>${badge(booking.status, "success")}</td></tr>`).join("")}</tbody>
        </table></div>
      </div>
      <div class="card">
        <div class="card-header"><h3>Revenue by source</h3><button class="small-button" data-view-link="finance">Details</button></div>
        ${progressRow("Courts", courtRevenue, courtRevenue + shopRevenue + barRevenue)}
        ${progressRow("Shop", shopRevenue, courtRevenue + shopRevenue + barRevenue)}
        ${progressRow("Cafeteria", barRevenue, courtRevenue + shopRevenue + barRevenue)}
        ${progressRow("Membership", 5000, courtRevenue + shopRevenue + barRevenue + 5000)}
      </div>
    </div>
    <div class="grid-3" style="margin-top:14px">
      <div class="card"><div class="card-header"><h3>Low stock</h3><button class="small-button" data-view-link="shop">Manage</button></div>${data.products.filter((product) => product.stock <= product.threshold).map((product) => `<div class="progress-row"><div class="progress-label"><span>${escapeHtml(product.name)}</span><strong>${product.stock} left</strong></div><div class="progress-track"><span style="width:${Math.max(8, product.stock / product.threshold * 100)}%;background:#c79232"></span></div></div>`).join("")}</div>
      <div class="card"><div class="card-header"><h3>Expiring memberships</h3><button class="small-button" data-view-link="members">View</button></div>${data.members.filter((member) => ["2026-11-28", "2026-12-31"].includes(member.expiry)).map((member) => `<p style="font-size:12.5px"><strong>${escapeHtml(member.name)}</strong><br><small style="color:var(--muted)">Expires ${member.expiry}</small></p>`).join("")}</div>
      <div class="card"><div class="card-header"><h3>Open tabs</h3><button class="small-button" data-view-link="cafeteria">Settle</button></div>${data.tabs.map((tab) => `<p style="display:flex;justify-content:space-between;font-size:12.5px"><span>${escapeHtml(tab.owner)} · Table ${escapeHtml(tab.tableId.replace("T-", ""))}</span><strong>${money(tab.balance)}</strong></p>`).join("")}</div>
    </div>`;
}

function statCard(title, value, foot, icon, change) {
  return `<div class="card stat-card"><div class="stat-top"><span>${escapeHtml(title)}</span><span class="stat-icon">${icon}</span></div><div class="stat-value">${escapeHtml(value)}</div><div class="stat-change">${escapeHtml(change)} · ${escapeHtml(foot)}</div></div>`;
}

function progressRow(label, value, total) {
  const width = total ? Math.max(5, value / total * 100) : 0;
  return `<div class="progress-row"><div class="progress-label"><span>${escapeHtml(label)}</span><strong>${money(value)}</strong></div><div class="progress-track"><span style="width:${width}%"></span></div></div>`;
}

function renderMembers() {
  $("#appView").innerHTML = `
    <div class="toolbar">
      <input class="search-input" id="memberSearch" placeholder="Search member, phone or ID">
      <select class="form-control" id="memberPlanFilter" style="max-width:150px"><option value="">All plans</option><option>Gold</option><option>Silver</option><option>Junior</option></select>
    </div>
    <div class="card">
      <div class="card-header"><h3>${data.members.length} members</h3><button class="secondary-button" data-action="show-expiring">Expiring soon</button></div>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Member</th><th>Plan</th><th>Phone</th><th>Expiry</th><th>Balance</th><th>Actions</th></tr></thead>
      <tbody id="memberRows">${memberRows()}</tbody></table></div>
    </div>`;
  $("#memberSearch").addEventListener("input", refreshMemberRows);
  $("#memberPlanFilter").addEventListener("change", refreshMemberRows);
}

function memberRows() {
  const query = ($("#memberSearch")?.value || "").toLowerCase();
  const plan = $("#memberPlanFilter")?.value || "";
  return data.members
    .filter((member) => (!plan || member.plan === plan) && (`${member.name} ${member.phone} ${member.id}`).toLowerCase().includes(query))
    .map((member) => `<tr>
      <td><strong>${escapeHtml(member.name)}</strong><br><small style="color:var(--muted)">${member.id}</small></td>
      <td>${badge(member.plan, tierClass(member.plan))}</td><td>${escapeHtml(member.phone)}</td><td>${member.expiry}</td><td>${money(member.balance)}</td>
      <td><div class="actions">${actionButton("View", `view-member:${member.id}`)}${actionButton("Renew", `renew-member:${member.id}`)}</div></td>
    </tr>`).join("");
}

function refreshMemberRows() {
  $("#memberRows").innerHTML = memberRows();
}

function renderCourts(date = courtScheduleDate) {
  courtScheduleDate = date;
  $("#appView").innerHTML = `
    <div class="page-intro"><div><h2>Availability — ${formatBookingDate(date)}</h2><p>One-hour sessions, 30-minute start intervals</p></div></div>
    <div class="schedule-toolbar"><input class="form-control" id="courtDate" type="date" value="${date}"><button class="secondary-button" data-action="open-court-modal">Check booking</button></div>
    <div class="card" style="overflow-x:auto">
      <div class="schedule-grid">
        <div class="schedule-head">Time</div>${data.courts.slice(0, 4).map((court) => `<div class="schedule-head">${escapeHtml(court.name)}</div>`).join("")}
        ${bookingTimes.map((time) => `
          <div class="schedule-time">${time}</div>
          ${data.courts.slice(0, 4).map((court) => {
            const booked = isSlotBooked(data.bookings, court.id, date, time);
            return `<div class="schedule-slot"><button class="${booked ? "booked" : ""}" ${booked ? "disabled" : ""} data-action="${booked ? "" : `open-court-modal:${court.id}:${time}`}">${booked ? "Booked" : "Available"}</button></div>`;
          }).join("")}`).join("")}
      </div>
    </div>
    <div class="grid-3" style="margin-top:14px">${data.courts.map((court) => `<div class="card"><div class="card-header"><h3>${escapeHtml(court.name)}</h3>${badge(court.status, court.status === "Available" ? "success" : "warning")}</div><p style="color:var(--muted);font-size:12px">${court.sport} · ${money(court.price)} / hour</p></div>`).join("")}</div>`;
  $("#courtDate").addEventListener("change", () => {
    courtScheduleDate = $("#courtDate").value;
    renderCourts();
  });
}

function renderShop() {
  $("#appView").innerHTML = `
    <div class="toolbar"><input class="search-input" id="productSearch" placeholder="Search products"><select class="form-control" id="productCategory" style="max-width:160px"><option value="">All categories</option><option>Rackets</option><option>Footwear</option><option>Balls</option><option>Apparel</option><option>Accessories</option></select></div>
    <div class="product-grid" id="productGrid">${productCards()}</div>`;
  $("#productSearch").addEventListener("input", refreshProductCards);
  $("#productCategory").addEventListener("change", refreshProductCards);
}

function productCards() {
  const query = ($("#productSearch")?.value || "").toLowerCase();
  const category = $("#productCategory")?.value || "";
  return data.products
    .filter((product) => (!category || product.category === category) && `${product.name} ${product.sku}`.toLowerCase().includes(query))
    .map((product) => `<div class="product-card"><div class="product-art">${product.icon}</div><h4>${escapeHtml(product.name)}</h4><p>${escapeHtml(product.category)} · ${product.stock} in stock</p><div class="product-footer"><strong>${money(product.price)}</strong><button class="small-button" data-action="sell-product:${product.id}">${product.stock ? "Sell" : "Out"}</button></div></div>`).join("");
}

function refreshProductCards() {
  $("#productGrid").innerHTML = productCards();
}

function renderCafeteria() {
  $("#appView").innerHTML = `
    <div class="tabs"><button class="tab active" data-cafe-tab="tables">Tables</button><button class="tab" data-cafe-tab="kitchen">Kitchen queue</button><button class="tab" data-cafe-tab="menu">Menu</button></div>
    <div class="cafeteria-layout">
      <div id="cafeLeft">${cafeTables()}</div>
      <div class="card order-panel"><div class="card-header"><h3>Current order</h3><button class="small-button" data-action="clear-order">Clear</button></div><div id="orderCart"><p style="font-size:12px;color:var(--muted)">Select menu items to add an order.</p></div><div class="menu-chips">${data.menu.filter((item) => item.available).map((item) => `<button class="small-button" data-action="add-menu:${item.id}">+ ${escapeHtml(item.name)}</button>`).join("")}</div><div class="cart-total"><span>Total</span><strong id="cartTotal">${money(0)}</strong></div><button class="primary-button" style="width:100%" data-action="checkout-tab">Take payment</button></div>
    </div>`;
  window.cafeCart ||= [];
  updateCart();
  $$("[data-cafe-tab]").forEach((tab) => tab.addEventListener("click", () => {
    $$(".tab").forEach((item) => item.classList.remove("active"));
    tab.classList.add("active");
    if (tab.dataset.cafeTab === "kitchen") $("#cafeLeft").innerHTML = kitchenPanel();
    if (tab.dataset.cafeTab === "menu") $("#cafeLeft").innerHTML = menuPanel();
    if (tab.dataset.cafeTab === "tables") $("#cafeLeft").innerHTML = cafeTables();
  }));
}

function cafeTables() {
  return `<div class="tables-grid">${data.tables.map((table) => `<button class="table-card ${table.status === "Occupied" ? "occupied" : ""}" data-action="toggle-table:${table.id}"><div><strong>Table ${escapeHtml(table.number)}</strong><small>${table.seats} seats · ${table.status}</small></div></button>`).join("")}</div>`;
}

function kitchenPanel() {
  return `<div class="card"><div class="card-header"><h3>Kitchen queue</h3><button class="small-button" data-action="refresh-kitchen">Refresh</button></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Order</th><th>Table</th><th>Items</th><th>Status</th><th>Time</th></tr></thead><tbody>${data.kitchen.map((order) => `<tr><td>${order.id}</td><td>${order.table}</td><td>${escapeHtml(order.items)}</td><td>${badge(order.status, order.status === "Ready" ? "success" : "warning")}</td><td>${order.time}</td></tr>`).join("")}</tbody></table></div></div>`;
}

function menuPanel() {
  return `<div class="card"><div class="card-header"><h3>Menu</h3><button class="small-button" data-action="add-menu-product">Add item</button></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Item</th><th>Category</th><th>Price</th><th>Availability</th></tr></thead><tbody>${data.menu.map((item) => `<tr><td><strong>${escapeHtml(item.name)}</strong></td><td>${escapeHtml(item.category)}</td><td>${money(item.price)}</td><td>${badge(item.available ? "Available" : "Unavailable", item.available ? "success" : "danger")}</td></tr>`).join("")}</tbody></table></div></div>`;
}

function updateCart() {
  if (!$("#orderCart")) return;
  const cart = window.cafeCart || [];
  $("#orderCart").innerHTML = cart.length ? cart.map((item) => `<div class="cart-line"><span>${escapeHtml(item.name)}</span><strong>${money(item.price)}</strong></div>`).join("") : `<p style="font-size:12px;color:var(--muted)">Select menu items to add an order.</p>`;
  $("#cartTotal").textContent = money(cart.reduce((sum, item) => sum + item.price, 0));
}

function renderEnquiries() {
  $("#appView").innerHTML = `
    <div class="grid-3">${statCard("New leads", data.enquiries.filter((item) => item.status === "New").length, "Requires follow-up", "✉", "Today")}
    ${statCard("Follow-ups", data.enquiries.filter((item) => item.status === "Follow-up").length, "Scheduled", "◷", "This week")}
    ${statCard("Quoted", data.enquiries.filter((item) => item.status === "Quoted").length, "Awaiting response", "₹", "2 open")}</div>
    <div class="card" style="margin-top:14px"><div class="table-wrap"><table class="data-table"><thead><tr><th>Visitor</th><th>Phone</th><th>Interest</th><th>Status</th><th>Follow-up</th><th>Actions</th></tr></thead>
    <tbody>${data.enquiries.map((item) => `<tr><td><strong>${escapeHtml(item.name)}</strong></td><td>${escapeHtml(item.phone)}</td><td>${escapeHtml(item.interest)}</td><td>${badge(item.status, item.status === "New" ? "warning" : item.status === "Quoted" ? "success" : "neutral")}</td><td>${item.followUp}</td><td><div class="actions">${actionButton("Follow up", `follow-enquiry:${item.id}`)}${actionButton("Quote", `quote-enquiry:${item.id}`)}</div></td></tr>`).join("")}</tbody></table></div></div>`;
}

function renderStaff() {
  $("#appView").innerHTML = `
    <div class="tabs"><button class="tab active" data-staff-tab="staff">Staff</button><button class="tab" data-staff-tab="shifts">Shifts</button><button class="tab" data-staff-tab="leave">Leave requests</button><button class="tab" data-staff-tab="payroll">Payroll</button></div>
    <div id="staffContent">${staffTable()}</div>`;
  $$("[data-staff-tab]").forEach((tab) => tab.addEventListener("click", () => {
    $$(".tab").forEach((item) => item.classList.remove("active"));
    tab.classList.add("active");
    if (tab.dataset.staffTab === "staff") $("#staffContent").innerHTML = staffTable();
    if (tab.dataset.staffTab === "shifts") $("#staffContent").innerHTML = shiftsTable();
    if (tab.dataset.staffTab === "leave") $("#staffContent").innerHTML = leaveTable();
    if (tab.dataset.staffTab === "payroll") $("#staffContent").innerHTML = payrollTable();
  }));
}

function staffTable() {
  return `<div class="card"><div class="table-wrap"><table class="data-table"><thead><tr><th>Employee</th><th>Role</th><th>Department</th><th>Current shift</th><th>Leave</th><th>Salary</th></tr></thead><tbody>${data.staff.map((staff) => `<tr><td><strong>${escapeHtml(staff.name)}</strong><br><small style="color:var(--muted)">${staff.id}</small></td><td>${escapeHtml(staff.role)}</td><td>${escapeHtml(staff.department)}</td><td>${staff.shift}</td><td>${badge(staff.leave, staff.leave === "Approved" ? "success" : "neutral")}</td><td>${money(staff.salary)}</td></tr>`).join("")}</tbody></table></div></div>`;
}
function shiftsTable() {
  return `<div class="card"><div class="table-wrap"><table class="data-table"><thead><tr><th>Employee</th><th>Date</th><th>Shift</th><th>Department</th><th>Status</th></tr></thead><tbody>${data.staff.map((staff) => `<tr><td>${escapeHtml(staff.name)}</td><td>21 Nov 2026</td><td>${staff.shift}</td><td>${escapeHtml(staff.department)}</td><td>${badge("Scheduled", "success")}</td></tr>`).join("")}</tbody></table></div></div>`;
}
function leaveTable() {
  return `<div class="card"><div class="table-wrap"><table class="data-table"><thead><tr><th>Employee</th><th>Dates</th><th>Reason</th><th>Status</th><th>Action</th></tr></thead><tbody>${data.leave.map((item) => `<tr><td>${escapeHtml(item.name)}</td><td>${item.dates}</td><td>${escapeHtml(item.reason)}</td><td>${badge(item.status, item.status === "Approved" ? "success" : "warning")}</td><td>${item.status === "Pending" ? `<div class="actions">${actionButton("Approve", `approve-leave:${item.id}`)}${actionButton("Reject", `reject-leave:${item.id}`)}</div>` : "—"}</td></tr>`).join("")}</tbody></table></div></div>`;
}
function payrollTable() {
  const gross = data.staff.reduce((sum, staff) => sum + staff.salary, 0);
  return `<div class="grid-3">${statCard("Gross payroll", money(gross), "Monthly estimate", "₹", "November")} ${statCard("Payroll liabilities", money(gross), "Before deductions", "!", "Awaiting approval")} ${statCard("Staff count", data.staff.length, "Active profiles", "♟", "3 departments")}</div><div class="card" style="margin-top:14px"><div class="table-wrap"><table class="data-table"><thead><tr><th>Employee</th><th>Gross</th><th>Deductions</th><th>Net</th><th>Status</th></tr></thead><tbody>${data.staff.map((staff) => `<tr><td>${escapeHtml(staff.name)}</td><td>${money(staff.salary)}</td><td>${money(Math.round(staff.salary * .1))}</td><td><strong>${money(Math.round(staff.salary * .9))}</strong></td><td>${badge("Estimated", "warning")}</td></tr>`).join("")}</tbody></table></div></div>`;
}

function renderFinance() {
  const revenue = data.transactions.reduce((sum, item) => sum + item.amount, 0);
  const expenses = data.expenses.reduce((sum, item) => sum + item.amount, 0);
  $("#appView").innerHTML = `
    <div class="stats-grid">${statCard("Gross revenue", money(revenue), "Recorded this month", "₹", "↑ 9.8%")}${statCard("Cash & equivalents", money(1920), "Cash and settlement", "₹", "By method")}${statCard("Expenses", money(expenses), "Recorded expenses", "!", "November")}${statCard("Payroll liability", money(data.staff.reduce((sum, staff) => sum + staff.salary, 0)), "Estimated gross", "♟", "Before tax")}</div>
    <div class="grid-2" style="margin-top:14px"><div class="card"><div class="card-header"><h3>Transactions</h3><button class="small-button" data-action="export-finance">Export</button></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Reference</th><th>Source</th><th>Method</th><th>Date</th><th>Status</th><th>Amount</th></tr></thead><tbody>${data.transactions.map((item) => `<tr><td>${item.id}</td><td>${item.source}</td><td>${item.method}</td><td>${item.date}</td><td>${badge(item.status, "success")}</td><td><strong>${money(item.amount)}</strong></td></tr>`).join("")}</tbody></table></div></div>
    <div class="card"><div class="card-header"><h3>Invoice aging</h3><button class="small-button" data-action="open-invoice-modal">New invoice</button></div>${data.invoices.map((invoice) => `<div class="progress-row"><div class="progress-label"><span><strong>${escapeHtml(invoice.customer)}</strong><br><small style="color:var(--muted)">${invoice.status} · due ${invoice.due}</small></span><strong>${money(invoice.amount - invoice.paid)}</strong></div><div class="progress-track"><span style="width:${invoice.paid / invoice.amount * 100}%"></span></div></div>`).join("")}<div style="border-top:1px solid var(--line);margin-top:16px;padding-top:12px"><strong>Net before tax</strong><div style="font-size:24px;margin-top:5px">${money(revenue - expenses)}</div></div></div></div>`;
}

function renderAssistant() {
  $("#appView").innerHTML = `
    <div class="assistant-layout">
      <div class="card chat-box"><div class="card-header"><h3>Club assistant</h3><button class="small-button" data-action="clear-chat">Clear chat</button></div><div class="chat-messages" id="chatMessages"><div class="chat-message assistant">Hello! I can help with court availability, low stock, finance, matchmaking and team balancing.</div></div><div class="chat-input"><input class="form-control" id="chatInput" placeholder="Try: show low stock or balance teams"><button class="primary-button" data-action="send-chat">Send</button></div></div>
      <div class="card"><h3>Suggested prompts</h3><div class="channel-list" style="margin-top:12px">${["Show court availability","Check low stock","Summarise today’s revenue","Find a tennis partner","Balance two teams"].map((prompt) => `<button class="small-button" style="width:100%" data-action="prompt-chat:${encodeURIComponent(prompt)}">${prompt}</button>`).join("")}</div></div>
    </div>`;
}

function assistantReply(prompt) {
  const lower = prompt.toLowerCase();
  if (lower.includes("stock")) return "Two products are below their low-stock thresholds: Court Training Shoes (3) and Dry-Fit Club Tee (2).";
  if (lower.includes("court") || lower.includes("availability")) return "Tennis Court 1 and Badminton Court 1 have availability later today. Padel Court 1 is marked for maintenance.";
  if (lower.includes("revenue") || lower.includes("finance")) return `Today’s recorded revenue is ${money(data.transactions.filter((item) => item.date === localDateValue()).reduce((sum, item) => sum + item.amount, 0))}.`;
  if (lower.includes("partner") || lower.includes("match")) return "Matching suggestion: Kabir Anand (Silver, skill 4) and Aarav Mehta (Gold, skill 5) are compatible for a tennis session.";
  if (lower.includes("team")) return "Balanced team result: Team A (Aarav 5, Rohan 3) — total 8; Team B (Isha 4, Neha 4) — total 8.";
  return "I can provide a club recommendation from memberships, courts, inventory, finance, enquiries or matchmaking data.";
}

function renderNotifications() {
  $("#appView").innerHTML = `
    <div class="page-intro"><div><h2>Notification outbox</h2><p>Membership, booking, stock and payment notifications</p></div><button class="primary-button" data-action="generate-reminders">Generate reminders</button></div>
    <div class="card"><div class="channel-list">${data.notifications.map((item) => `<div class="channel-row"><div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.type)} · ${escapeHtml(item.detail)} · ${item.time}</small></div>${badge(item.status, item.status === "Unread" ? "warning" : "neutral")}</div>`).join("")}</div></div>`;
}

function renderReports() {
  $("#appView").innerHTML = `
    <div class="grid-3">
      ${statCard("Performance CSV", "Ready", "Revenue and expenses", "▧", "CSV")}
      ${statCard("Invoice XLSX", "Ready", "Outstanding invoices", "▧", "XLSX")}
      ${statCard("Tax PDF", "Ready", "Configurable tax estimate", "▧", "PDF")}
    </div>
    <div class="card" style="margin-top:14px"><div class="card-header"><h3>Export centre</h3></div><div class="form-grid"><div class="form-field"><label>Report</label><select class="form-control" id="reportType"><option>Performance</option><option>Invoices</option><option>Tax estimate</option></select></div><div class="form-field"><label>Format</label><select class="form-control" id="reportFormat"><option>CSV</option><option>XLSX</option><option>PDF</option></select></div><div class="form-field"><label>From</label><input class="form-control" type="date" value="2026-11-01"></div><div class="form-field"><label>To</label><input class="form-control" type="date" value="2026-11-30"></div></div><div class="modal-actions"><button class="primary-button" data-action="export-report">Generate export</button></div></div>`;
}

function renderSettings() {
  $("#appView").innerHTML = `
    <div class="settings-grid">
      <div class="card setting-card"><h3>Club profile</h3><p>The Champions Club<br>Tennis, Padel, Cricket and Badminton<br>Timezone: Asia/Kolkata</p><button class="small-button" data-action="edit-club">Edit profile</button></div>
      <div class="card setting-card"><h3>Backend connection</h3><p id="connectionStatus">Demo mode is active. The UI also supports optional API connection to this Express server.</p><button class="small-button" data-action="test-api">Test API</button></div>
      <div class="card setting-card"><h3>Sample data</h3><p>Local data is stored in this browser and can be reset to the original demonstration dataset.</p><button class="danger-button" data-action="reset-data">Reset demo data</button></div>
      <div class="card setting-card"><h3>Payments</h3><p>Cash, card and UPI are recorded. Real gateway processing must be configured separately.</p><button class="small-button" data-action="payment-settings">Payment settings</button></div>
      <div class="card setting-card"><h3>Notifications</h3><p>In-app reminders are active. Email and SMS require a provider adapter.</p><button class="small-button" data-action="notification-settings">Configure</button></div>
      <div class="card setting-card"><h3>API documentation</h3><p>Open Swagger UI or download the machine-readable OpenAPI 3.1 document.</p><button class="small-button" data-action="open-docs">Open docs</button></div>
    </div>`;
}

function render(view) {
  if (!permittedViews.includes(view)) {
    view = "dashboard";
  }
  const title = pageTitles[view] || "Dashboard";
  $("#pageTitle").textContent = title;
  $("#quickAction").textContent = quickLabels[view];
  $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
  $("#sidebar").classList.remove("open");
  if (view === "dashboard") renderDashboard();
  if (view === "members") renderMembers();
  if (view === "courts") renderCourts();
  if (view === "shop") renderShop();
  if (view === "cafeteria") renderCafeteria();
  if (view === "enquiries") renderEnquiries();
  if (view === "staff") renderStaff();
  if (view === "finance") renderFinance();
  if (view === "assistant") renderAssistant();
  if (view === "notifications") renderNotifications();
  if (view === "reports") renderReports();
  if (view === "settings") renderSettings();
}

function handleModalSubmit(event) {
  const action = event.currentTarget.dataset.submitModal;
  if (action === "add-member") {
    const name = $("#memberName").value.trim();
    const phone = $("#memberPhone").value.trim();
    if (!name || !phone) return toast("Name and phone are required");
    data.members.push({ id: `M-${Date.now().toString().slice(-4)}`, name, phone, plan: $("#memberPlan").value, expiry: $("#memberExpiry").value, balance: 0, dob: $("#memberDob").value });
  }
  if (action === "add-court-booking") {
    const courtId = $("#bookingCourt").value;
    const court = data.courts.find((item) => item.id === courtId);
    const memberId = $("#bookingMember").value;
    const date = $("#bookingDate").value;
    const time = $("#bookingTime").value;
    if (!court || !date || !time) return toast("Choose a court, date and available time");
    if (isSlotBooked(data.bookings, courtId, date, time)) return toast("Court conflict: that slot is already booked");
    data.bookings.push({ id: `B-${Date.now().toString().slice(-4)}`, memberId: memberId || null, courtId, court: court.name, date, time, status: "Confirmed", amount: memberId ? 900 : court.price });
    courtScheduleDate = date;
  }
  if (action === "add-product") {
    data.products.push({ id: `P-${Date.now()}`, sku: $("#productSku").value, name: $("#productName").value, category: $("#productCategoryModal").value, price: Number($("#productPrice").value), stock: Number($("#productStock").value), threshold: 5, icon: "📦" });
  }
  if (action === "open-tab") {
    const tableId = $("#tabTable").value;
    data.tabs.push({ id: `TAB-${Date.now().toString().slice(-4)}`, tableId, owner: $("#tabOwner").value, memberId: $("#tabMember").value || null, status: "Open", balance: 0 });
    const table = data.tables.find((item) => item.id === tableId);
    if (table) table.status = "Occupied";
  }
  if (action === "add-enquiry") {
    data.enquiries.push({ id: `E-${Date.now().toString().slice(-4)}`, name: $("#enquiryName").value, phone: $("#enquiryPhone").value, interest: $("#enquiryInterest").value, status: "New", followUp: $("#enquiryFollowUp").value });
  }
  if (action === "add-staff") {
    data.staff.push({ id: `S-${Date.now().toString().slice(-4)}`, name: $("#staffName").value, role: $("#staffRole").value, department: $("#staffDepartment").value, shift: $("#staffShift").value, leave: "Available", salary: Number($("#staffSalary").value) });
  }
  if (action === "add-invoice") {
    data.invoices.push({ id: `INV-${Date.now().toString().slice(-4)}`, customer: $("#invoiceCustomer").value, amount: Number($("#invoiceAmount").value), paid: 0, status: "Issued", due: $("#invoiceDue").value });
  }
  if (action === "add-menu-item") {
    data.menu.push({ id: `F-${Date.now()}`, name: $("#menuName").value, category: $("#menuCategory").value, price: Number($("#menuPrice").value), available: true });
  }
  save();
  closeModal();
  toast(sharedSyncEnabled ? "Changes saved locally; syncing…" : "Changes saved in this browser only");
  const active = $(".nav-item.active")?.dataset.view || "dashboard";
  render(active);
}

function handleAction(action) {
  if (!action) return;
  if (action === "logout" || action === "switch-account") {
    sessionStorage.removeItem("playpulseSession");
    fetch("/api/v1/auth/demo-logout", { method: "POST" }).finally(() => {
      window.location.replace("/");
    });
    return;
  }
  if (action.startsWith("view-member:")) {
    const member = memberById(action.split(":")[1]);
    openModal(`${member.name} · ${member.id}`, `<div class="form-grid"><div class="form-field"><label>Plan</label><input class="form-control" value="${member.plan}" readonly></div><div class="form-field"><label>Phone</label><input class="form-control" value="${member.phone}" readonly></div><div class="form-field"><label>Expiry</label><input class="form-control" value="${member.expiry}" readonly></div><div class="form-field"><label>Outstanding</label><input class="form-control" value="${money(member.balance)}" readonly></div></div>`, "Close", "close");
  }
  if (action.startsWith("renew-member:")) {
    const member = memberById(action.split(":")[1]);
    member.expiry = "2027-11-21";
    save();
    toast(`${member.name}'s membership renewed`);
    renderMembers();
  }
  if (action === "show-expiring") {
    toast("Showing members with expiry in November/December");
  }
  if (action === "open-court-modal") openCourtModal();
  if (action.startsWith("open-court-modal:")) {
    const [, courtId, time] = action.split(":");
    openCourtModal(courtId, time);
  }
  if (action.startsWith("sell-product:")) {
    const product = data.products.find((item) => item.id === action.split(":")[1]);
    if (!product.stock) return toast("This product is out of stock");
    product.stock--;
    data.transactions.push({ id: `T-${Date.now().toString().slice(-4)}`, source: "Shop", amount: product.price, method: "Counter", date: localDateValue(), status: "Recorded" });
    save();
    toast(`${product.name} sold`);
    renderShop();
  }
  if (action.startsWith("toggle-table:")) {
    const table = data.tables.find((item) => item.id === action.split(":")[1]);
    table.status = table.status === "Available" ? "Occupied" : "Available";
    save();
    toast(`Table ${table.number} marked ${table.status}`);
    renderCafeteria();
  }
  if (action.startsWith("add-menu:")) {
    window.cafeCart ||= [];
    const item = data.menu.find((menuItem) => menuItem.id === action.split(":")[1]);
    window.cafeCart.push(item);
    updateCart();
  }
  if (action === "clear-order") { window.cafeCart = []; updateCart(); }
  if (action === "checkout-tab") {
    if (!(window.cafeCart || []).length) return toast("Add at least one menu item");
    const total = window.cafeCart.reduce((sum, item) => sum + item.price, 0);
    data.transactions.push({ id: `T-${Date.now().toString().slice(-4)}`, source: "Cafeteria", amount: total, method: "Card / Split", date: localDateValue(), status: "Recorded" });
    window.cafeCart = [];
    save();
    updateCart();
    toast("Payment recorded and tab settled");
  }
  if (action === "refresh-kitchen") toast("Kitchen queue refreshed");
  if (action === "add-menu-product") openMenuModal();
  if (action.startsWith("follow-enquiry:")) {
    const enquiry = data.enquiries.find((item) => item.id === action.split(":")[1]);
    enquiry.status = "Follow-up";
    save();
    toast(`Follow-up added for ${enquiry.name}`);
    renderEnquiries();
  }
  if (action.startsWith("quote-enquiry:")) {
    const enquiry = data.enquiries.find((item) => item.id === action.split(":")[1]);
    enquiry.status = "Quoted";
    save();
    toast(`Quote prepared for ${enquiry.name}`);
    renderEnquiries();
  }
  if (action.startsWith("approve-leave:") || action.startsWith("reject-leave:")) {
    const [, id] = action.split(":");
    const leave = data.leave.find((item) => item.id === id);
    leave.status = action.startsWith("approve") ? "Approved" : "Rejected";
    const staff = data.staff.find((item) => item.id === leave.staffId);
    if (staff) staff.leave = leave.status;
    save();
    toast(`Leave ${leave.status.toLowerCase()}`);
    renderStaff();
  }
  if (action === "send-chat") sendChat();
  if (action === "clear-chat") {
    $("#chatMessages").innerHTML = `<div class="chat-message assistant">Chat cleared. Ask me another club operations question.</div>`;
  }
  if (action.startsWith("prompt-chat:")) sendChat(decodeURIComponent(action.slice("prompt-chat:".length)));
  if (action === "generate-reminders") {
    data.notifications.unshift({ id: `N-${Date.now()}`, type: "Reminder", title: "Monthly reminders", detail: "Expiry and low-stock reminders generated", status: "Unread", time: "Just now" });
    save();
    toast("Reminder outbox generated");
    renderNotifications();
  }
  if (action === "export-report") downloadExport();
  if (action === "export-finance") downloadCSV("performance", [["Source","Amount"], ...data.transactions.map((item) => [item.source, item.amount])]);
  if (action === "test-api") testApi();
  if (action === "reset-data") {
    data = structuredClone(defaultData);
    save();
    toast("Demo data reset");
    render("dashboard");
  }
  if (action === "open-docs") window.open("/api/v1/docs/", "_blank");
  if (action === "edit-club") toast("Club profile settings are ready for editing");
  if (action === "payment-settings") toast("Cash, card and UPI methods are enabled");
  if (action === "notification-settings") toast("In-app notifications are enabled");
}

function sendChat(forcedPrompt) {
  const input = $("#chatInput");
  const prompt = forcedPrompt || input?.value.trim();
  if (!prompt) return;
  const messages = $("#chatMessages");
  messages.insertAdjacentHTML("beforeend", `<div class="chat-message user">${escapeHtml(prompt)}</div>`);
  if (input) input.value = "";
  setTimeout(() => {
    messages.insertAdjacentHTML("beforeend", `<div class="chat-message assistant">${escapeHtml(assistantReply(prompt))}</div>`);
    messages.scrollTop = messages.scrollHeight;
  }, 180);
}

function openCourtModal(courtId = "", time = "18:00") {
  const date = $("#courtDate")?.value || courtScheduleDate;
  const courts = data.courts.filter((court) => court.status === "Available");
  const selectedCourtId = courts.some((court) => court.id === courtId) ? courtId : courts[0]?.id || "";
  const selectedTime = firstAvailableBookingTime(data.bookings, selectedCourtId, date, time);
  const timeOptions = bookingTimes.map((slot) => {
    const booked = isSlotBooked(data.bookings, selectedCourtId, date, slot);
    return `<option value="${slot}" ${slot === selectedTime ? "selected" : ""} ${booked ? "disabled" : ""}>${slot}${booked ? " — Booked" : ""}</option>`;
  }).join("");
  openModal("New court booking", `<div class="form-grid"><div class="form-field"><label>Member</label><select class="form-control" id="bookingMember"><option value="">Walk-in</option>${data.members.map((member) => `<option value="${member.id}">${escapeHtml(member.name)} — ${member.plan}</option>`).join("")}</select></div><div class="form-field"><label>Court</label><select class="form-control" id="bookingCourt">${courts.map((court) => `<option value="${court.id}" ${court.id === selectedCourtId ? "selected" : ""}>${escapeHtml(court.name)}</option>`).join("")}</select></div><div class="form-field"><label>Date</label><input class="form-control" id="bookingDate" type="date" value="${date}" required></div><div class="form-field"><label>Time</label><select class="form-control" id="bookingTime" required>${timeOptions}</select></div></div>`, "Confirm booking", "add-court-booking");
  const updateTimes = () => {
    const selectedDate = $("#bookingDate").value;
    const selectedCourt = $("#bookingCourt").value;
    const preferredTime = $("#bookingTime").value || time;
    $("#bookingTime").innerHTML = bookingTimes.map((slot) => {
      const booked = isSlotBooked(data.bookings, selectedCourt, selectedDate, slot);
      return `<option value="${slot}" ${booked ? "disabled" : ""}>${slot}${booked ? " — Booked" : ""}</option>`;
    }).join("");
    const availableTime = firstAvailableBookingTime(data.bookings, selectedCourt, selectedDate, preferredTime);
    $("#bookingTime").value = availableTime;
  };
  $("#bookingDate").addEventListener("change", updateTimes);
  $("#bookingCourt").addEventListener("change", updateTimes);
}

function openMenuModal() {
  openModal("Add menu item", `<div class="form-grid"><div class="form-field"><label>Name</label><input class="form-control" id="menuName"></div><div class="form-field"><label>Category</label><input class="form-control" id="menuCategory"></div><div class="form-field full"><label>Price</label><input class="form-control" id="menuPrice" type="number" min="0"></div></div>`, "Add item", "add-menu-item");
}

function downloadCSV(name, rows) {
  const csv = rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }));
  link.download = `playpulse-${name}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
  toast("CSV export generated");
}

function downloadExport() {
  const format = $("#reportFormat").value;
  const report = $("#reportType").value;
  if (format === "CSV") downloadCSV(report.toLowerCase().replaceAll(" ", "-"), [["Report","Value"],[report,money(data.transactions.reduce((sum, item) => sum + item.amount, 0))]]);
  else toast(`${report} ${format} export is ready for the prototype download`);
}

async function testApi() {
  const status = $("#connectionStatus");
  status.textContent = "Testing /health...";
  try {
    const response = await fetch("/health");
    const body = await response.json();
    status.textContent = `Connected: ${body.service} is ${body.status}.`;
  } catch {
    status.textContent = "Backend is unavailable. The demo remains usable.";
  }
}

function quickActionHandler() {
  const view = $(".nav-item.active")?.dataset.view || "dashboard";
  if (view === "dashboard" || view === "courts") openCourtModal();
  if (view === "members") openModal("Add member", `<div class="form-grid"><div class="form-field"><label>Name</label><input class="form-control" id="memberName"></div><div class="form-field"><label>Phone</label><input class="form-control" id="memberPhone"></div><div class="form-field"><label>Plan</label><select class="form-control" id="memberPlan"><option>Gold</option><option>Silver</option><option>Junior</option></select></div><div class="form-field"><label>Expiry</label><input class="form-control" id="memberExpiry" type="date" value="2027-11-21"></div><div class="form-field full"><label>Date of birth</label><input class="form-control" id="memberDob" type="date"></div></div>`, "Add member", "add-member");
  if (view === "shop") openModal("Add product", `<div class="form-grid"><div class="form-field"><label>SKU</label><input class="form-control" id="productSku"></div><div class="form-field"><label>Name</label><input class="form-control" id="productName"></div><div class="form-field"><label>Category</label><select class="form-control" id="productCategoryModal"><option>Rackets</option><option>Footwear</option><option>Balls</option><option>Apparel</option><option>Accessories</option></select></div><div class="form-field"><label>Price</label><input class="form-control" id="productPrice" type="number" min="0"></div><div class="form-field full"><label>Opening stock</label><input class="form-control" id="productStock" type="number" min="0"></div></div>`, "Add product", "add-product");
  if (view === "cafeteria") openModal("Open customer tab", `<div class="form-grid"><div class="form-field"><label>Owner</label><input class="form-control" id="tabOwner"></div><div class="form-field"><label>Member</label><select class="form-control" id="tabMember"><option value="">Guest</option>${data.members.map((member) => `<option value="${member.id}">${escapeHtml(member.name)}</option>`).join("")}</select></div><div class="form-field full"><label>Table</label><select class="form-control" id="tabTable">${data.tables.map((table) => `<option value="${table.id}">Table ${table.number}</option>`).join("")}</select></div></div>`, "Open tab", "open-tab");
  if (view === "enquiries") openModal("New enquiry", `<div class="form-grid"><div class="form-field"><label>Name</label><input class="form-control" id="enquiryName"></div><div class="form-field"><label>Phone</label><input class="form-control" id="enquiryPhone"></div><div class="form-field"><label>Interest</label><input class="form-control" id="enquiryInterest"></div><div class="form-field"><label>Follow-up</label><input class="form-control" id="enquiryFollowUp" type="date" value="2026-11-22"></div></div>`, "Add enquiry", "add-enquiry");
  if (view === "staff") openModal("Add staff", `<div class="form-grid"><div class="form-field"><label>Name</label><input class="form-control" id="staffName"></div><div class="form-field"><label>Role</label><input class="form-control" id="staffRole"></div><div class="form-field"><label>Department</label><input class="form-control" id="staffDepartment"></div><div class="form-field"><label>Shift</label><input class="form-control" id="staffShift" value="08:00–16:00"></div><div class="form-field full"><label>Monthly salary</label><input class="form-control" id="staffSalary" type="number"></div></div>`, "Add staff", "add-staff");
  if (view === "finance") openModal("New invoice", `<div class="form-grid"><div class="form-field"><label>Customer</label><input class="form-control" id="invoiceCustomer"></div><div class="form-field"><label>Amount</label><input class="form-control" id="invoiceAmount" type="number" min="0"></div><div class="form-field full"><label>Due date</label><input class="form-control" id="invoiceDue" type="date" value="2026-11-30"></div></div>`, "Create invoice", "add-invoice");
  if (view === "assistant") { const input = $("#chatInput"); input?.focus(); }
  if (view === "notifications") handleAction("generate-reminders");
  if (view === "reports") handleAction("export-report");
  if (view === "settings") toast("Settings saved");
}

document.addEventListener("click", (event) => {
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) render(viewButton.dataset.view);
  const viewLink = event.target.closest("[data-view-link]");
  if (viewLink) render(viewLink.dataset.viewLink);
  const action = event.target.closest("[data-action]");
  if (action) handleAction(action.dataset.action);
});

$("#quickAction").addEventListener("click", quickActionHandler);
$("#notificationButton").addEventListener("click", () => render("notifications"));
$("#menuButton").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
$("#modalBackdrop").addEventListener("click", (event) => {
  if (event.target === event.currentTarget) closeModal();
});

const today = new Date();
$("#currentDate").textContent = new Intl.DateTimeFormat("en-IN", {
  weekday: "long", day: "numeric", month: "long", year: "numeric"
}).format(today);
void initializeSharedData();
