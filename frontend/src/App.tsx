import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Activity, ArrowLeft, ArrowRight, Bell, CalendarDays, Check, CircleDollarSign,
  ClipboardList, Coffee, Dumbbell, LayoutDashboard, LogOut, Menu, Package, Search, Settings,
  ShieldCheck, ShoppingBag, Sparkles, Users, X,
} from "lucide-react";
import { apiRequest, ApiRequestError, type ApiEnvelope } from "./api";
import { initialDemoState } from "./data";
import { bookingTimes, isSlotBooked } from "../booking.js";
import type { Booking } from "../booking.js";
import type { DemoRole, DemoRow, DemoSession, DemoState, ModuleKey, PublicState, SyncStatus } from "./types";

const navigation = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "members", label: "Members", icon: Users },
  { key: "courts", label: "Courts & bookings", icon: CalendarDays },
  { key: "shop", label: "Sports shop", icon: ShoppingBag },
  { key: "cafeteria", label: "Cafeteria", icon: Coffee },
  { key: "enquiries", label: "Enquiries", icon: ClipboardList },
  { key: "staff", label: "Staff & leave", icon: ShieldCheck },
  { key: "finance", label: "Finance", icon: CircleDollarSign },
  { key: "assistant", label: "Smart assistant", icon: Sparkles },
  { key: "notifications", label: "Notifications", icon: Bell },
  { key: "reports", label: "Reports", icon: Activity },
  { key: "settings", label: "Settings", icon: Settings },
] as const;

type ViewKey = typeof navigation[number]["key"];
type FieldDefinition = { name: string; label: string; type?: string; options?: string[] };

const moduleConfig: Partial<Record<ViewKey, { title: string; arrays: ModuleKey[]; fields?: FieldDefinition[] }>> = {
  members: { title: "Members", arrays: ["members"], fields: [
    { name: "name", label: "Full name" }, { name: "plan", label: "Plan", options: ["Gold", "Silver", "Junior"] },
    { name: "phone", label: "Phone" }, { name: "expiry", label: "Membership expiry", type: "date" },
    { name: "balance", label: "Account balance", type: "number" },
  ] },
  courts: { title: "Courts & bookings", arrays: ["courts", "bookings"], fields: [
    { name: "name", label: "Court name" }, { name: "sport", label: "Sport" },
    { name: "price", label: "Hourly price", type: "number" }, { name: "status", label: "Status", options: ["Available", "Maintenance"] },
  ] },
  shop: { title: "Sports shop", arrays: ["products", "orders"], fields: [
    { name: "name", label: "Product name" }, { name: "sku", label: "SKU" },
    { name: "category", label: "Category" }, { name: "price", label: "Price", type: "number" },
    { name: "stock", label: "Stock", type: "number" }, { name: "threshold", label: "Low-stock threshold", type: "number" },
  ] },
  cafeteria: { title: "Cafeteria", arrays: ["menu", "tables", "tabs", "kitchen"], fields: [
    { name: "name", label: "Menu item" }, { name: "category", label: "Category" },
    { name: "price", label: "Price", type: "number" }, { name: "available", label: "Available", options: ["true", "false"] },
  ] },
  enquiries: { title: "Enquiries & trials", arrays: ["enquiries"], fields: [
    { name: "name", label: "Name" }, { name: "phone", label: "Phone" }, { name: "interest", label: "Interest" },
    { name: "status", label: "Status", options: ["New", "Follow-up", "Quoted", "Converted"] },
    { name: "followUp", label: "Follow-up date", type: "date" },
  ] },
  staff: { title: "Staff & leave", arrays: ["staff", "leave"], fields: [
    { name: "name", label: "Staff name" }, { name: "role", label: "Role" }, { name: "department", label: "Department" },
    { name: "shift", label: "Shift" }, { name: "salary", label: "Monthly salary", type: "number" },
  ] },
  finance: { title: "Finance", arrays: ["transactions", "expenses", "invoices"], fields: [
    { name: "customer", label: "Customer / description" }, { name: "amount", label: "Amount", type: "number" },
    { name: "paid", label: "Paid amount", type: "number" }, { name: "due", label: "Due date", type: "date" },
  ] },
  notifications: { title: "Notifications", arrays: ["notifications"] },
  reports: { title: "Reports & exports", arrays: ["transactions", "expenses", "invoices"] },
  settings: { title: "Club settings", arrays: ["plans", "courts"] },
};

const roleViews: Record<DemoRole, ViewKey[]> = {
  admin: navigation.map((item) => item.key),
  manager: navigation.filter((item) => item.key !== "settings").map((item) => item.key),
  staff: ["dashboard", "courts", "shop", "cafeteria", "enquiries", "assistant", "notifications"],
  front_desk: ["dashboard", "members", "courts", "enquiries", "notifications"],
  member: [],
  visitor: [],
};

const todayValue = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};
const text = (value: unknown) => value === null || value === undefined ? "—" : String(value);
const money = (value: unknown) => new Intl.NumberFormat("en-IN", {
  style: "currency", currency: "INR", maximumFractionDigits: 0,
}).format(Number(value) || 0);
const displayDate = (value: string) => new Intl.DateTimeFormat("en-IN", {
  day: "numeric", month: "short", year: "numeric",
}).format(new Date(`${value.slice(0, 10)}T00:00:00`));
const bookingRows = (rows: DemoRow[]): Booking[] => rows.filter((row): row is DemoRow & Booking =>
  typeof row.courtId === "string" && typeof row.date === "string" && typeof row.time === "string");

function useDemoSession() {
  const [session, setSession] = useState<DemoSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void apiRequest<ApiEnvelope<DemoSession | null>>("/api/v1/auth/demo-session")
      .then((response) => { if (active) setSession(response.data); })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "Could not check the sign-in session"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  return { session, setSession, loading, error };
}

function useStaffData(active: boolean) {
  const [data, setData] = useState<DemoState | null>(null);
  const [version, setVersion] = useState(0);
  const [status, setStatus] = useState<SyncStatus>("connecting");
  const versionRef = useRef(0);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const saveData = useCallback(async (nextData: DemoState) => {
    setData(nextData);
    const operation = saveQueue.current.then(async () => {
      const snapshotVersion = versionRef.current;
      const response = await apiRequest<ApiEnvelope<{ version: number }>>("/api/v1/demo-data", {
        method: "PUT",
        body: JSON.stringify({ version: snapshotVersion, data: nextData }),
      });
      versionRef.current = response.data.version;
      setVersion(response.data.version);
      setStatus("live");
    });
    saveQueue.current = operation.catch(() => undefined);
    return operation.catch(async (cause: unknown) => {
      setStatus("error");
      if (cause instanceof ApiRequestError && cause.status === 409) {
        await refreshData();
        throw new Error("Shared data changed elsewhere. The latest version was loaded; retry your change.");
      }
      throw cause;
    });
  }, []);
  const refreshData = useCallback(async () => {
    const response = await apiRequest<ApiEnvelope<{ state: DemoState | null; version: number }>>("/api/v1/demo-data");
    if (response.data.state) {
      if (response.data.version >= versionRef.current) {
        versionRef.current = response.data.version;
        setData(response.data.state);
        setVersion(response.data.version);
      }
    } else {
      await saveData(initialDemoState);
    }
    setStatus("live");
  }, [saveData]);

  useEffect(() => {
    if (!active) return;
    let disposed = false;
    let retryTimer: number | undefined;
    let retryDelay = 1000;
    let source: EventSource | undefined;
    const initialize = async () => {
      try {
        await refreshData();
        if (disposed) return;
        retryDelay = 1000;
        source = new EventSource("/api/v1/demo-data/events");
        source.onopen = () => {
          if (!disposed) {
            setStatus("live");
            void refreshData().catch((cause: unknown) => {
              console.error("Could not refresh shared club data", cause);
              setStatus("error");
            });
          }
        };
        source.onmessage = (event) => {
          try {
            const notice: { version: number } = JSON.parse(event.data);
            if (notice.version > versionRef.current) {
              void refreshData().catch((cause: unknown) => {
                console.error("Could not apply a shared data update", cause);
                setStatus("error");
              });
            }
          } catch (cause) {
            console.error("Could not read the live update", cause);
            setStatus("error");
          }
        };
        source.onerror = () => { if (!disposed) setStatus("connecting"); };
      } catch (cause) {
        if (disposed) return;
        console.error("Shared club data is unavailable", cause);
        setStatus("error");
        retryTimer = window.setTimeout(() => void initialize(), retryDelay);
        retryDelay = Math.min(retryDelay * 2, 30000);
      }
    };
    void initialize();
    return () => {
      disposed = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      source?.close();
    };
  }, [active, refreshData]);

  return { data, version, status, saveData, refreshData };
}

function usePublicData(active: boolean) {
  const [data, setData] = useState<PublicState | null>(null);
  const [status, setStatus] = useState<SyncStatus>("connecting");
  const versionRef = useRef(0);
  const refresh = useCallback(async () => {
    const response = await apiRequest<ApiEnvelope<{ state: PublicState | null; version: number }>>("/api/v1/demo-data/public");
    if (response.data.state && response.data.version >= versionRef.current) {
      versionRef.current = response.data.version;
      setData({ ...response.data.state, version: response.data.version });
    }
    setStatus("live");
  }, []);
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    let source: EventSource | undefined;
    let retryTimer: number | undefined;
    let delay = 1000;
    const connect = async () => {
      try {
        await refresh();
        if (disposed) return;
        source = new EventSource("/api/v1/demo-data/public/events");
        source.onopen = () => {
          delay = 1000;
          setStatus("live");
          void refresh().catch((cause: unknown) => { console.error("Public data refresh failed", cause); setStatus("error"); });
        };
        source.onmessage = () => {
          void refresh().catch((cause: unknown) => { console.error("Could not apply a public update", cause); setStatus("error"); });
        };
        source.onerror = () => {
          if (disposed) return;
          source?.close();
          setStatus("connecting");
          retryTimer = window.setTimeout(() => void connect(), delay);
          delay = Math.min(delay * 2, 30000);
        };
      } catch (cause) {
        if (disposed) return;
        console.error("Public club data is unavailable", cause);
        setStatus("error");
        retryTimer = window.setTimeout(() => void connect(), delay);
        delay = Math.min(delay * 2, 30000);
      }
    };
    void connect();
    return () => {
      disposed = true;
      source?.close();
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [active, refresh]);
  return { data, status, refresh };
}

function App() {
  const path = window.location.pathname;
  const { session, setSession, loading, error } = useDemoSession();
  const [roleChoice, setRoleChoice] = useState<"admin" | "member">("admin");
  const [view, setView] = useState<ViewKey>("dashboard");
  const [publicView, setPublicView] = useState("home");
  const staff = useStaffData(Boolean(session && session.role !== "visitor" && session.role !== "member"));
  const publicSync = usePublicData(path === "/visitor" || path === "/portal" || session?.role === "member");
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);
  const allowedViews = session ? roleViews[session.role] ?? [] : [];
  const currentView = allowedViews.includes(view) ? view : allowedViews[0] ?? "dashboard";

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  }, []);

  useEffect(() => {
    if (loading) return;
    if (path === "/admin" && (!session || !(["admin", "manager", "staff", "front_desk"] as string[]).includes(session.role))) {
      window.location.replace("/");
    } else if (path === "/portal" && new URLSearchParams(location.search).get("mode") === "member" && session?.role !== "member") {
      window.location.replace("/");
    }
  }, [loading, path, session]);

  useEffect(() => {
    if (currentView !== view) setView(currentView);
  }, [currentView, view]);

  const signOut = async () => {
    try {
      await apiRequest<ApiEnvelope<{ signedOut: boolean }>>("/api/v1/auth/demo-logout", { method: "POST" });
      setSession(null);
      window.location.assign("/");
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Could not log out");
    }
  };

  const signIn = async (email: string, password: string, role: "admin" | "member" | "visitor") => {
    setBusy(true);
    try {
      const response = await apiRequest<ApiEnvelope<DemoSession>>("/api/v1/auth/demo-login", {
        method: "POST", body: JSON.stringify({ email, password, role }),
      });
      setSession(response.data);
      window.location.assign(role === "admin" ? "/admin" : role === "member" ? "/portal?mode=member" : "/visitor");
    } finally {
      setBusy(false);
    }
  };

  const bookCourt = async (courtId: string, date: string, time: string) => {
    setBusy(true);
    try {
      await apiRequest<ApiEnvelope<unknown>>("/api/v1/demo-data/public/bookings", {
        method: "POST", body: JSON.stringify({ courtId, date, time }),
      });
      await publicSync.refresh();
      if (session && !["member", "visitor"].includes(session.role)) await staff.refreshData();
      notify("Booking confirmed and synchronized with the club");
    } catch (cause) {
      if (cause instanceof ApiRequestError && cause.status === 409) {
        await publicSync.refresh();
        notify("That slot was just booked. Availability has been refreshed.");
      } else {
        notify(cause instanceof Error ? cause.message : "Booking could not be completed");
      }
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingPage label="Checking your secure session…" />;
  if (path === "/" || path === "/login") {
    return <LoginPage
      roleChoice={roleChoice}
      setRoleChoice={setRoleChoice}
      busy={busy}
      error={error}
      onSignIn={(email, password) => signIn(email, password, roleChoice)}
      onVisitor={() => signIn("visitor@champions.club", "Visitor@123", "visitor")}
    />;
  }
  if (path === "/visitor" || path === "/portal") {
    const memberMode = session?.role === "member" && (path === "/portal" || new URLSearchParams(location.search).get("mode") === "member");
    return <PublicPortal
      memberMode={memberMode}
      member={publicSync.data?.member ?? null}
      data={publicSync.data}
      status={publicSync.status}
      selectedView={publicView}
      setSelectedView={setPublicView}
      busy={busy}
      onBook={bookCourt}
      onLogout={signOut}
      notify={notify}
      toast={toast}
    />;
  }
  if (!session || !(roleViews[session.role]?.length)) return <LoadingPage label="Opening your workspace…" />;

  const selectedNavigation = navigation.find((item) => item.key === currentView) ?? navigation[0];
  return <AdminWorkspace
    session={session}
    view={currentView}
    title={selectedNavigation.label}
    allowedViews={allowedViews}
    data={staff.data}
    syncStatus={staff.status}
    saving={busy}
    onNavigate={setView}
    onLogout={signOut}
    onCreate={async (key, record) => {
      if (!staff.data) return;
      const nextState = { ...staff.data, [key]: [...staff.data[key], record] };
      setBusy(true);
      try {
        await staff.saveData(nextState);
        notify("Record saved and synced");
      } catch (cause) {
        notify(cause instanceof Error ? cause.message : "Could not save this record");
        throw cause;
      } finally {
        setBusy(false);
      }
    }}
    onBook={bookCourt}
    onUpdate={async (key, id, update) => {
      if (!staff.data) return;
      const nextState = { ...staff.data, [key]: staff.data[key].map((row) => row.id === id ? { ...row, ...update } : row) };
      setBusy(true);
      try {
        await staff.saveData(nextState);
        notify("Update saved and synced");
      } catch (cause) {
        notify(cause instanceof Error ? cause.message : "Could not save the update");
      } finally {
        setBusy(false);
      }
    }}
    notify={notify}
  >
    {toast && <div className="toast-message" role="status">{toast}</div>}
  </AdminWorkspace>;
}

function LoadingPage({ label }: { label: string }) {
  return <main className="loading-page"><span className="brand-mark">P</span><strong>PlayPulse</strong><p>{label}</p></main>;
}

function LoginPage({ roleChoice, setRoleChoice, busy, error, onSignIn, onVisitor }: {
  roleChoice: "admin" | "member";
  setRoleChoice: (role: "admin" | "member") => void;
  busy: boolean;
  error: string;
  onSignIn: (email: string, password: string) => Promise<void>;
  onVisitor: () => Promise<void>;
}) {
  const [email, setEmail] = useState("admin@champions.club");
  const [password, setPassword] = useState("Admin@123");
  const [message, setMessage] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const visit = async () => {
    setMessage("");
    try { await onVisitor(); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : "Visitor access is unavailable"); }
  };
  const selectRole = (role: "admin" | "member") => {
    setRoleChoice(role);
    setEmail(role === "admin" ? "admin@champions.club" : "member@champions.club");
    setPassword(role === "admin" ? "Admin@123" : "Member@123");
    setMessage("");
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage("");
    try { await onSignIn(email.trim(), password); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : "Sign-in failed"); }
  };
  return <main className="login-page">
    <section className="login-visual">
      <a className="visual-brand" href="/"><span>P</span><div><strong>PlayPulse</strong><small>Champions Club</small></div></a>
      <div className="visual-copy"><p>One club. Every operation.</p><h1>Play better.<br />Manage smarter.</h1>
        <div className="visual-stats"><div><strong>4</strong><span>Sports</span></div><div><strong>12</strong><span>Courts & nets</span></div><div><strong>1</strong><span>Unified platform</span></div></div>
      </div>
    </section>
    <section className="login-panel"><div className="login-card">
      <p className="eyebrow">CHAMPIONS CLUB</p><h2>Welcome to PlayPulse</h2><p className="subtitle">Sign in to your workspace or explore the club as a visitor.</p>
      <div className="role-tabs" aria-label="Login role">
        <button className={roleChoice === "admin" ? "active" : ""} onClick={() => selectRole("admin")}>Admin</button>
        <button className={roleChoice === "member" ? "active" : ""} onClick={() => selectRole("member")}>Member</button>
        <button onClick={() => void visit()}>Visitor</button>
      </div>
      <form onSubmit={(event) => void submit(event)}>
        <label>Email address<input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>Password<div className="password-field"><input type={showPassword ? "text" : "password"} autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /><button type="button" onClick={() => setShowPassword(!showPassword)}>{showPassword ? "Hide" : "Show"}</button></div></label>
        <button className="login-button" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
      <div className="demo-credentials"><div><span>Demo email</span><strong>{roleChoice === "admin" ? "admin@champions.club" : "member@champions.club"}</strong></div><div><span>Demo password</span><strong>{roleChoice === "admin" ? "Admin@123" : "Member@123"}</strong></div></div>
      <p className="login-error" role="alert">{message || error}</p>
    </div></section>
  </main>;
}

function AdminWorkspace({ session, view, title, allowedViews, data, syncStatus, saving, onNavigate, onLogout, onCreate, onBook, onUpdate, notify, children }: {
  session: DemoSession;
  view: ViewKey;
  title: string;
  allowedViews: ViewKey[];
  data: DemoState | null;
  syncStatus: SyncStatus;
  saving: boolean;
  onNavigate: (view: ViewKey) => void;
  onLogout: () => Promise<void>;
  onCreate: (key: ModuleKey, record: DemoRow) => Promise<void>;
  onBook: (courtId: string, date: string, time: string) => Promise<void>;
  onUpdate: (key: ModuleKey, id: unknown, update: Partial<DemoRow>) => Promise<void>;
  notify: (message: string) => void;
  children: React.ReactNode;
}) {
  const [mobileNav, setMobileNav] = useState(false);
  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav ? "open" : ""}`}>
      <a className="brand" href="/admin"><span className="brand-mark">P</span><span><strong>PlayPulse</strong><small>Champions Club</small></span></a>
      <nav className="main-nav" aria-label="Main navigation">
        {navigation.filter((item) => allowedViews.includes(item.key)).map(({ key, label, icon: Icon }) =>
          <button key={key} className={`nav-item ${key === view ? "active" : ""}`} onClick={() => { onNavigate(key); setMobileNav(false); }}>
            <Icon size={18} /><span>{label}</span>
          </button>)}
      </nav>
      <div className="sidebar-footer">
        <div className="profile"><span className="profile-avatar">{session.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("")}</span><span><strong>{session.name}</strong><small>{session.role.replace("_", " ")}</small></span></div>
        <a className="nav-item" href="/"><ArrowLeft size={18} /><span>Switch account</span></a>
        <button className="nav-item" onClick={() => void onLogout()}><LogOut size={18} /><span>Log out</span></button>
      </div>
    </aside>
    <main className="main">
      <header className="topbar"><div className="topbar-title"><button className="menu-button" aria-label="Open menu" onClick={() => setMobileNav(!mobileNav)}><Menu size={19} /></button><div><p>{new Intl.DateTimeFormat("en-IN", { dateStyle: "full" }).format(new Date())}</p><h1>{title}</h1></div></div>
        <div className="topbar-actions"><SyncIndicator status={syncStatus} saving={saving} /><span className="avatar-small">{session.name.slice(0, 1)}</span></div>
      </header>
      <section className="app-view">
        {!data ? <div className="empty-state"><Activity /><strong>Connecting to shared club data</strong><span>Live data will appear as soon as the database responds.</span></div> :
          view === "dashboard" ? <Dashboard data={data} onNavigate={onNavigate} /> :
          view === "courts" ? <AdminCourts data={data} onBook={onBook} notify={notify} saving={saving} /> :
          view === "assistant" ? <AssistantPanel data={data} /> :
          <AdminModule view={view} data={data} saving={saving} onCreate={onCreate} onUpdate={onUpdate} />}
      </section>
    </main>
    {children}
  </div>;
}

function SyncIndicator({ status, saving }: { status: SyncStatus; saving: boolean }) {
  const label = saving ? "Saving…" : status === "live" ? "Live sync" : status === "error" ? "Sync issue" : "Reconnecting";
  return <span className={`sync-indicator ${status}`} role="status" aria-live="polite"><i />{label}</span>;
}

function Dashboard({ data, onNavigate }: { data: DemoState; onNavigate: (view: ViewKey) => void }) {
  const revenue = data.transactions.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const pendingInvoices = data.invoices.filter((invoice) => Number(invoice.paid || 0) < Number(invoice.amount || 0)).length;
  const lowStock = data.products.filter((product) => Number(product.stock || 0) <= Number(product.threshold || 0));
  const stats = [
    { title: "Members", value: data.members.length, note: "Active club records", icon: Users },
    { title: "Court bookings", value: data.bookings.length, note: "Shared reservations", icon: CalendarDays },
    { title: "Recorded revenue", value: money(revenue), note: "Across all channels", icon: CircleDollarSign },
    { title: "Outstanding invoices", value: pendingInvoices, note: "Need follow-up", icon: ClipboardList },
  ];
  return <><div className="welcome-row"><div><span className="eyebrow">CLUB OVERVIEW</span><h2>Good day, operations team</h2><p>Your club operations and shared data at a glance.</p></div><button className="primary-button" onClick={() => onNavigate("courts")}><CalendarDays size={16} /> View court schedule</button></div>
    <div className="stats-grid">{stats.map(({ title, value, note, icon: Icon }) => <article className="card stat-card" key={title}><div className="stat-top"><span>{title}</span><span className="stat-icon"><Icon size={18} /></span></div><strong className="stat-value">{value}</strong><small className="stat-note">{note}</small></article>)}</div>
    <div className="content-grid dashboard-grid">
      <section className="card"><div className="card-header"><div><h3>Recent bookings</h3><p>Updates appear across staff and member views.</p></div><button className="text-button" onClick={() => onNavigate("courts")}>View schedule <ArrowRight size={14} /></button></div>
        <DataTable rows={data.bookings.slice(0, 6)} empty="No court bookings yet." />
      </section>
      <section className="card"><div className="card-header"><div><h3>Attention needed</h3><p>Operational reminders from shared records.</p></div></div>
        {lowStock.length === 0 && pendingInvoices === 0 && <p className="muted">Everything looks up to date.</p>}
        {lowStock.map((product) => <div className="alert-row" key={text(product.id)}><Package size={17} /><span><strong>{text(product.name)}</strong><small>{text(product.stock)} units remaining</small></span><button onClick={() => onNavigate("shop")}>Review</button></div>)}
        {pendingInvoices > 0 && <div className="alert-row"><CircleDollarSign size={17} /><span><strong>{pendingInvoices} unpaid invoices</strong><small>Review payments and due dates</small></span><button onClick={() => onNavigate("finance")}>Review</button></div>}
      </section>
    </div>
  </>;
}

function DataTable({ rows, empty }: { rows: DemoRow[]; empty: string }) {
  const columns = useMemo(() => rows[0] ? Object.keys(rows[0]).filter((key) => key !== "icon").slice(0, 7) : [], [rows]);
  if (!rows.length) return <p className="empty-inline">{empty}</p>;
  return <div className="table-wrap"><table className="data-table"><thead><tr>{columns.map((column) => <th key={column}>{column.replace(/[A-Z]/g, (letter) => ` ${letter}`).toUpperCase()}</th>)}</tr></thead>
    <tbody>{rows.map((row, index) => <tr key={text(row.id) === "—" ? index : text(row.id)}>{columns.map((column) => <td key={column}>{formatCell(row[column])}</td>)}</tr>)}</tbody>
  </table></div>;
}

function formatCell(value: unknown) {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number" && value > 500) return money(value);
  return text(value);
}

function AdminModule({ view, data, saving, onCreate, onUpdate }: {
  view: ViewKey; data: DemoState; saving: boolean; onCreate: (key: ModuleKey, record: DemoRow) => Promise<void>;
  onUpdate: (key: ModuleKey, id: unknown, update: Partial<DemoRow>) => Promise<void>;
}) {
  const config = moduleConfig[view];
  const [search, setSearch] = useState("");
  const [createKey, setCreateKey] = useState<ModuleKey | null>(null);
  if (!config) return null;
  const keys = config.arrays;
  const canCreate = Boolean(config.fields?.length && keys[0] && !["notifications", "reports", "settings"].includes(view));
  const shown = (rows: DemoRow[]) => rows.filter((row) => Object.values(row).some((value) => text(value).toLowerCase().includes(search.toLowerCase())));
  return <><div className="welcome-row"><div><span className="eyebrow">OPERATIONS</span><h2>{config.title}</h2><p>Manage club records using shared, live data.</p></div>{canCreate && <button className="primary-button" onClick={() => setCreateKey(keys[0])}>+ Add record</button>}</div>
    {view === "shop" && <div className="notice-card"><Package size={18} /> Product stock, catalog, and orders are synchronized with the visitor-facing catalog.</div>}
    {view === "cafeteria" && <div className="notice-card"><Coffee size={18} /> Kitchen queue, open tabs, tables, and menu availability.</div>}
    {view === "reports" && <div className="notice-card"><ClipboardList size={18} /> Reports are based on recorded transactions, expenses, and invoice payments.</div>}
    {view !== "settings" && <div className="toolbar"><label className="search-box"><Search size={17} /><input placeholder={`Search ${config.title.toLowerCase()}`} value={search} onChange={(event) => setSearch(event.target.value)} /></label><span className="record-count">{keys.reduce((total: number, key) => total + data[key].length, 0)} records</span></div>}
    <div className="module-grid">{keys.map((key) => <section className="card" key={key}><div className="card-header"><div><h3>{labelFor(key)}</h3><p>{data[key].length} shared records</p></div>
      {key === "leave" && data[key].some((row) => row.status === "Pending") && <span className="status-pill warning">Needs review</span>}</div>
      {key === "leave" ? <LeaveTable rows={shown(data[key])} onUpdate={(id, patch) => onUpdate(key, id, patch)} /> : <DataTable rows={shown(data[key])} empty={`No ${labelFor(key).toLowerCase()} to display.`} />}
    </section>)}</div>
    {createKey && config.fields && <RecordDialog key={createKey} moduleKey={createKey} fields={config.fields} saving={saving} onClose={() => setCreateKey(null)} onSave={async (record) => {
      await onCreate(createKey, { id: `${prefixFor(createKey)}-${Date.now()}`, ...record });
      setCreateKey(null);
    }} />}
    {view === "settings" && <div className="notice-card"><Settings size={18} /> Settings access is restricted to administrators. Plans and facility information are visible here; use the dedicated API for sensitive configuration.</div>}
    {view === "assistant" && <p className="muted">Assistant is ready.</p>}
    {saving && <span className="sr-only" role="status">Saving shared data</span>}
  </>;
}

function labelFor(key: string) {
  return ({ menu: "Menu", tables: "Tables", tabs: "Customer tabs", kitchen: "Kitchen queue", leave: "Leave requests", transactions: "Transactions", invoices: "Invoices", expenses: "Expenses", plans: "Membership plans", courts: "Facilities" } as Record<string, string>)[key] ?? key[0].toUpperCase() + key.slice(1);
}
function prefixFor(key: string) {
  return ({ members: "M", courts: "C", products: "P", menu: "F", enquiries: "E", staff: "S" } as Record<string, string>)[key] ?? key.slice(0, 3).toUpperCase();
}

function LeaveTable({ rows, onUpdate }: { rows: DemoRow[]; onUpdate: (id: unknown, patch: Partial<DemoRow>) => Promise<void> }) {
  if (!rows.length) return <p className="empty-inline">No leave requests to display.</p>;
  return <div className="table-wrap"><table className="data-table"><thead><tr><th>Staff</th><th>Dates</th><th>Reason</th><th>Status</th><th>Review</th></tr></thead><tbody>
    {rows.map((row, index) => <tr key={text(row.id) === "—" ? index : text(row.id)}><td>{text(row.name)}</td><td>{text(row.dates)}</td><td>{text(row.reason)}</td><td>{text(row.status)}</td><td>{row.status === "Pending" ? <div className="inline-actions"><button onClick={() => void onUpdate(row.id, { status: "Approved" })}>Approve</button><button onClick={() => void onUpdate(row.id, { status: "Rejected" })}>Reject</button></div> : "—"}</td></tr>)}
  </tbody></table></div>;
}

function RecordDialog({ moduleKey, fields, saving, onClose, onSave }: {
  moduleKey: ModuleKey; fields: FieldDefinition[]; saving: boolean; onClose: () => void; onSave: (record: DemoRow) => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const record = Object.fromEntries(fields.map((field) => {
      const value = values[field.name] ?? "";
      return [field.name, field.type === "number" ? Number(value) || 0 : field.name === "available" ? value === "true" : value];
    })) as DemoRow;
    if (!Object.values(values).some(Boolean)) { setError("Enter at least one value."); return; }
    try { await onSave(record); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save record"); }
  };
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="modal" role="dialog" aria-modal="true" aria-labelledby="record-dialog-title">
      <div className="modal-heading"><div><span className="eyebrow">NEW RECORD</span><h2 id="record-dialog-title">Add {labelFor(moduleKey).toLowerCase()}</h2></div><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={18} /></button></div>
      <form onSubmit={(event) => void submit(event)}><div className="form-grid">{fields.map((field) => <label className="form-field" key={field.name}>{field.label}
        {field.options ? <select value={values[field.name] ?? field.options[0]} onChange={(event) => setValues({ ...values, [field.name]: event.target.value })}>{field.options.map((option) => <option key={option}>{option}</option>)}</select> :
          <input required={["name", "price", "phone"].includes(field.name)} type={field.type ?? "text"} value={values[field.name] ?? ""} onChange={(event) => setValues({ ...values, [field.name]: event.target.value })} />}
      </label>)}</div><p className="login-error" role="alert">{error}</p><div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? "Saving…" : "Save record"}</button></div></form>
    </section>
  </div>;
}

function AdminCourts({ data, onBook, notify, saving }: { data: DemoState; onBook: (courtId: string, date: string, time: string) => Promise<void>; notify: (message: string) => void; saving: boolean }) {
  const [date, setDate] = useState(todayValue());
  const [courtId, setCourtId] = useState(String(data.courts.find((court) => court.status === "Available")?.id ?? ""));
  const [selectedTime, setSelectedTime] = useState("");
  const courts = data.courts.filter((court) => court.status === "Available");
  const activeBookings = bookingRows(data.bookings);
  const selectedCourt = courts.find((court) => court.id === courtId);
  const makeBooking = async () => {
    if (!selectedCourt || !selectedTime) { notify("Choose an available court and slot."); return; }
    if (isSlotBooked(activeBookings, courtId, date, selectedTime)) { notify("That slot is no longer available."); return; }
    await onBook(courtId, date, selectedTime);
  };
  return <><div className="welcome-row"><div><span className="eyebrow">FACILITIES</span><h2>Availability & reservations</h2><p>One-hour bookings with 30-minute start intervals.</p></div></div>
    <div className="schedule-controls"><label>Date<input type="date" min={todayValue()} value={date} onChange={(event) => { setDate(event.target.value); setSelectedTime(""); }} /></label><label>Court<select value={courtId} onChange={(event) => setCourtId(event.target.value)}>{courts.map((court) => <option key={String(court.id)} value={String(court.id)}>{text(court.name)}</option>)}</select></label></div>
    <div className="slot-grid">{bookingTimes.map((time) => {
      const booked = isSlotBooked(activeBookings, courtId, date, time);
      return <button key={time} className={`slot-card ${booked ? "booked" : ""} ${selectedTime === time ? "selected" : ""}`} disabled={booked} onClick={() => setSelectedTime(time)}>
        <span>{booked ? "Reserved" : "Available"}</span><strong>{time}</strong>{selectedTime === time && <Check size={16} />}
      </button>;
    })}</div>
    <div className="booking-action"><span>{selectedCourt ? `${text(selectedCourt.name)} · ${money(selectedCourt.price)} / hour` : "No available courts"}</span><button className="primary-button" disabled={!selectedTime || busyOrSaving(saving)} onClick={() => void makeBooking()}>{saving ? "Saving…" : "Confirm booking"}</button></div>
    <section className="card"><div className="card-header"><div><h3>Shared reservations</h3><p>New bookings appear here immediately after confirmation.</p></div></div><DataTable rows={data.bookings} empty="No bookings for the selected club yet." /></section>
  </>;
}
function busyOrSaving(value: boolean) { return value; }

function AssistantPanel({ data }: { data: DemoState }) {
  return <><div className="welcome-row"><div><span className="eyebrow">CLUB INTELLIGENCE</span><h2>Smart assistant</h2><p>Quick operational insights from the current shared snapshot.</p></div></div>
    <section className="card assistant-card"><Sparkles size={24} /><h3>Club operations brief</h3><p>{data.members.length} members, {data.bookings.length} reservations, and {data.products.filter((item) => Number(item.stock || 0) <= Number(item.threshold || 0)).length} products below their stock threshold.</p><ul><li>Review upcoming membership expiries from the Members page.</li><li>Use Courts & bookings to see the latest slot availability.</li><li>Check Finance for invoices and recorded transactions.</li></ul></section>
  </>;
}

function PublicPortal({ memberMode, member, data, status, selectedView, setSelectedView, busy, onBook, onLogout, notify, toast }: {
  memberMode: boolean; member: PublicState["member"]; data: PublicState | null; status: SyncStatus; selectedView: string; setSelectedView: (view: string) => void;
  busy: boolean; onBook: (courtId: string, date: string, time: string) => Promise<void>; onLogout: () => Promise<void>; notify: (message: string) => void; toast: string;
}) {
  return <div className="public-shell">
    <header className="public-header"><a className="brand public-brand" href="/"><span className="brand-mark">P</span><span><strong>PlayPulse</strong><small>Champions Club</small></span></a>
      <nav aria-label="Club navigation">{(memberMode ? ["home", "courts", "shop", "plans", "bookings", "account"] : ["home", "courts", "shop", "plans", "club"]).map((view) =>
        <button key={view} className={selectedView === view ? "active" : ""} onClick={() => setSelectedView(view)}>{view === "home" ? "Home" : view === "plans" ? "Membership" : view === "club" ? "The club" : view[0].toUpperCase() + view.slice(1)}</button>)}</nav>
      <div className="header-actions"><SyncIndicator status={status} saving={busy} />{memberMode ? <button className="account-button" onClick={() => void onLogout()}><LogOut size={15} /> Log out</button> : <a className="account-button" href="/">Member login</a>}</div>
    </header>
    {selectedView === "home" ? <PublicHome memberMode={memberMode} member={member} data={data} setView={setSelectedView} /> :
      selectedView === "courts" ? <PublicCourts data={data} onBook={onBook} busy={busy} notify={notify} /> :
      selectedView === "shop" ? <PublicShop data={data} /> :
      selectedView === "plans" ? <PublicPlans data={data} /> :
      selectedView === "bookings" && memberMode ? <MemberBookings data={data} member={member} setView={setSelectedView} /> :
      selectedView === "account" && memberMode ? <MemberAccount member={member} /> :
      <ClubOverview />}
    <footer className="public-footer"><div><strong>Champions Club</strong><span>Where every match begins.</span></div><div>Mon–Sun · 6:00 AM–10:00 PM</div><div>hello@champions.club</div></footer>
    {toast && <div className="toast-message" role="status">{toast}</div>}
  </div>;
}

function PublicHome({ memberMode, member, data, setView }: { memberMode: boolean; member: PublicState["member"]; data: PublicState | null; setView: (view: string) => void }) {
  return <><section className="public-hero"><div><span className="eyebrow">WELCOME TO CHAMPIONS CLUB</span><h1>{memberMode ? `Welcome back${member?.name ? `, ${member.name.split(" ")[0]}` : ""}.` : <>Find your court.<br />Own your game.</>}</h1><p>Tennis, padel, badminton and cricket. Explore the club, compare plans and book a court.</p><div className="hero-actions"><button className="primary-button" onClick={() => setView("courts")}>Explore court availability <ArrowRight size={16} /></button>{!memberMode && <button className="secondary-button" onClick={() => setView("plans")}>Membership plans</button>}</div></div><div className="hero-stat"><Dumbbell size={27} /><strong>{data?.courts.length ?? "—"}</strong><span>club facilities</span><div className="live-dot"><i /> Real-time availability</div></div></section>
    {memberMode && <MemberSummary member={member} data={data} setView={setView} />}
    <section className="public-section"><div className="section-title"><div><span className="eyebrow">THE CLUB</span><h2>Everything under one roof</h2></div><button className="text-button" onClick={() => setView("club")}>Discover the club <ArrowRight size={14} /></button></div>
      <div className="feature-grid">{[["Courts", "Live availability for all club sports."], ["Membership", "Flexible plans and clear member benefits."], ["Sports shop", "Equipment and essentials for your next match."], ["Cafeteria", "Food and drinks for before and after play."]].map(([title, detail]) => <article className="feature-card" key={title}><span className="feature-icon"><Dumbbell size={18} /></span><h3>{title}</h3><p>{detail}</p></article>)}</div>
    </section>
  </>;
}

function MemberSummary({ member, data, setView }: { member: PublicState["member"]; data: PublicState | null; setView: (view: string) => void }) {
  const bookings = data?.memberBookings ?? [];
  return <section className="member-summary"><div><span className="eyebrow">MEMBER OVERVIEW</span><h2>{member?.plan ?? "Member"} membership</h2><p>{member ? `ID ${member.id} · valid through ${displayDate(member.expiry)}` : "Membership details are not available."}</p></div><div className="summary-stats"><div><strong>{bookings.length}</strong><span>bookings</span></div><div><strong>{money(member?.balance)}</strong><span>account balance</span></div></div><button className="secondary-button" onClick={() => setView("bookings")}>My bookings</button></section>;
}

function PublicCourts({ data, onBook, busy, notify }: { data: PublicState | null; onBook: (courtId: string, date: string, time: string) => Promise<void>; busy: boolean; notify: (message: string) => void }) {
  const [date, setDate] = useState(todayValue());
  const [courtId, setCourtId] = useState("");
  const [time, setTime] = useState("");
  const courts = data?.courts ?? [];
  const activeCourtId = courtId || String(courts.find((court) => court.status === "Available")?.id ?? "");
  const selectedCourt = courts.find((court) => court.id === activeCourtId);
  const submit = () => {
    if (!selectedCourt || !time || selectedCourt.status !== "Available") { notify("Choose an available court, date and time."); return; }
    void onBook(activeCourtId, date, time);
  };
  return <main className="public-section"><div className="section-title"><div><span className="eyebrow">FACILITIES</span><h2>Courts & availability</h2><p>Choose an available slot. Reservations are shared with the club in real time.</p></div></div>
    <div className="court-layout"><div className="court-list">{courts.map((court) => <button key={court.id} className={`court-row ${court.id === activeCourtId ? "selected" : ""}`} disabled={court.status !== "Available"} onClick={() => { setCourtId(court.id); setTime(""); }}><span><strong>{court.name}</strong><small>{court.sport} · {money(court.price)} / hour</small></span><span className={`status-pill ${court.status === "Available" ? "success" : "warning"}`}>{court.status}</span></button>)}</div>
      <section className="card booking-card"><h3>Book a court</h3><label className="form-field">Date<input type="date" min={todayValue()} value={date} onChange={(event) => { setDate(event.target.value); setTime(""); }} /></label>
        <p className="field-label">Available start times</p><div className="time-options">{bookingTimes.map((slot) => {
          const booked = isSlotBooked(data?.bookings ?? [], activeCourtId, date, slot);
          return <button key={slot} className={time === slot ? "selected" : ""} disabled={booked || !selectedCourt || selectedCourt.status !== "Available"} onClick={() => setTime(slot)}>{slot}{booked && <small>Reserved</small>}</button>;
        })}</div><button className="primary-button full-width" disabled={busy || !time} onClick={submit}>{busy ? "Confirming…" : `Confirm booking${selectedCourt ? ` · ${money(selectedCourt.price)}` : ""}`}</button>
      </section>
    </div>
  </main>;
}

function PublicShop({ data }: { data: PublicState | null }) {
  return <main className="public-section"><div className="section-title"><div><span className="eyebrow">PLAY & PERFORM</span><h2>Club shop</h2><p>Browse the current club catalog.</p></div></div>
    <div className="product-grid">{(data?.products ?? []).map((product) => <article className="public-product" key={product.id}><div className="product-art">{product.icon ?? <Package size={28} />}</div><span className="eyebrow">{product.category}</span><h3>{product.name}</h3><strong>{money(product.price)}</strong></article>)}</div>
    {!data?.products.length && <p className="empty-inline">The catalog is being synchronized. Check back soon.</p>}
  </main>;
}

function PublicPlans({ data }: { data: PublicState | null }) {
  return <main className="public-section"><div className="section-title"><div><span className="eyebrow">MEMBERSHIP</span><h2>Choose how you play</h2><p>Transparent rates and benefits for every athlete.</p></div></div>
    <div className="plans-grid">{(data?.plans ?? []).map((plan) => <article className="plan-card" key={plan.name}><span className="eyebrow">{plan.name.toUpperCase()}</span><strong>{money(plan.price)}<small> / month</small></strong><ul><li>{plan.freeSessions} free sessions daily</li><li>{plan.courtDiscount}% court discount</li><li>{plan.shopDiscount}% shop discount</li><li>{plan.barDiscount}% cafeteria discount</li></ul></article>)}</div>
    {!data?.plans.length && <p className="empty-inline">Membership plans will appear when club data is available.</p>}
  </main>;
}

function MemberBookings({ data, member, setView }: { data: PublicState | null; member: PublicState["member"]; setView: (view: string) => void }) {
  const courtName = (id: string) => data?.courts.find((court) => court.id === id)?.name ?? "Court";
  return <main className="public-section"><div className="section-title"><div><span className="eyebrow">YOUR ACCOUNT</span><h2>My bookings</h2><p>{member?.name ?? "Member"} · upcoming reservations</p></div><button className="primary-button" onClick={() => setView("courts")}>Book a court</button></div>
    <div className="card"><DataTable rows={(data?.memberBookings ?? []).map((booking, index) => ({ id: `booking-${index}`, court: courtName(booking.courtId), date: displayDate(booking.date), time: booking.time, status: booking.status }))} empty="You have no upcoming bookings." /></div>
    <section className="member-orders"><h3>Recent orders</h3><div className="card"><DataTable rows={(data?.memberOrders ?? [])} empty="No recent shop orders." /></div></section>
  </main>;
}

function MemberAccount({ member }: { member: PublicState["member"] }) {
  return <main className="public-section"><div className="section-title"><div><span className="eyebrow">YOUR ACCOUNT</span><h2>Membership details</h2></div></div>
    <section className="member-account card">{[
      ["Member", member?.name], ["Member ID", member?.id], ["Plan", member?.plan],
      ["Renewal date", member?.expiry ? displayDate(member.expiry) : null], ["Phone", member?.phone],
      ["Outstanding balance", money(member?.balance)],
    ].map(([label, value]) => <div className="member-row" key={label}><span>{label}</span><strong>{value ?? "Details unavailable"}</strong></div>)}</section>
  </main>;
}

function ClubOverview() {
  return <main className="public-section"><div className="section-title"><div><span className="eyebrow">ABOUT CHAMPIONS CLUB</span><h2>Find your next game</h2><p>A welcoming home for tennis, padel, badminton and cricket.</p></div></div><div className="feature-grid">{["Professional courts", "Sports shop", "Cafeteria", "A club community"].map((item) => <article className="feature-card" key={item}><h3>{item}</h3><p>Designed for your next match, training session, or visit with friends.</p></article>)}</div></main>;
}

export default App;
