import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Activity, ArrowLeft, ArrowRight, Bell, CalendarDays, Check, CircleDollarSign,
  ChefHat, CircleCheck, ClipboardList, Clock3, Coffee, LayoutDashboard, LogOut, MapPin, Menu,
  MessageCircle, Minus, Package, Plus, Search, Send, Settings, ShieldCheck, ShoppingBag, ShoppingCart,
  Sparkles, Users, Utensils, X,
} from "lucide-react";
import {
  apiRequest, ApiRequestError, clearAuthTokens, getRefreshToken, saveAuthTokens, type ApiEnvelope,
} from "../lib/api";
import { bookingTimes, isSlotBooked } from "../lib/booking.js";
import type { Booking } from "../lib/booking.js";
import type {
  DemoRole, DemoRow, DemoSession, DemoState, MemberActivity, ModuleKey, PublicState,
  RazorpayPaymentResult, SyncStatus,
} from "../types";

const emptyDemoState: DemoState = {
  members: [], plans: [], courts: [], bookings: [], products: [], orders: [],
  menu: [], tables: [], tabs: [], kitchen: [], enquiries: [], staff: [],
  leave: [], transactions: [], expenses: [], invoices: [], notifications: [],
};

let razorpayScriptPromise: Promise<void> | null = null;
function ensureRazorpayCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  if (!razorpayScriptPromise) {
    razorpayScriptPromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.async = true;
      script.onload = () => window.Razorpay ? resolve() : reject(new Error("Razorpay checkout did not initialize"));
      script.onerror = () => reject(new Error("Could not load Razorpay checkout"));
      document.head.appendChild(script);
    }).catch((error: unknown) => {
      razorpayScriptPromise = null;
      throw error;
    });
  }
  return razorpayScriptPromise ?? Promise.reject(new Error("Could not initialize Razorpay checkout"));
}

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
type ShopProduct = {
  id: string; name: string; description: string; category: string; price: number;
  stock_quantity: number; low_stock_threshold: number;
};
type MembershipPlan = {
  id: string; code: string; name: string; description: string; monthlyPrice: number;
  benefits: Record<string, number>;
};
type ShopOrder = {
  id: string; order_number: string; status: string; total_amount: number;
  payment_status?: string | null;
  customer_name: string | null; customer_email: string | null; customer_phone: string | null;
  fulfillment: string; items: Array<{ name: string; quantity: number; lineTotal: number }>;
};
type MemberRecord = {
  id: string; member_number: string; full_name: string; phone: string; email: string | null;
  member_status: string; membership_id: string | null; membership_status: string | null;
  approval_status: "pending" | "approved" | "rejected" | null;
  expires_at: string | null; plan_code: string | null; plan_name: string | null; monthly_price: number | null;
};
type CafeteriaMenuItem = { id: string; name: string; category: string; price: number; is_available: boolean };
type CafeteriaTable = { id: string; table_number: string; seats: number; status: "available" | "occupied" | "reserved" };
type CafeteriaTab = {
  id: string; guest_name: string | null; table_id: string | null; table_number: string | null; balance: number;
};
type KitchenOrder = {
  id: string; order_number: string; status: "placed" | "preparing" | "ready";
  notes: string | null; created_at: string; items: Array<{ name: string; quantity: number }>;
};

const moduleConfig: Partial<Record<ViewKey, { title: string; arrays: ModuleKey[]; fields?: FieldDefinition[] }>> = {
  members: { title: "Members", arrays: ["members"], fields: [
    { name: "name", label: "Full name" }, { name: "plan", label: "Plan" },
    { name: "email", label: "Member account email", type: "email" },
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
  manager: navigation.filter((item) => !["finance", "settings"].includes(item.key)).map((item) => item.key),
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
    if (!getRefreshToken()) {
      setLoading(false);
      return () => { active = false; };
    }
    void apiRequest<ApiEnvelope<{ email: string; fullName: string; role: DemoRole }>>("/api/v1/auth/me")
      .then((response) => {
        if (active) setSession({
          email: response.data.email,
          name: response.data.fullName,
          role: response.data.role,
        });
      })
      .catch((cause: unknown) => {
        if (active && !(cause instanceof ApiRequestError && cause.status === 401)) {
          setError(cause instanceof Error ? cause.message : "Could not check the sign-in session");
        }
      })
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
      versionRef.current = 0;
      setVersion(0);
      setData(emptyDemoState);
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
    try {
      const response = await apiRequest<ApiEnvelope<{ state: PublicState | null; version: number }>>("/api/v1/demo-data/public");
      if (response.data.version >= versionRef.current) {
        versionRef.current = response.data.version;
        setData(response.data.state
          ? { ...response.data.state, version: response.data.version }
          : { version: response.data.version, courts: [], plans: [], bookings: [], products: [] });
      }
      setStatus("live");
    } catch (cause) {
      setStatus("error");
      throw cause;
    }
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
  const [view, setView] = useState<ViewKey>("dashboard");
  const [publicView, setPublicView] = useState("home");
  const staff = useStaffData(Boolean(session && session.role !== "visitor" && session.role !== "member"));
  const publicSync = usePublicData(path === "/" || path === "/visitor" || path === "/portal" || session?.role === "member");
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
    } else if (path === "/login" && session) {
      window.location.replace(session.role === "member" ? "/portal?mode=member" : "/admin");
    } else if (path === "/" && session && session.role !== "visitor") {
      window.location.replace(session.role === "member" ? "/portal?mode=member" : "/admin");
    } else if (path === "/visitor" && session && session.role !== "visitor") {
      window.location.replace(session.role === "member" ? "/portal?mode=member" : "/admin");
    }
  }, [loading, path, session]);

  useEffect(() => {
    if (currentView !== view) setView(currentView);
  }, [currentView, view]);

  const signOut = async () => {
    try {
      const refreshToken = getRefreshToken();
      await apiRequest<ApiEnvelope<{ signedOut: boolean }>>("/api/v1/auth/logout", {
        method: "POST",
        body: JSON.stringify(refreshToken ? { refreshToken } : {}),
      });
      clearAuthTokens();
      setSession(null);
      window.location.assign("/");
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Could not log out");
    }
  };

  const signIn = async (email: string, password: string) => {
    setBusy(true);
    try {
      const response = await apiRequest<ApiEnvelope<{
        accessToken: string;
        refreshToken: string;
        user: { email: string; fullName: string; role: DemoRole };
      }>>("/api/v1/auth/login", {
        method: "POST", body: JSON.stringify({ email, password }),
      });
      saveAuthTokens(response.data);
      setSession({
        email: response.data.user.email,
        name: response.data.user.fullName,
        role: response.data.user.role,
      });
      window.location.assign(response.data.user.role === "member" ? "/portal?mode=member" : "/admin");
    } finally {
      setBusy(false);
    }
  };

  const bookCourt = async (courtId: string, date: string, time: string, durationMinutes = 60) => {
    setBusy(true);
    try {
      await apiRequest<ApiEnvelope<unknown>>("/api/v1/demo-data/public/bookings", {
        method: "POST", body: JSON.stringify({ courtId, date, time, durationMinutes }),
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
  if (path === "/login") {
    return <LoginPage
      busy={busy}
      error={error}
      onSignIn={signIn}
    />;
  }
  if (path === "/" || path === "/visitor" || path === "/portal") {
    const memberMode = session?.role === "member" && (path === "/" || path === "/portal" || new URLSearchParams(location.search).get("mode") === "member");
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
    canManage={session.role === "admin" || session.role === "manager"}
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

function LoginPage({ busy, error, onSignIn }: {
  busy: boolean;
  error: string;
  onSignIn: (email: string, password: string) => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
        <div className="visual-stats"><div><strong>One</strong><span>Club workspace</span></div><div><strong>Live</strong><span>Shared records</span></div><div><strong>Secure</strong><span>Role-based access</span></div></div>
      </div>
    </section>
    <section className="login-panel"><div className="login-card">
      <p className="eyebrow">CHAMPIONS CLUB</p><h2>Welcome to PlayPulse</h2><p className="subtitle">Sign in with your account to open the correct workspace.</p>
      <form onSubmit={(event) => void submit(event)}>
        <label>Email address<input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>Password<div className="password-field"><input type={showPassword ? "text" : "password"} autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /><button type="button" onClick={() => setShowPassword(!showPassword)}>{showPassword ? "Hide" : "Show"}</button></div></label>
        <button className="login-button" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
      <p className="subtitle">Your club administrator provides your sign-in credentials.</p>
      <p className="login-error" role="alert">{message || error}</p>
    </div></section>
  </main>;
}

function AdminWorkspace({ session, canManage, view, title, allowedViews, data, syncStatus, saving, onNavigate, onLogout, onCreate, onBook, onUpdate, notify, children }: {
  session: DemoSession;
  canManage: boolean;
  view: ViewKey;
  title: string;
  allowedViews: ViewKey[];
  data: DemoState | null;
  syncStatus: SyncStatus;
  saving: boolean;
  onNavigate: (view: ViewKey) => void;
  onLogout: () => Promise<void>;
  onCreate: (key: ModuleKey, record: DemoRow) => Promise<void>;
  onBook: (courtId: string, date: string, time: string, durationMinutes?: number) => Promise<void>;
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
          view === "dashboard" ? <Dashboard data={data} role={session.role} name={session.name} onNavigate={onNavigate} /> :
          view === "courts" ? <AdminCourts data={data} onBook={onBook} notify={notify} saving={saving} canManage={canManage} /> :
          view === "assistant" ? <AssistantPanel data={data} /> :
          <AdminModule view={view} data={data} saving={saving} onCreate={onCreate} onUpdate={onUpdate} role={session.role} />}
      </section>
    </main>
    {children}
    <AssistantChatWidget />
  </div>;
}

function SyncIndicator({ status, saving }: { status: SyncStatus; saving: boolean }) {
  const label = saving ? "Saving…" : status === "live" ? "Live sync" : status === "error" ? "Sync issue" : "Reconnecting";
  return <span className={`sync-indicator ${status}`} role="status" aria-live="polite"><i />{label}</span>;
}

function Dashboard({ data, role, name, onNavigate }: {
  data: DemoState; role: DemoRole; name: string; onNavigate: (view: ViewKey) => void;
}) {
  const [range, setRange] = useState<7 | 30>(7);
  const isAdmin = role === "admin";
  const isManager = role === "manager";
  const today = todayValue();
  const activeBookings = data.bookings.filter((booking) =>
    !["cancelled", "rejected"].includes(String(booking.status ?? "").toLowerCase()));
  const todayBookings = activeBookings.filter((booking) => String(booking.date ?? "").slice(0, 10) === today).length;
  const upcomingBookings = activeBookings.filter((booking) => String(booking.date ?? "").slice(0, 10) >= today).length;
  const revenue = data.transactions.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const pendingInvoices = data.invoices.filter((invoice) => Number(invoice.paid || 0) < Number(invoice.amount || 0)).length;
  const lowStock = data.products.filter((product) => Number(product.stock || 0) <= Number(product.threshold || 0));
  const openEnquiries = data.enquiries.filter((item) =>
    !["closed", "converted"].includes(String(item.status ?? "").toLowerCase())).length;
  const pendingLeave = data.leave.filter((item) => String(item.status ?? "").toLowerCase() === "pending").length;
  const stats = isAdmin ? [
    { title: "Member records", value: data.members.length, note: "Club member profiles", icon: Users },
    { title: "Upcoming bookings", value: upcomingBookings, note: "Today and future reservations", icon: CalendarDays },
    { title: "Recorded revenue", value: money(revenue), note: "Across all channels", icon: CircleDollarSign },
    { title: "Outstanding invoices", value: pendingInvoices, note: "Need follow-up", icon: ClipboardList },
  ] : [
    { title: "Today's bookings", value: todayBookings, note: "Confirmed reservations", icon: CalendarDays },
    { title: "Open enquiries", value: openEnquiries, note: "Awaiting follow-up", icon: ClipboardList },
    { title: "Low-stock items", value: lowStock.length, note: "At or below threshold", icon: Package },
    { title: "Leave requests", value: pendingLeave, note: "Waiting for review", icon: Users },
  ];
  const chart = Array.from({ length: range }, (_, index) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (range - index - 1));
    const key = todayValueFor(date);
    const value = isAdmin
      ? data.transactions.filter((item) => String(item.date ?? "").slice(0, 10) === key)
        .reduce((sum, item) => sum + Number(item.amount || 0), 0)
      : activeBookings.filter((item) => String(item.date ?? "").slice(0, 10) === key).length;
    return { label: new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(date), value };
  });
  const chartMax = Math.max(...chart.map((point) => point.value), 1);
  const chartPoints = chart.map((point, index) => ({
    ...point,
    x: 28 + index * (584 / Math.max(chart.length - 1, 1)),
    y: 180 - (point.value / chartMax) * 142,
  }));
  const chartLine = chartPoints.map((point) => `${point.x},${point.y}`).join(" ");
  const chartArea = `${chartPoints.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ")} L 612 198 L 28 198 Z`;
  const courtLoads = data.courts.map((court) => ({
    name: String(court.name ?? "Court"),
    count: activeBookings.filter((booking) => booking.courtId === court.id).length,
  })).sort((a, b) => b.count - a.count).slice(0, 4);
  const maximumCourtLoad = Math.max(...courtLoads.map((court) => court.count), 1);
  const firstName = name.trim().split(/\s+/)[0] || "team";
  const roleTitle = isAdmin ? "Administrator overview" : isManager ? "Operations overview" : "Club service overview";
  const roleSummary = isAdmin
    ? "Your complete view of club performance, people and resources."
    : isManager
      ? "Keep daily operations moving with the tools and information your team needs."
      : "A live view of the club activity relevant to your role.";
  const chartTotal = chart.reduce((sum, point) => sum + point.value, 0);
  return <div className="dashboard-page">
    <section className={`dashboard-hero ${isManager ? "manager" : ""}`}>
      <div className="dashboard-hero-copy">
        <span className="dashboard-role-tag"><i /> {roleTitle}</span>
        <h2>Welcome back,<br /><strong>{firstName}.</strong></h2>
        <p>{roleSummary}</p>
        <div className="dashboard-hero-actions">
          <button className="hero-primary" onClick={() => onNavigate("courts")}><CalendarDays size={16} /> Open court schedule</button>
          {isAdmin && <button className="hero-secondary" onClick={() => onNavigate("settings")}><ShieldCheck size={16} /> Manage access</button>}
        </div>
      </div>
      <div className="dashboard-hero-art"><img src="/court-illustration.svg" alt="Illustration of the club's outdoor court" /></div>
      <div className="dashboard-hero-foot"><span><i /> LIVE CLUB DATA</span><span>{todayBookings} reservations today</span></div>
    </section>
    <div className="stats-grid dashboard-stats">{stats.map(({ title, value, note, icon: Icon }) =>
      <article className="card stat-card" key={title}><div className="stat-top"><span>{title}</span><span className="stat-icon"><Icon size={18} /></span></div><strong className="stat-value">{value}</strong><small className="stat-note">{note}</small></article>)}</div>
    <div className="dashboard-analytics-grid">
      <section className="card chart-card">
        <div className="card-header"><div><span className="eyebrow">{isAdmin ? "FINANCIAL PERFORMANCE" : "COURT ACTIVITY"}</span><h3>{isAdmin ? "Revenue pulse" : "Booking pulse"}</h3><p>Daily totals from the live club records</p></div>
          <div className="chart-range" aria-label="Chart date range">{([7, 30] as const).map((days) =>
            <button key={days} className={range === days ? "selected" : ""} onClick={() => setRange(days)} aria-pressed={range === days}>{days}D</button>)}</div>
        </div>
        <div className="chart-summary"><strong>{isAdmin ? money(chartTotal) : chartTotal}</strong><span>in the last {range} days</span></div>
        <svg className="activity-chart" viewBox="0 0 640 220" role="img" aria-label={`${isAdmin ? "Revenue" : "Bookings"} over the last ${range} days`}>
          <defs><linearGradient id="dashboard-chart-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#9dde71" stopOpacity=".4" /><stop offset="100%" stopColor="#9dde71" stopOpacity="0" /></linearGradient></defs>
          {[45, 95, 145, 198].map((y) => <line key={y} x1="28" x2="612" y1={y} y2={y} className="chart-grid-line" />)}
          <path d={chartArea} fill="url(#dashboard-chart-fill)" />
          <polyline points={chartLine} className="chart-line" />
          {chartPoints.filter((_, index) => range === 7 || index % 5 === 0 || index === chartPoints.length - 1)
            .map((point) => <circle key={point.label} cx={point.x} cy={point.y} r="4" className="chart-point"><title>{point.label}: {isAdmin ? money(point.value) : point.value}</title></circle>)}
        </svg>
        <div className="chart-labels">{chart.filter((_, index) => range === 7 || index % 5 === 0 || index === chart.length - 1)
          .map((point) => <span key={point.label}>{point.label}</span>)}</div>
      </section>
      <section className="card court-load-card">
        <div className="card-header"><div><span className="eyebrow">FACILITIES</span><h3>Court activity</h3><p>Confirmed bookings by court</p></div><span className="live-tag"><i /> LIVE</span></div>
        {courtLoads.length ? <div className="court-load-list">{courtLoads.map((court) =>
          <div className="court-load-row" key={court.name}><div><span>{court.name}</span><strong>{court.count}</strong></div><div className="court-load-track"><i style={{ width: `${(court.count / maximumCourtLoad) * 100}%` }} /></div></div>)}</div>
          : <p className="empty-inline">Court activity will appear when reservations are recorded.</p>}
        <button className="text-button court-load-link" onClick={() => onNavigate("courts")}>View schedule <ArrowRight size={14} /></button>
      </section>
    </div>
    <div className="dashboard-bottom-grid">
      <section className="card"><div className="card-header"><div><span className="eyebrow">LIVE OPERATIONS</span><h3>Recent bookings</h3><p>Reservations shared across the club</p></div><button className="text-button" onClick={() => onNavigate("courts")}>View all <ArrowRight size={14} /></button></div>
        <DataTable rows={data.bookings.slice(0, 5)} empty="No court bookings yet." />
      </section>
      <section className="card attention-card"><div className="card-header"><div><span className="eyebrow">ACTION QUEUE</span><h3>Needs attention</h3><p>Follow up on these live records</p></div><span className="attention-count">{lowStock.length + (isAdmin ? pendingInvoices : pendingLeave + openEnquiries)}</span></div>
        {lowStock.map((product) => <div className="alert-row" key={text(product.id)}><Package size={17} /><span><strong>{text(product.name)}</strong><small>{text(product.stock)} units remaining</small></span><button onClick={() => onNavigate("shop")}>Review</button></div>)}
        {isAdmin && pendingInvoices > 0 && <div className="alert-row"><CircleDollarSign size={17} /><span><strong>{pendingInvoices} unpaid invoices</strong><small>Review payments and due dates</small></span><button onClick={() => onNavigate("finance")}>Review</button></div>}
        {!isAdmin && pendingLeave > 0 && <div className="alert-row"><Users size={17} /><span><strong>{pendingLeave} leave requests</strong><small>Waiting for a manager decision</small></span><button onClick={() => onNavigate("staff")}>Review</button></div>}
        {!isAdmin && openEnquiries > 0 && <div className="alert-row"><ClipboardList size={17} /><span><strong>{openEnquiries} open enquiries</strong><small>Prospects need a follow-up</small></span><button onClick={() => onNavigate("enquiries")}>Review</button></div>}
        {lowStock.length === 0 && (isAdmin ? pendingInvoices : pendingLeave + openEnquiries) === 0 && <p className="muted">Everything is up to date.</p>}
      </section>
    </div>
  </div>;
}

function todayValueFor(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
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

function AdminModule({ view, data, saving, onCreate, onUpdate, role }: {
  view: ViewKey; data: DemoState; saving: boolean; onCreate: (key: ModuleKey, record: DemoRow) => Promise<void>;
  onUpdate: (key: ModuleKey, id: unknown, update: Partial<DemoRow>) => Promise<void>;
  role: DemoRole;
}) {
  const [search, setSearch] = useState("");
  const [createKey, setCreateKey] = useState<ModuleKey | null>(null);
  if (view === "members") return <MemberManagement />;
  if (view === "shop") return <ShopOperations />;
  if (view === "cafeteria") return <CafeteriaPOS />;
  const config = moduleConfig[view];
  if (!config) return null;
  const keys = config.arrays;
  const managerCreatable = new Set<ModuleKey>(["menu", "enquiries"]);
  const canCreate = Boolean(config.fields?.length && keys[0] &&
    (role === "admin" || (role === "manager" && managerCreatable.has(keys[0]))) &&
    !["notifications", "reports", "settings"].includes(view));
  const canReviewLeave = role === "admin" || role === "manager";
  const shown = (rows: DemoRow[]) => rows.filter((row) => Object.values(row).some((value) => text(value).toLowerCase().includes(search.toLowerCase())));
  return <><div className="welcome-row"><div><span className="eyebrow">OPERATIONS</span><h2>{config.title}</h2><p>Manage club records using shared, live data.</p></div>{canCreate && <button className="primary-button" onClick={() => setCreateKey(keys[0])}>+ Add record</button>}</div>
    {view === "reports" && <div className="notice-card"><ClipboardList size={18} /> Reports are based on recorded transactions, expenses, and invoice payments.</div>}
    {view !== "settings" && <div className="toolbar"><label className="search-box"><Search size={17} /><input placeholder={`Search ${config.title.toLowerCase()}`} value={search} onChange={(event) => setSearch(event.target.value)} /></label><span className="record-count">{keys.reduce((total: number, key) => total + data[key].length, 0)} records</span></div>}
    <div className="module-grid">{keys.map((key) => <section className="card" key={key}><div className="card-header"><div><h3>{labelFor(key)}</h3><p>{data[key].length} shared records</p></div>
      {key === "leave" && canReviewLeave && data[key].some((row) => row.status === "Pending") && <span className="status-pill warning">Needs review</span>}</div>
      {key === "leave" ? <LeaveTable rows={shown(data[key])} canManage={canReviewLeave} onUpdate={(id, patch) => onUpdate(key, id, patch)} /> : <DataTable rows={shown(data[key])} empty={`No ${labelFor(key).toLowerCase()} to display.`} />}
    </section>)}</div>
    {createKey && config.fields && <RecordDialog key={createKey} moduleKey={createKey} fields={config.fields} saving={saving} onClose={() => setCreateKey(null)} onSave={async (record) => {
      await onCreate(createKey, { id: `${prefixFor(createKey)}-${Date.now()}`, ...record });
      setCreateKey(null);
    }} />}
    {view === "settings" && <><div className="notice-card"><Settings size={18} /> Administrator controls for access and club configuration. Changes to sensitive operational records are permission-checked by the API.</div><AccountProvisioningCard /></>}
    {view === "assistant" && <p className="muted">Assistant is ready.</p>}
    {saving && <span className="sr-only" role="status">Saving shared data</span>}
  </>;
}

function MemberManagement() {
  const [members, setMembers] = useState<MemberRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "pending" | "expired">("all");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card" | "upi">("cash");
  const [savingId, setSavingId] = useState("");

  const refresh = useCallback(async () => {
    setError("");
    try {
      const response = await apiRequest<ApiEnvelope<MemberRecord[]>>("/api/v1/memberships/members");
      setMembers(response.data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load member records");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const pending = members.filter((member) =>
    member.membership_status === "pending" && member.approval_status === "pending");
  const approvedPending = members.filter((member) =>
    member.membership_status === "pending" && member.approval_status === "approved");
  const isExpired = (member: MemberRecord) => member.membership_status === "expired" ||
    (member.membership_status === "active" && member.expires_at !== null && member.expires_at !== undefined &&
      new Date(member.expires_at).getTime() <= Date.now());
  const active = members.filter((member) => member.membership_status === "active" && !isExpired(member));
  const expiring = active.filter((member) => {
    if (!member.expires_at) return false;
    const remaining = new Date(member.expires_at).getTime() - Date.now();
    return remaining >= 0 && remaining < 30 * 24 * 60 * 60 * 1000;
  });
  const visible = members.filter((member) => {
    const status = isExpired(member) ? "expired" : member.membership_status;
    const matchesFilter = filter === "all" || status === filter;
    const textValue = [member.full_name, member.member_number, member.email, member.phone, member.plan_name]
      .filter(Boolean).join(" ").toLowerCase();
    return matchesFilter && textValue.includes(search.toLowerCase());
  });
  const activate = async (member: MemberRecord) => {
    if (!member.membership_id) return;
    setSavingId(member.membership_id);
    setError("");
    try {
      const response = await apiRequest<ApiEnvelope<{ receiptNumber: string }>>(
        `/api/v1/memberships/${member.membership_id}/activate`,
        { method: "POST", body: JSON.stringify({ paymentMethod }) },
      );
      await refresh();
      setError(`Payment recorded: receipt ${response.data.receiptNumber}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not activate this membership");
    } finally {
      setSavingId("");
    }
  };
  const decideApplication = async (member: MemberRecord, decision: "approve" | "reject") => {
    if (!member.membership_id) return;
    setSavingId(member.membership_id);
    setError("");
    try {
      await apiRequest<ApiEnvelope<unknown>>(
        `/api/v1/memberships/${member.membership_id}/${decision}`,
        { method: "POST" },
      );
      await refresh();
      setError(`Membership application ${decision}d.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Could not ${decision} this application`);
    } finally {
      setSavingId("");
    }
  };

  return <div className="business-module">
    <div className="welcome-row"><div><span className="eyebrow">MEMBER EXPERIENCE</span><h2>Member directory</h2><p>Membership applications, plan details and contact records from the live database.</p></div></div>
    <div className="stats-grid business-stats">
      <article className="card stat-card"><div className="stat-top"><span>Total profiles</span><span className="stat-icon"><Users size={18} /></span></div><strong className="stat-value">{members.length}</strong><small className="stat-note">Registered member records</small></article>
      <article className="card stat-card"><div className="stat-top"><span>Active memberships</span><span className="stat-icon"><CircleCheck size={18} /></span></div><strong className="stat-value">{active.length}</strong><small className="stat-note">Currently eligible for benefits</small></article>
      <article className="card stat-card"><div className="stat-top"><span>Awaiting approval</span><span className="stat-icon"><Clock3 size={18} /></span></div><strong className="stat-value">{pending.length}</strong><small className="stat-note">New plan applications</small></article>
      <article className="card stat-card"><div className="stat-top"><span>Expiring soon</span><span className="stat-icon"><CalendarDays size={18} /></span></div><strong className="stat-value">{expiring.length}</strong><small className="stat-note">Within the next 30 days</small></article>
    </div>
    <section className="card business-panel">
      <div className="card-header"><div><span className="eyebrow">MEMBERSHIP DESK</span><h3>Applications for approval</h3><p>Review and approve a plan before the applicant can pay.</p></div>
      </div>
      {pending.length ? <div className="pending-memberships">{pending.map((member) => <article className="pending-member" key={member.membership_id}>
        <div className="pending-member-avatar">{member.full_name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("")}</div>
        <div className="pending-member-details"><strong>{member.full_name}</strong><span>{member.plan_name} · {member.member_number}</span><small>{member.email ?? member.phone}</small></div>
        <strong className="pending-member-price">{money(member.monthly_price)}</strong>
        <button className="primary-button" disabled={savingId === member.membership_id} onClick={() => void decideApplication(member, "approve")}>{savingId === member.membership_id ? "Saving…" : "Approve"}</button>
        <button className="secondary-button" disabled={savingId === member.membership_id} onClick={() => void decideApplication(member, "reject")}>Reject</button>
      </article>)}</div> : <p className="empty-inline">No membership applications are waiting for approval.</p>}
    </section>
    <section className="card business-panel">
      <div className="card-header"><div><span className="eyebrow">PAYMENT DESK</span><h3>Approved applications</h3><p>Record in-person payments for approved plans.</p></div>
        <label className="payment-select">Payment method<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as "cash" | "card" | "upi")}><option value="cash">Cash</option><option value="card">Card</option><option value="upi">UPI</option></select></label>
      </div>
      {approvedPending.length ? <div className="pending-memberships">{approvedPending.map((member) => <article className="pending-member" key={member.membership_id}>
        <div className="pending-member-avatar">{member.full_name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("")}</div>
        <div className="pending-member-details"><strong>{member.full_name}</strong><span>{member.plan_name} · {member.member_number}</span><small>{member.email ?? member.phone}</small></div>
        <strong className="pending-member-price">{money(member.monthly_price)}</strong>
        <button className="primary-button" disabled={savingId === member.membership_id} onClick={() => void activate(member)}>{savingId === member.membership_id ? "Saving…" : "Record payment"}</button>
      </article>)}</div> : <p className="empty-inline">No approved memberships are waiting for payment.</p>}
    </section>
    <section className="card business-panel">
      <div className="card-header"><div><span className="eyebrow">CLUB DIRECTORY</span><h3>All members</h3><p>{visible.length} of {members.length} profiles</p></div>
        <div className="member-filters">
          <label className="search-box"><Search size={16} /><input placeholder="Search name, plan or contact" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
          <select aria-label="Filter members by membership status" value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}>
            <option value="all">All statuses</option><option value="active">Active</option><option value="pending">Pending</option><option value="expired">Expired</option>
          </select>
        </div>
      </div>
      {loading ? <p className="empty-inline">Loading live member records…</p> : error && !members.length ? <p className="inline-error" role="alert">{error}</p> :
        <div className="table-wrap"><table className="data-table member-directory-table"><thead><tr><th>MEMBER</th><th>PLAN</th><th>CONTACT</th><th>VALID THROUGH</th><th>STATUS</th></tr></thead><tbody>
          {visible.map((member) => {
            const status = isExpired(member) ? "expired" : member.membership_status ?? "none";
            return <tr key={member.id}><td><strong>{member.full_name}</strong><small>{member.member_number}</small></td><td>{member.plan_name ?? "No plan selected"}</td><td>{member.email ?? "—"}<small>{member.phone}</small></td><td>{member.expires_at ? displayDate(member.expires_at.slice(0, 10)) : "—"}</td><td><span className={`status-pill ${status === "active" ? "success" : status === "pending" ? "warning" : ""}`}>{status}</span></td></tr>;
          })}
          {!visible.length && <tr><td colSpan={5} className="empty-inline">No members match this filter.</td></tr>}
        </tbody></table></div>}
      {error && members.length > 0 && <p className="inline-error" role="status">{error}</p>}
    </section>
  </div>;
}

function ShopOperations() {
  const [products, setProducts] = useState<ShopProduct[]>([]);
  const [orders, setOrders] = useState<ShopOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card" | "upi">("cash");
  const [busyOrder, setBusyOrder] = useState("");

  const refresh = useCallback(async () => {
    setError("");
    try {
      const [catalog, orderList] = await Promise.all([
        apiRequest<ApiEnvelope<ShopProduct[]>>("/api/v1/shop/products"),
        apiRequest<ApiEnvelope<ShopOrder[]>>("/api/v1/shop/orders"),
      ]);
      setProducts(catalog.data);
      setOrders(orderList.data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load shop operations");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const updateOrder = async (order: ShopOrder, action: "confirm" | "fulfill" | "cancel") => {
    setBusyOrder(order.id);
    setError("");
    try {
      if (action === "confirm") {
        await apiRequest<ApiEnvelope<unknown>>(`/api/v1/shop/orders/${order.id}/confirm`, {
          method: "POST", body: JSON.stringify({ paymentMethod }),
        });
      } else {
        await apiRequest<ApiEnvelope<unknown>>(`/api/v1/shop/orders/${order.id}/${action}`, {
          method: "POST", body: JSON.stringify({}),
        });
      }
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update this order");
    } finally {
      setBusyOrder("");
    }
  };
  const pendingCount = orders.filter((order) => order.status === "pending").length;
  const lowStock = products.filter((product) => product.stock_quantity <= product.low_stock_threshold).length;
  const totalStock = products.reduce((sum, product) => sum + product.stock_quantity, 0);

  return <div className="business-module">
    <div className="welcome-row"><div><span className="eyebrow">RETAIL OPERATIONS</span><h2>Shop & inventory</h2><p>Live stock, visitor pickup orders and payment collection.</p></div>
      <label className="payment-select">Payment method<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as "cash" | "card" | "upi")}><option value="cash">Cash</option><option value="card">Card</option><option value="upi">UPI</option></select></label>
    </div>
    <div className="stats-grid business-stats">
      <article className="card stat-card"><div className="stat-top"><span>Catalog products</span><span className="stat-icon"><Package size={18} /></span></div><strong className="stat-value">{products.length}</strong><small className="stat-note">Active items for sale</small></article>
      <article className="card stat-card"><div className="stat-top"><span>Units in stock</span><span className="stat-icon"><ShoppingBag size={18} /></span></div><strong className="stat-value">{totalStock}</strong><small className="stat-note">Across active products</small></article>
      <article className="card stat-card"><div className="stat-top"><span>Low-stock products</span><span className="stat-icon"><Package size={18} /></span></div><strong className="stat-value">{lowStock}</strong><small className="stat-note">At or below restock threshold</small></article>
      <article className="card stat-card"><div className="stat-top"><span>Orders to action</span><span className="stat-icon"><ShoppingCart size={18} /></span></div><strong className="stat-value">{pendingCount}</strong><small className="stat-note">Payment due at the club</small></article>
    </div>
    {error && <p className="inline-error" role="alert">{error}</p>}
    <section className="card business-panel"><div className="card-header"><div><span className="eyebrow">INVENTORY HEALTH</span><h3>Current stock</h3><p>Catalog data is loaded from the normalized inventory.</p></div></div>
      {loading ? <p className="empty-inline">Loading live inventory…</p> : <div className="inventory-grid">{products.map((product) => {
        const ratio = product.low_stock_threshold > 0 ? Math.min(100, Math.round(product.stock_quantity / (product.low_stock_threshold * 2) * 100)) : product.stock_quantity > 0 ? 100 : 0;
        const isLow = product.stock_quantity <= product.low_stock_threshold;
        return <article className={`inventory-card ${isLow ? "low" : ""}`} key={product.id}>
          <div className="inventory-card-top"><span className="eyebrow">{product.category}</span><span className={`status-pill ${isLow ? "warning" : "success"}`}>{isLow ? "Restock" : "In stock"}</span></div>
          <h4>{product.name}</h4><p>{product.description || "Club shop product"}</p><div className="inventory-card-bottom"><strong>{money(product.price)}</strong><span>{product.stock_quantity} units</span></div>
          <div className="inventory-track"><i style={{ width: `${ratio}%` }} /></div>
        </article>;
      })}{!products.length && <p className="empty-inline">No active catalog items.</p>}</div>}
    </section>
    <section className="card business-panel"><div className="card-header"><div><span className="eyebrow">PICKUP DESK</span><h3>Shop orders</h3><p>Record payment before handing over reserved items.</p></div></div>
      {orders.length ? <div className="shop-order-list">{orders.map((order) => <article className="shop-order-card" key={order.id}>
        <div className="shop-order-main"><span className={`status-pill ${order.status === "pending" ? "warning" : "success"}`}>{order.status}</span><strong>{order.order_number}</strong><small>{order.customer_name || "Club customer"} · {order.customer_phone || order.customer_email || "No contact provided"}</small>
          <span className="shop-order-items">{order.items.map((item) => `${item.name} × ${item.quantity}`).join(" · ")}</span></div>
        <strong className="shop-order-total">{money(order.total_amount)}</strong>
        <div className="shop-order-actions">{order.status === "pending" && order.payment_status === "pending" ? <span className="muted">Awaiting online payment</span> :
          order.status === "pending" ? <><button className="primary-button" disabled={busyOrder === order.id} onClick={() => void updateOrder(order, "confirm")}>{busyOrder === order.id ? "Saving…" : "Record payment"}</button><button className="secondary-button" disabled={busyOrder === order.id} onClick={() => void updateOrder(order, "cancel")}>Cancel</button></> :
          order.status === "confirmed" ? <button className="primary-button" disabled={busyOrder === order.id} onClick={() => void updateOrder(order, "fulfill")}>{busyOrder === order.id ? "Saving…" : "Mark picked up"}</button> : <span className="muted">Completed</span>}</div>
      </article>)}</div> : <p className="empty-inline">{loading ? "Loading orders…" : "No shop orders yet."}</p>}
    </section>
  </div>;
}

function CafeteriaPOS() {
  const [menu, setMenu] = useState<CafeteriaMenuItem[]>([]);
  const [tables, setTables] = useState<CafeteriaTable[]>([]);
  const [tabs, setTabs] = useState<CafeteriaTab[]>([]);
  const [queue, setQueue] = useState<KitchenOrder[]>([]);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [tableId, setTableId] = useState("");
  const [guestName, setGuestName] = useState("");
  const [selectedTabId, setSelectedTabId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card" | "upi">("cash");
  const [busyTab, setBusyTab] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setError("");
    try {
      const [menuResponse, tableResponse, tabsResponse, queueResponse] = await Promise.all([
        apiRequest<ApiEnvelope<CafeteriaMenuItem[]>>("/api/v1/cafeteria/menu"),
        apiRequest<ApiEnvelope<CafeteriaTable[]>>("/api/v1/cafeteria/tables"),
        apiRequest<ApiEnvelope<CafeteriaTab[]>>("/api/v1/cafeteria/tabs"),
        apiRequest<ApiEnvelope<KitchenOrder[]>>("/api/v1/cafeteria/kitchen/queue"),
      ]);
      setMenu(menuResponse.data);
      setTables(tableResponse.data);
      setTabs(tabsResponse.data);
      setQueue(queueResponse.data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load cafeteria operations");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const cartItems = menu.filter((item) => (cart[item.id] ?? 0) > 0);
  const total = cartItems.reduce((sum, item) => sum + item.price * cart[item.id], 0);
  const quantity = Object.values(cart).reduce((sum, value) => sum + value, 0);
  const setItemQuantity = (id: string, value: number) => setCart((current) => {
    const next = { ...current };
    if (value <= 0) delete next[id];
    else next[id] = value;
    return next;
  });
  const placeOrder = async (event: FormEvent) => {
    event.preventDefault();
    if (!cartItems.length) return;
    if (!selectedTabId && guestName.trim().length < 2) {
      setError("Enter a guest name to open a cafeteria tab.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      let activeTabId = selectedTabId;
      if (!activeTabId) {
        const tabResponse = await apiRequest<ApiEnvelope<{ id: string }>>("/api/v1/cafeteria/tabs", {
          method: "POST",
          body: JSON.stringify({
            ...(tableId ? { tableId } : {}),
            guestName: guestName.trim(),
          }),
        });
        activeTabId = tabResponse.data.id;
        setSelectedTabId(activeTabId);
      }
      const activeTab = tabs.find((tab) => tab.id === activeTabId);
      await apiRequest<ApiEnvelope<unknown>>("/api/v1/cafeteria/orders", {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({
          tabId: activeTabId,
          ...((activeTab?.table_id || tableId) ? { tableId: activeTab?.table_id || tableId } : {}),
          ...((activeTab?.guest_name || guestName.trim()) ? { guestName: activeTab?.guest_name || guestName.trim() } : {}),
          items: cartItems.map((item) => ({ menuItemId: item.id, quantity: cart[item.id] })),
        }),
      });
      setCart({});
      setGuestName("");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not place cafeteria order");
    } finally {
      setSaving(false);
    }
  };
  const setTableStatus = async (table: CafeteriaTable) => {
    const status = table.status === "available" ? "occupied" : "available";
    setError("");
    try {
      await apiRequest<ApiEnvelope<CafeteriaTable>>(`/api/v1/cafeteria/tables/${table.id}/status`, {
        method: "PATCH", body: JSON.stringify({ status }),
      });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update table status");
    }
  };
  const settleTab = async (tab: CafeteriaTab) => {
    setBusyTab(tab.id);
    setError("");
    try {
      await apiRequest<ApiEnvelope<unknown>>(`/api/v1/cafeteria/tabs/${tab.id}/settle`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ method: paymentMethod }),
      });
      if (selectedTabId === tab.id) {
        setSelectedTabId("");
        setTableId("");
      }
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not settle this tab");
    } finally {
      setBusyTab("");
    }
  };
  const advanceOrder = async (order: KitchenOrder) => {
    const status = order.status === "placed" ? "preparing" : order.status === "preparing" ? "ready" : "served";
    setError("");
    try {
      await apiRequest<ApiEnvelope<unknown>>(`/api/v1/cafeteria/orders/${order.id}/status`, {
        method: "PATCH", body: JSON.stringify({ status }),
      });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update kitchen status");
    }
  };
  const occupiedTables = tables.filter((table) => table.status === "occupied").length;
  const availableMenu = menu.filter((item) => item.is_available).length;

  return <div className="business-module">
    <div className="welcome-row"><div><span className="eyebrow">FOOD & HOSPITALITY</span><h2>Cafeteria service</h2><p>Take orders, manage seating and keep the kitchen queue moving.</p></div><span className="live-tag"><i /> LIVE OPERATIONS</span></div>
    <div className="stats-grid business-stats">
      <article className="card stat-card"><div className="stat-top"><span>Active kitchen orders</span><span className="stat-icon"><ChefHat size={18} /></span></div><strong className="stat-value">{queue.length}</strong><small className="stat-note">Placed, preparing or ready</small></article>
      <article className="card stat-card"><div className="stat-top"><span>Occupied tables</span><span className="stat-icon"><Users size={18} /></span></div><strong className="stat-value">{occupiedTables}<small> / {tables.length}</small></strong><small className="stat-note">Current seating</small></article>
      <article className="card stat-card"><div className="stat-top"><span>Menu items</span><span className="stat-icon"><Utensils size={18} /></span></div><strong className="stat-value">{availableMenu}</strong><small className="stat-note">Available to order</small></article>
      <article className="card stat-card"><div className="stat-top"><span>Open tabs</span><span className="stat-icon"><ShoppingCart size={18} /></span></div><strong className="stat-value">{tabs.length}</strong><small className="stat-note">{quantity} items in current order · {money(total)}</small></article>
    </div>
    {error && <p className="inline-error" role="alert">{error}</p>}
    <div className="cafeteria-layout">
      <section className="card business-panel"><div className="card-header"><div><span className="eyebrow">POINT OF SALE</span><h3>Build an order</h3><p>Select items, then send them to the kitchen.</p></div></div>
        {loading ? <p className="empty-inline">Loading menu…</p> : <div className="pos-menu-grid">{menu.filter((item) => item.is_available).map((item) => <article className="pos-menu-item" key={item.id}>
          <span className="menu-category">{item.category}</span><strong>{item.name}</strong><span>{money(item.price)}</span>
          <button className="pos-add-button" aria-label={`Add ${item.name}`} onClick={() => setItemQuantity(item.id, (cart[item.id] ?? 0) + 1)}><Plus size={16} /></button>
          {(cart[item.id] ?? 0) > 0 && <div className="quantity-control"><button aria-label={`Remove one ${item.name}`} onClick={() => setItemQuantity(item.id, cart[item.id] - 1)}><Minus size={14} /></button><strong>{cart[item.id]}</strong><button aria-label={`Add one ${item.name}`} onClick={() => setItemQuantity(item.id, cart[item.id] + 1)}><Plus size={14} /></button></div>}
        </article>)}</div>}
        {!loading && !availableMenu && <p className="empty-inline">No cafeteria menu items are currently available.</p>}
      </section>
      <section className="card business-panel pos-checkout"><div className="card-header"><div><span className="eyebrow">CHECKOUT</span><h3>Order details</h3><p>Send orders to the kitchen and settle the guest tab.</p></div></div>
        <form onSubmit={(event) => void placeOrder(event)}>
          <label className="form-field">Open tab<select value={selectedTabId} onChange={(event) => {
            const tabId = event.target.value;
            const existing = tabs.find((tab) => tab.id === tabId);
            setSelectedTabId(tabId);
            setTableId(existing?.table_id ?? "");
            setGuestName(existing?.guest_name ?? "");
          }}><option value="">Start a new guest tab</option>{tabs.map((tab) => <option key={tab.id} value={tab.id}>{tab.guest_name ?? "Guest"}{tab.table_number ? ` · Table ${tab.table_number}` : ""} · {money(tab.balance)}</option>)}</select></label>
          <label className="form-field">Table<select value={tableId} disabled={Boolean(selectedTabId)} onChange={(event) => setTableId(event.target.value)}><option value="">Takeaway / no table</option>{tables.filter((table) => table.status !== "reserved").map((table) => <option key={table.id} value={table.id}>Table {table.table_number} · {table.status}</option>)}</select></label>
          {!selectedTabId && <label className="form-field">Guest name<input required minLength={2} value={guestName} onChange={(event) => setGuestName(event.target.value)} /></label>}
          <div className="pos-cart-lines">{cartItems.map((item) => <div key={item.id}><span>{item.name} × {cart[item.id]}</span><strong>{money(item.price * cart[item.id])}</strong></div>)}
            {!cartItems.length && <p className="empty-inline">Add a menu item to start an order.</p>}</div>
          <div className="pos-total"><span>Total</span><strong>{money(total)}</strong></div>
          <button className="primary-button full-width" disabled={saving || !cartItems.length}>{saving ? "Sending to kitchen…" : "Place cafeteria order"}</button>
        </form>
      </section>
    </div>
    <section className="card business-panel"><div className="card-header"><div><span className="eyebrow">FLOOR PLAN</span><h3>Table status</h3><p>Tap the status to toggle seating availability.</p></div></div>
      <div className="table-status-grid">{tables.map((table) => <button key={table.id} className={`table-status-card ${table.status}`} onClick={() => void setTableStatus(table)}><MapPin size={17} /><strong>Table {table.table_number}</strong><span>{table.seats} seats · {table.status}</span></button>)}</div>
      {!tables.length && !loading && <p className="empty-inline">No tables are configured.</p>}
    </section>
    <section className="card business-panel"><div className="card-header"><div><span className="eyebrow">COUNTER SETTLEMENT</span><h3>Open guest tabs</h3><p>Record the guest payment and release the table.</p></div>
      <label className="payment-select">Payment method<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as "cash" | "card" | "upi")}><option value="cash">Cash</option><option value="card">Card</option><option value="upi">UPI</option></select></label>
    </div>
      {tabs.length ? <div className="open-tab-list">{tabs.map((tab) => <article className="open-tab-row" key={tab.id}>
        <div><strong>{tab.guest_name ?? "Guest"}{tab.table_number ? ` · Table ${tab.table_number}` : ""}</strong><small>{tab.balance > 0 ? "Ready to settle" : "No orders on this tab yet"}</small></div>
        <strong>{money(tab.balance)}</strong>
        <button className="primary-button" disabled={tab.balance <= 0 || busyTab === tab.id} onClick={() => void settleTab(tab)}>{busyTab === tab.id ? "Settling…" : "Settle tab"}</button>
      </article>)}</div> : <p className="empty-inline">{loading ? "Loading open tabs…" : "No open tabs."}</p>}
    </section>
    <section className="card business-panel"><div className="card-header"><div><span className="eyebrow">KITCHEN DISPLAY</span><h3>Order queue</h3><p>Advance each ticket as the kitchen works through it.</p></div></div>
      {queue.length ? <div className="kitchen-queue">{queue.map((order) => <article className={`kitchen-ticket ${order.status}`} key={order.id}>
        <div className="ticket-heading"><strong>{order.order_number}</strong><span className={`status-pill ${order.status === "ready" ? "success" : "warning"}`}>{order.status}</span></div>
        <p>{order.items.map((item) => `${item.quantity} × ${item.name}`).join(" · ")}</p>
        {order.notes && <small>{order.notes}</small>}
        <button className="secondary-button" onClick={() => void advanceOrder(order)}>{order.status === "placed" ? "Start preparing" : order.status === "preparing" ? "Mark ready" : "Mark served"} <ArrowRight size={14} /></button>
      </article>)}</div> : <p className="empty-inline">{loading ? "Loading kitchen queue…" : "Kitchen queue is clear."}</p>}
    </section>
  </div>;
}

function AccountProvisioningCard() {
  const [values, setValues] = useState({
    fullName: "",
    email: "",
    password: "",
    phone: "",
    role: "front_desk" as Exclude<DemoRole, "visitor">,
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage("");
    setError("");
    setSaving(true);
    try {
      const response = await apiRequest<ApiEnvelope<{ fullName: string; email: string; role: string }>>(
        "/api/v1/auth/accounts",
        {
          method: "POST",
          body: JSON.stringify({
            fullName: values.fullName.trim(),
            email: values.email.trim(),
            password: values.password,
            role: values.role,
            ...(values.phone ? { phone: values.phone.trim() } : {}),
          }),
        },
      );
      setMessage(`Created ${response.data.fullName} as ${response.data.role.replace("_", " ")}.`);
      setValues({ fullName: "", email: "", password: "", phone: "", role: "front_desk" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the account");
    } finally {
      setSaving(false);
    }
  };
  return <section className="card account-provisioning">
    <div className="card-header"><div><span className="eyebrow">ACCESS MANAGEMENT</span><h3>Create a staff account</h3><p>New users receive access based on the role selected below.</p></div><span className="account-shield"><ShieldCheck size={19} /></span></div>
    <form className="account-form" onSubmit={(event) => void submit(event)}>
      <label className="form-field">Full name<input required minLength={2} maxLength={120} value={values.fullName} onChange={(event) => setValues({ ...values, fullName: event.target.value })} /></label>
      <label className="form-field">Email address<input required type="email" maxLength={254} autoComplete="off" value={values.email} onChange={(event) => setValues({ ...values, email: event.target.value })} /></label>
      <label className="form-field">Initial password<input required type="password" minLength={12} maxLength={128} autoComplete="new-password" value={values.password} onChange={(event) => setValues({ ...values, password: event.target.value })} /><small>Use at least 12 characters and share it through a secure channel.</small></label>
      <label className="form-field">Role<select value={values.role} onChange={(event) => setValues({ ...values, role: event.target.value as Exclude<DemoRole, "visitor"> })}>
        <option value="front_desk">Front desk</option><option value="staff">Staff</option><option value="manager">Manager</option><option value="admin">Administrator</option><option value="member">Member</option>
      </select></label>
      {values.role === "member" && <label className="form-field">Phone number<input required minLength={7} maxLength={20} value={values.phone} onChange={(event) => setValues({ ...values, phone: event.target.value })} /></label>}
      <div className="account-form-footer"><p>Passwords are stored as secure hashes, never as plain text.</p><button className="primary-button" disabled={saving}>{saving ? "Creating…" : "Create account"}</button></div>
    </form>
    {message && <p className="account-feedback" role="status">{message}</p>}
    {error && <p className="login-error account-error" role="alert">{error}</p>}
    <div className="access-levels"><article><strong>Administrator</strong><span>Full access, finance, configuration and account management.</span></article><article><strong>Manager</strong><span>Daily operations and staff review; no finance changes or system settings.</span></article></div>
  </section>;
}

function labelFor(key: string) {
  return ({ menu: "Menu", tables: "Tables", tabs: "Customer tabs", kitchen: "Kitchen queue", leave: "Leave requests", transactions: "Transactions", invoices: "Invoices", expenses: "Expenses", plans: "Membership plans", courts: "Facilities" } as Record<string, string>)[key] ?? key[0].toUpperCase() + key.slice(1);
}
function prefixFor(key: string) {
  return ({ members: "M", courts: "C", products: "P", menu: "F", enquiries: "E", staff: "S" } as Record<string, string>)[key] ?? key.slice(0, 3).toUpperCase();
}

function LeaveTable({ rows, onUpdate, canManage }: { rows: DemoRow[]; onUpdate: (id: unknown, patch: Partial<DemoRow>) => Promise<void>; canManage: boolean }) {
  if (!rows.length) return <p className="empty-inline">No leave requests to display.</p>;
  return <div className="table-wrap"><table className="data-table"><thead><tr><th>Staff</th><th>Dates</th><th>Reason</th><th>Status</th>{canManage && <th>Review</th>}</tr></thead><tbody>
    {rows.map((row, index) => <tr key={text(row.id) === "—" ? index : text(row.id)}><td>{text(row.name)}</td><td>{text(row.dates)}</td><td>{text(row.reason)}</td><td>{text(row.status)}</td>{canManage && <td>{row.status === "Pending" ? <div className="inline-actions"><button onClick={() => void onUpdate(row.id, { status: "Approved" })}>Approve</button><button onClick={() => void onUpdate(row.id, { status: "Rejected" })}>Reject</button></div> : "—"}</td>}</tr>)}
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

function AdminCourts({ data, onBook, notify, saving, canManage }: { data: DemoState; onBook: (courtId: string, date: string, time: string, durationMinutes?: number) => Promise<void>; notify: (message: string) => void; saving: boolean; canManage: boolean }) {
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
      return <button key={time} className={`slot-card ${booked ? "booked" : ""} ${selectedTime === time ? "selected" : ""}`} disabled={booked || !canManage} onClick={() => setSelectedTime(time)}>
        <span>{booked ? "Reserved" : "Available"}</span><strong>{time}</strong>{selectedTime === time && <Check size={16} />}
      </button>;
    })}</div>
    {canManage && <div className="booking-action"><span>{selectedCourt ? `${text(selectedCourt.name)} · ${money(selectedCourt.price)} / hour` : "No available courts"}</span><button className="primary-button" disabled={!selectedTime || busyOrSaving(saving)} onClick={() => void makeBooking()}>{saving ? "Saving…" : "Confirm booking"}</button></div>}
    <section className="card"><div className="card-header"><div><h3>Shared reservations</h3><p>New bookings appear here immediately after confirmation.</p></div></div><DataTable rows={data.bookings} empty="No bookings for the selected club yet." /></section>
  </>;
}
function busyOrSaving(value: boolean) { return value; }

function AssistantPanel({ data }: { data: DemoState }) {
  return <><div className="welcome-row"><div><span className="eyebrow">CLUB INTELLIGENCE</span><h2>Smart assistant</h2><p>Quick operational insights from the current shared snapshot. Open Ask PlayPulse for general questions.</p></div></div>
    <section className="card assistant-card"><Sparkles size={24} /><h3>Club operations brief</h3><p>{data.members.length} members, {data.bookings.length} reservations, and {data.products.filter((item) => Number(item.stock || 0) <= Number(item.threshold || 0)).length} products below their stock threshold.</p><ul><li>Review upcoming membership expiries from the Members page.</li><li>Use Courts & bookings to see the latest slot availability.</li><li>Check Finance for invoices and recorded transactions.</li></ul></section>
  </>;
}

type AssistantChatMessage = { role: "user" | "assistant"; content: string };

function AssistantChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<AssistantChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const sendMessage = async (event: FormEvent) => {
    event.preventDefault();
    const content = input.trim();
    if (!content || loading) return;
    const userMessage: AssistantChatMessage = { role: "user", content };
    const conversation = [...messages, userMessage].slice(-10);
    setMessages(conversation);
    setInput("");
    setError("");
    setLoading(true);
    try {
      const response = await apiRequest<ApiEnvelope<{ reply: string }>>("/api/v1/assistant/chat", {
        method: "POST",
        body: JSON.stringify({ messages: conversation }),
      });
      const assistantMessage: AssistantChatMessage = { role: "assistant", content: response.data.reply };
      setMessages([...conversation, assistantMessage].slice(-10));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The assistant could not respond. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return <>
    {!open && <button className="assistant-launcher" aria-label="Ask the PlayPulse assistant" aria-expanded={open} onClick={() => setOpen(true)}>
      <MessageCircle size={19} /><span>Ask PlayPulse</span>
    </button>}
    {open && <section className="assistant-chat-panel" role="dialog" aria-label="PlayPulse assistant">
      <header className="assistant-chat-header">
        <span className="assistant-chat-icon"><Sparkles size={17} /></span>
        <div><strong>PlayPulse assistant</strong><small>General club and sports help</small></div>
        <button type="button" className="assistant-chat-close" aria-label="Close assistant" onClick={() => setOpen(false)}><X size={18} /></button>
      </header>
      <div className="assistant-chat-messages" role="log" aria-live="polite" aria-label="Conversation">
        {!messages.length && <div className="assistant-chat-message assistant">
          <strong>PlayPulse</strong>
          <p>Hi! I can help with sports questions and explain how to use the club website. What would you like to know?</p>
        </div>}
        {messages.map((message, index) => <div className={`assistant-chat-message ${message.role}`} key={`${message.role}-${index}`}>
          <strong>{message.role === "assistant" ? "PlayPulse" : "You"}</strong>
          <p>{message.content}</p>
        </div>)}
        {loading && <div className="assistant-chat-message assistant"><strong>PlayPulse</strong><p>Thinking…</p></div>}
        <div ref={messagesEndRef} />
      </div>
      {messages.length === 0 && <div className="assistant-suggestions">
        <button type="button" onClick={() => setInput("How do I book a court?")}>Booking a court</button>
        <button type="button" onClick={() => setInput("What sports can I play here?")}>Sports at the club</button>
      </div>}
      {error && <p className="assistant-chat-error" role="alert">{error}</p>}
      <form className="assistant-chat-form" onSubmit={(event) => void sendMessage(event)}>
        <label className="sr-only" htmlFor="assistant-chat-input">Message the PlayPulse assistant</label>
        <textarea id="assistant-chat-input" ref={inputRef} rows={2} maxLength={2000} value={input} placeholder="Ask a question…" onChange={(event) => setInput(event.target.value)} />
        <button type="submit" aria-label="Send message" disabled={loading || !input.trim()}><Send size={17} /></button>
      </form>
      <p className="assistant-privacy">Messages are sent to Groq to generate replies. Don’t share passwords or payment details.</p>
    </section>}
  </>;
}

function PublicPortal({ memberMode, member, data, status, selectedView, setSelectedView, busy, onBook, onLogout, notify, toast }: {
  memberMode: boolean; member: PublicState["member"]; data: PublicState | null; status: SyncStatus; selectedView: string; setSelectedView: (view: string) => void;
  busy: boolean; onBook: (courtId: string, date: string, time: string, durationMinutes?: number) => Promise<void>; onLogout: () => Promise<void>; notify: (message: string) => void; toast: string;
}) {
  return <div className="public-shell">
    <header className="public-header"><a className="brand public-brand" href="/"><span className="brand-mark">P</span><span><strong>PlayPulse</strong><small>Champions Club</small></span></a>
      <nav aria-label="Club navigation">{(memberMode ? ["home", "courts", "shop", "plans", "bookings", "account"] : ["home", "courts", "shop", "plans", "club"]).map((view) =>
        <button key={view} className={selectedView === view ? "active" : ""} onClick={() => setSelectedView(view)}>{view === "home" ? "Home" : view === "plans" ? "Membership" : view === "club" ? "The club" : view === "bookings" ? "My activity" : view[0].toUpperCase() + view.slice(1)}</button>)}</nav>
      <div className="header-actions"><SyncIndicator status={status} saving={busy} />{memberMode ? <button className="account-button" onClick={() => void onLogout()}><LogOut size={15} /> Log out</button> : <a className="account-button" href="/login">Sign in</a>}</div>
    </header>
    {selectedView === "home" ? <PublicHome memberMode={memberMode} member={member} data={data} setView={setSelectedView} /> :
      selectedView === "courts" ? <PublicCourts data={data} onBook={onBook} busy={busy} notify={notify} /> :
      selectedView === "shop" ? <PublicShop memberMode={memberMode} member={member} notify={notify} /> :
      selectedView === "plans" ? <PublicPlans memberMode={memberMode} /> :
      selectedView === "bookings" && memberMode ? <MemberBookings member={member} setView={setSelectedView} /> :
      selectedView === "account" && memberMode ? <MemberAccount member={member} /> :
      <ClubOverview data={data} setView={setSelectedView} />}
    <footer className="public-footer"><div><strong>Champions Club</strong><span>Where every match begins.</span></div></footer>
    <AssistantChatWidget />
    {toast && <div className="toast-message" role="status">{toast}</div>}
  </div>;
}

function PublicHome({ memberMode, member, data, setView }: { memberMode: boolean; member: PublicState["member"]; data: PublicState | null; setView: (view: string) => void }) {
  const availableCourts = data?.courts.filter((court) => court.status === "Available").length;
  const features = [
    { title: "Courts", detail: "Tennis, padel, badminton and cricket, with live availability.", view: "courts", icon: CalendarDays, theme: "court" },
    { title: "Membership", detail: "Simple plans and benefits designed around how you play.", view: "plans", icon: Users, theme: "membership" },
    { title: "Sports shop", detail: "Equipment and everyday essentials for your next match.", view: "shop", icon: ShoppingBag, theme: "shop" },
    { title: "Cafeteria", detail: "A relaxed place to recharge before and after the game.", view: "club", icon: Coffee, theme: "cafe" },
  ];
  return <><section className="public-hero">
      <div className="public-hero-copy">
        <span className="eyebrow">WELCOME TO CHAMPIONS CLUB</span>
        <h1>{memberMode
          ? <>Welcome back{member?.name ? `, ${member.name.split(" ")[0]}` : ""}.<br /><span className="hero-highlight">Ready to play?</span></>
          : <>Find your court.<br /><span className="hero-highlight">Own your game.</span></>}</h1>
        <p>A home for tennis, padel, badminton and cricket. Find your next match, explore membership and make more time to play.</p>
        <div className="hero-actions">
          <button className="primary-button" onClick={() => setView("courts")}>Explore court availability <ArrowRight size={16} /></button>
          <button className="secondary-button" onClick={() => setView("plans")}>{memberMode ? "View membership" : "Explore membership"}</button>
        </div>
        <div className="hero-assurance"><span><i /> Live availability</span><span>One club. Every way to play.</span></div>
      </div>
      <div className="public-hero-art">
        <div className="hero-art-glow" />
        <img src="/club-hero.svg" alt="" aria-hidden="true" />
        <div className="hero-stat hero-live-card"><span className="hero-live-label"><i /> COURTS READY</span><strong>{availableCourts ?? "—"}</strong><span>available to book</span></div>
        <div className="hero-membership-card"><span className="membership-spark"><Sparkles size={15} /></span><span><strong>{data?.plans.length ?? "—"} ways to belong</strong><small>Membership options</small></span><ArrowRight size={15} /></div>
      </div>
    </section>
    {memberMode && <MemberSummary member={member} data={data} setView={setView} />}
    <section className="public-section"><div className="section-title"><div><span className="eyebrow">THE CLUB</span><h2>Everything under one roof</h2><p>Train, play, refuel and find your people.</p></div><button className="text-button" onClick={() => setView("club")}>Discover the club <ArrowRight size={14} /></button></div>
      <div className="feature-grid">{features.map(({ title, detail, view, icon: Icon, theme }) => <article className="feature-card" key={title}>
        <div className={`feature-illustration ${theme}`} aria-hidden="true"><Icon size={28} strokeWidth={1.6} /><span /></div>
        <h3>{title}</h3><p>{detail}</p><button className="feature-link" onClick={() => setView(view)}>Explore <ArrowRight size={14} /></button>
      </article>)}</div>
    </section>
    <section className="public-cta"><div><span className="eyebrow">YOUR NEXT MATCH STARTS HERE</span><h2>Make time to play.</h2><p>Choose a court and find a time that works for you.</p></div><button className="primary-button" onClick={() => setView("courts")}>Find a court <ArrowRight size={16} /></button></section>
  </>;
}

function MemberSummary({ member, data, setView }: { member: PublicState["member"]; data: PublicState | null; setView: (view: string) => void }) {
  const bookings = data?.memberBookings ?? [];
  const membershipNote = member?.membershipStatus === "pending"
    ? "Payment due at the club to activate this plan."
    : member?.expiry ? `Valid through ${displayDate(member.expiry)}` : "Membership details are not available.";
  return <section className="member-summary"><div><span className="eyebrow">MEMBER OVERVIEW</span><h2>{member?.plan ?? "Member"} membership</h2><p>{member ? `ID ${member.id} · ${membershipNote}` : membershipNote}</p></div><div className="summary-stats"><div><strong>{bookings.length}</strong><span>bookings</span></div><div><strong>{member?.balance == null ? "—" : money(member.balance)}</strong><span>account balance</span></div></div><button className="secondary-button" onClick={() => setView("bookings")}>My bookings</button></section>;
}

function PublicCourts({ data, onBook, busy, notify }: { data: PublicState | null; onBook: (courtId: string, date: string, time: string, durationMinutes?: number) => Promise<void>; busy: boolean; notify: (message: string) => void }) {
  const [date, setDate] = useState(todayValue());
  const [courtId, setCourtId] = useState("");
  const [time, setTime] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(60);
  const courts = data?.courts ?? [];
  const readyCourts = courts.filter((court) => court.status === "Available");
  const activeCourtId = courtId || String(courts.find((court) => court.status === "Available")?.id ?? "");
  const selectedCourt = courts.find((court) => court.id === activeCourtId);
  const reservedTimes = bookingTimes.filter((slot) =>
    isSlotBooked(data?.bookings ?? [], activeCourtId, date, slot, durationMinutes));
  const openSlots = bookingTimes.length - reservedTimes.length;
  const customTimeBooked = Boolean(time && isSlotBooked(data?.bookings ?? [], activeCourtId, date, time, durationMinutes));
  const submit = () => {
    if (!selectedCourt || !time || selectedCourt.status !== "Available") { notify("Choose an available court, date and time."); return; }
    if (customTimeBooked) { notify("That time overlaps with a booking. Choose another start time."); return; }
    void onBook(activeCourtId, date, time, durationMinutes);
  };
  return <main className="public-section"><div className="section-title"><div><span className="eyebrow">FACILITIES</span><h2>Courts & availability</h2><p>Choose an available slot. Reservations are shared with the club in real time.</p></div></div>
    <div className="availability-strip">
      <article><span className="availability-icon"><CalendarDays size={17} /></span><strong>{readyCourts.length}</strong><small>courts ready</small></article>
      <article><span className="availability-icon"><Clock3 size={17} /></span><strong>{openSlots}</strong><small>listed starts available</small></article>
      <article><span className="availability-icon"><Check size={17} /></span><strong>{reservedTimes.length}</strong><small>reserved for this date</small></article>
    </div>
    <div className="court-layout"><div className="court-list"><div className="court-list-heading"><span>Choose your facility</span><strong>{courts.length} courts</strong></div>{courts.map((court) => <button key={court.id} className={`court-row ${court.id === activeCourtId ? "selected" : ""}`} aria-pressed={court.id === activeCourtId} disabled={court.status !== "Available"} onClick={() => { setCourtId(court.id); setTime(""); }}><span className="court-row-icon"><CalendarDays size={18} /></span><span><strong>{court.name}</strong><small>{court.sport} · {money(court.price)} / hour</small></span><span className={`status-pill ${court.status === "Available" ? "success" : "warning"}`}>{court.status}</span></button>)}
      {!courts.length && <p className="empty-inline">No courts are available in the catalog.</p>}
      <div className="court-note"><Check size={16} /><span><strong>Live availability</strong><small>Open slots update when a reservation is confirmed.</small></span></div>
    </div>
      <section className="card booking-card"><div className="booking-card-title"><span className="eyebrow">RESERVE YOUR SESSION</span><h3>Book a court</h3><p>Choose your session length and a 30-minute start time.</p></div><label className="form-field">Date<input type="date" min={todayValue()} value={date} onChange={(event) => { setDate(event.target.value); setTime(""); }} /></label>
        <label className="form-field">Session length<select value={durationMinutes} onChange={(event) => { setDurationMinutes(Number(event.target.value)); setTime(""); }}><option value={30}>30 minutes</option><option value={60}>1 hour</option><option value={90}>1.5 hours</option><option value={120}>2 hours</option></select></label>
        <p className="field-label">Available start times</p><div className="time-options">{bookingTimes.map((slot) => {
          const booked = isSlotBooked(data?.bookings ?? [], activeCourtId, date, slot, durationMinutes);
          return <button key={slot} className={time === slot ? "selected" : ""} aria-pressed={time === slot} disabled={booked || !selectedCourt || selectedCourt.status !== "Available"} onClick={() => setTime(slot)}>{slot}{booked && <small>Reserved</small>}</button>;
        })}</div>
        <label className="form-field">Custom start time<input type="time" step={1800} value={time} onChange={(event) => setTime(event.target.value)} /></label>
        {openSlots === 0 && <p className="slot-full-note" role="status">All listed start times are booked. Try a custom time or another date.</p>}
        {customTimeBooked && <p className="inline-error" role="alert">This time overlaps with an existing booking.</p>}
        {time && selectedCourt && <div className="booking-summary"><span><CalendarDays size={15} />{displayDate(date)}</span><span><Clock3 size={15} />{time} · {durationMinutes} min</span><strong>{money(selectedCourt.price * durationMinutes / 60)}</strong></div>}
        <button className="primary-button full-width" disabled={busy || !time || customTimeBooked || !selectedCourt || selectedCourt.status !== "Available"} onClick={submit}>{busy ? "Confirming…" : !time && openSlots === 0 ? "No listed starts available" : `Confirm booking${selectedCourt ? ` · ${money(selectedCourt.price * durationMinutes / 60)}` : ""}`}</button>
      </section>
    </div>
  </main>;
}

function PublicShop({ memberMode, member, notify }: {
  memberMode: boolean; member: PublicState["member"]; notify: (message: string) => void;
}) {
  const [products, setProducts] = useState<ShopProduct[]>([]);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [contact, setContact] = useState({ name: member?.name ?? "", email: member?.email ?? "", phone: member?.phone ?? "" });
  const [paymentProvider, setPaymentProvider] = useState<"manual" | "razorpay">("manual");
  const [discountPercent, setDiscountPercent] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState<{
    orderNumber: string; totalAmount: number; discountAmount: number; paidOnline: boolean;
  } | null>(null);
  const idempotencyKey = useRef(crypto.randomUUID());
  const refresh = useCallback(async () => {
    setError("");
    try {
      const response = await apiRequest<ApiEnvelope<ShopProduct[]>>("/api/v1/shop/products");
      setProducts(response.data);
      const config = await apiRequest<ApiEnvelope<{ provider: "manual" | "razorpay" }>>("/api/v1/shop/checkout-config");
      setPaymentProvider(config.data.provider);
      if (memberMode) {
        const discount = await apiRequest<ApiEnvelope<{ discountPercent: number }>>("/api/v1/shop/member-discount");
        setDiscountPercent(discount.data.discountPercent);
      } else {
        setDiscountPercent(0);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the live shop catalog");
    } finally {
      setLoading(false);
    }
  }, [memberMode]);
  useEffect(() => { void refresh(); }, [refresh]);

  const cartItems = products.filter((product) => (cart[product.id] ?? 0) > 0);
  const subtotal = cartItems.reduce((sum, product) => sum + product.price * cart[product.id], 0);
  const discountAmount = subtotal * discountPercent / 100;
  const total = subtotal - discountAmount;
  const setQuantity = (product: ShopProduct, quantity: number) => setCart((current) => {
    const next = { ...current };
    if (quantity <= 0) delete next[product.id];
    else next[product.id] = Math.min(quantity, product.stock_quantity);
    return next;
  });
  const placeOrder = async (event: FormEvent) => {
    event.preventDefault();
    if (!cartItems.length) return;
    setSaving(true);
    setError("");
    let paymentModalOpen = false;
    try {
      if (memberMode && !member?.id) throw new Error("Your member profile is not linked to this account.");
      const memberCheckout = memberMode && Boolean(member?.id);
      const response = await apiRequest<ApiEnvelope<{
        orderNumber?: string; order_number?: string; status: string; totalAmount?: number; total_amount?: number;
        discountAmount?: number; discount_amount?: number;
        checkout?: { provider: "razorpay"; keyId: string; orderId: string; amountPaise: number; currency: string };
      }>>(
        memberCheckout ? "/api/v1/shop/orders" : "/api/v1/shop/orders/public",
        {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey.current },
          body: JSON.stringify(memberCheckout ? {
            memberId: member?.id,
            channel: "online",
            fulfillment: "pickup",
            ...(paymentProvider === "razorpay" ? { paymentMethod: "online" } : {}),
            items: cartItems.map((product) => ({ productId: product.id, quantity: cart[product.id] })),
          } : {
            customer: contact,
            items: cartItems.map((product) => ({ productId: product.id, quantity: cart[product.id] })),
          }),
        },
      );
      const orderNumber = response.data.orderNumber ?? response.data.order_number;
      const orderTotal = response.data.totalAmount ?? Number(response.data.total_amount ?? 0);
      const actualDiscount = response.data.discountAmount ?? Number(response.data.discount_amount ?? discountAmount);
      if (!orderNumber) throw new Error("The shop order response did not include an order number.");
      if (response.data.checkout) {
        await ensureRazorpayCheckout();
        const Razorpay = window.Razorpay;
        if (!Razorpay) throw new Error("Razorpay checkout did not initialize.");
        paymentModalOpen = true;
        const checkout = new Razorpay({
          key: response.data.checkout.keyId,
          amount: response.data.checkout.amountPaise,
          currency: response.data.checkout.currency,
          order_id: response.data.checkout.orderId,
          name: "Champions Club",
          description: `Shop order ${orderNumber}`,
          prefill: { name: contact.name, email: contact.email, contact: contact.phone },
          handler: (payment: RazorpayPaymentResult) => {
            void apiRequest<ApiEnvelope<{ orderNumber: string; status: string; totalAmount: number }>>(
              "/api/v1/shop/orders/public/verify-payment",
              { method: "POST", body: JSON.stringify(payment) },
            ).then(async (verified) => {
              setConfirmation({
                orderNumber: verified.data.orderNumber,
                totalAmount: verified.data.totalAmount,
                discountAmount: actualDiscount,
                paidOnline: true,
              });
              setCart({});
              idempotencyKey.current = crypto.randomUUID();
              notify(`Payment received for order ${verified.data.orderNumber}`);
              await refresh();
            }).catch((cause: unknown) => {
              setError(cause instanceof Error ? cause.message : "Payment could not be verified. Contact the club before retrying.");
            }).finally(() => setSaving(false));
          },
          modal: { ondismiss: () => { paymentModalOpen = false; setSaving(false); } },
        });
        checkout.on("payment.failed", () => {
          paymentModalOpen = false;
          setError("Payment did not complete. Your cart is unchanged; retry checkout or contact the club.");
          setSaving(false);
        });
        checkout.open();
        await refresh();
      } else {
        setConfirmation({
          orderNumber,
          totalAmount: orderTotal,
          discountAmount: actualDiscount,
          paidOnline: false,
        });
        setCart({});
        idempotencyKey.current = crypto.randomUUID();
        notify(`Order ${orderNumber} reserved for club pickup`);
        await refresh();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not place your order");
    } finally {
      if (!paymentModalOpen) setSaving(false);
    }
  };
  const quantity = Object.values(cart).reduce((sum, value) => sum + value, 0);

  return <main className="public-section"><div className="section-title"><div><span className="eyebrow">PLAY & PERFORM</span><h2>Club shop</h2><p>Shop club essentials, apply member savings and choose secure online payment or pickup payment.</p></div><span className="shop-cart-indicator"><ShoppingCart size={16} />{quantity} {quantity === 1 ? "item" : "items"}</span></div>
    {confirmation && <section className="order-confirmation" role="status"><CircleCheck size={22} /><div><strong>{confirmation.paidOnline ? "Payment confirmed" : "Pickup order reserved"}</strong><span>Order {confirmation.orderNumber} · {money(confirmation.totalAmount)}{confirmation.paidOnline ? " paid online." : " due at the club counter."}</span>{confirmation.discountAmount > 0 && <small>You saved {money(confirmation.discountAmount)} with your member discount.</small>}<small>Bring your order number when you collect your items.</small></div><button className="icon-button" aria-label="Dismiss order confirmation" onClick={() => setConfirmation(null)}><X size={17} /></button></section>}
    {error && <p className="inline-error public-error" role="alert">{error}</p>}
    <div className="shop-layout">
      <section className="shop-catalog"><div className="shop-catalog-heading"><h3>Available equipment</h3><span>{products.length} products</span></div>
        {loading ? <p className="empty-inline">Loading live catalog…</p> : products.length ? <div className="product-grid">{products.map((product) => {
          const inCart = cart[product.id] ?? 0;
          const available = product.stock_quantity > 0;
          return <article className="public-product" key={product.id}>
            <div className={`product-art product-art-${product.category.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}><img src={productArtwork(product)} alt={product.name} loading="lazy" decoding="async" /></div>
            <span className="eyebrow">{product.category}</span><h3>{product.name}</h3><p className="product-description">{product.description || "Ready for your next match."}</p>
            <div className="product-purchase-row"><strong>{money(product.price)}</strong><span className={available ? "stock-available" : "stock-unavailable"}>{available ? `${product.stock_quantity} in stock` : "Sold out"}</span></div>
            {inCart > 0 ? <div className="quantity-control"><button aria-label={`Remove one ${product.name}`} onClick={() => setQuantity(product, inCart - 1)}><Minus size={14} /></button><strong>{inCart}</strong><button aria-label={`Add one ${product.name}`} disabled={inCart >= product.stock_quantity} onClick={() => setQuantity(product, inCart + 1)}><Plus size={14} /></button></div> :
              <button className="secondary-button full-width" disabled={!available} onClick={() => setQuantity(product, 1)}><ShoppingCart size={15} />{available ? "Add to bag" : "Out of stock"}</button>}
          </article>;
        })}</div> : <p className="empty-inline">{error ? "The catalog is temporarily unavailable." : "No active products are available."}</p>}
      </section>
      <aside className="card shop-cart-panel"><div className="card-header"><div><span className="eyebrow">PICKUP CART</span><h3>Your bag</h3><p>{paymentProvider === "razorpay" ? "Pay securely now, then collect your items." : "Reserve your items and pay at pickup."}</p></div><ShoppingCart size={19} /></div>
        <div className="shop-cart-lines">{cartItems.map((product) => <div key={product.id}><span>{product.name} × {cart[product.id]}</span><strong>{money(product.price * cart[product.id])}</strong></div>)}
          {!cartItems.length && <p className="empty-inline">Your bag is empty. Add an item to continue.</p>}</div>
        {discountAmount > 0 && <div className="shop-discount-line"><span>Member discount ({discountPercent}%)</span><strong>−{money(discountAmount)}</strong></div>}
        <div className="cart-total"><span>Order total</span><strong>{money(total)}</strong></div>
        <form className="shop-checkout-form" onSubmit={(event) => void placeOrder(event)}>
          {!memberMode && <>
            <label className="form-field">Name<input required minLength={2} maxLength={120} value={contact.name} onChange={(event) => setContact({ ...contact, name: event.target.value })} /></label>
            <label className="form-field">Email<input required type="email" maxLength={254} value={contact.email} onChange={(event) => setContact({ ...contact, email: event.target.value })} /></label>
            <label className="form-field">Phone<input required minLength={7} maxLength={20} value={contact.phone} onChange={(event) => setContact({ ...contact, phone: event.target.value })} /></label>
          </>}
          {paymentProvider === "manual" && <p className="pay-at-club-note"><MapPin size={14} />Items are reserved now; payment is due at pickup.</p>}
          <button className="primary-button full-width" disabled={saving || !cartItems.length}>{saving ? "Processing…" : paymentProvider === "razorpay" ? `Pay & place order · ${money(total)}` : "Place pickup order"}</button>
        </form>
      </aside>
    </div>
    {memberMode && <p className="member-shop-note">{discountPercent > 0
      ? `Your ${discountPercent}% active membership discount is included in the cart total.`
      : "Your membership benefits are checked automatically at checkout."}</p>}
  </main>;
}

function productArtwork(product: Pick<ShopProduct, "name" | "category"> | PublicState["products"][number]) {
  const name = product.name.toLowerCase();
  if (name.includes("racket")) return "/shop/tennis-racket.svg";
  if (name.includes("shoe") || name.includes("footwear")) return "/shop/court-shoes.svg";
  if (name.includes("padel") && name.includes("ball")) return "/shop/padel-ball-tube.svg";
  if (name.includes("ball")) return "/shop/tennis-ball-can.svg";
  if (name.includes("grip")) return "/shop/overgrip-pack.svg";
  if (name.includes("bottle")) return "/shop/water-bottle.svg";
  return "/shop/sports-kit.svg";
}

function PublicPlans({ memberMode }: { memberMode: boolean }) {
  const [plans, setPlans] = useState<MembershipPlan[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<MembershipPlan | null>(null);
  const [registered, setRegistered] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingPayment, setSavingPayment] = useState(false);
  const [memberApplication, setMemberApplication] = useState<{
    membership: { id: string; status: string; approval_status: string; plan_name: string; monthly_price: number } | null;
    onlinePaymentAvailable: boolean;
  } | null>(null);
  useEffect(() => {
    let active = true;
    void apiRequest<ApiEnvelope<MembershipPlan[]>>("/api/v1/memberships/plans")
      .then((response) => { if (active) setPlans(response.data); })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "Could not load membership plans"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!memberMode) return;
    let active = true;
    void apiRequest<ApiEnvelope<{
      membership: { id: string; status: string; approval_status: string; plan_name: string; monthly_price: number } | null;
      onlinePaymentAvailable: boolean;
    }>>("/api/v1/memberships/mine")
      .then((response) => { if (active) setMemberApplication(response.data); })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "Could not load your membership application"); });
    return () => { active = false; };
  }, [memberMode]);
  const startMembershipPayment = async () => {
    const membership = memberApplication?.membership;
    if (!membership || !memberApplication.onlinePaymentAvailable) return;
    setSavingPayment(true);
    setError("");
    let paymentModalOpen = false;
    try {
      const response = await apiRequest<ApiEnvelope<{
        provider: "razorpay"; keyId: string; orderId: string; amountPaise: number; currency: string;
      }>>(`/api/v1/memberships/${membership.id}/checkout`, { method: "POST" });
      await ensureRazorpayCheckout();
      const Razorpay = window.Razorpay;
      if (!Razorpay) throw new Error("Razorpay checkout did not initialize.");
      paymentModalOpen = true;
      const checkout = new Razorpay({
        key: response.data.keyId,
        amount: response.data.amountPaise,
        currency: response.data.currency,
        order_id: response.data.orderId,
        name: "Champions Club",
        description: `${membership.plan_name} membership`,
        handler: (payment: RazorpayPaymentResult) => {
          void apiRequest<ApiEnvelope<unknown>>(
            `/api/v1/memberships/${membership.id}/verify-payment`,
            { method: "POST", body: JSON.stringify(payment) },
          ).then(() => {
            setMemberApplication((current) => current && current.membership
              ? { ...current, membership: { ...current.membership, status: "active" } }
              : current);
            setRegistered(`${membership.plan_name} membership is active. Payment received.`);
          }).catch((cause: unknown) => {
            setError(cause instanceof Error ? cause.message : "Payment could not be verified. Contact the club before retrying.");
          }).finally(() => setSavingPayment(false));
        },
        modal: { ondismiss: () => { paymentModalOpen = false; setSavingPayment(false); } },
      });
      checkout.on("payment.failed", () => {
        paymentModalOpen = false;
        setError("Payment did not complete. You can retry from this page.");
        setSavingPayment(false);
      });
      checkout.open();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start membership payment");
    } finally {
      if (!paymentModalOpen) setSavingPayment(false);
    }
  };
  const application = memberApplication?.membership;
  return <main className="public-section"><div className="section-title"><div><span className="eyebrow">MEMBERSHIP</span><h2>Choose how you play</h2><p>Compare live plans, submit your application and pay after club approval.</p></div></div>
    <div className="membership-process"><span><i>1</i> Choose a plan</span><ArrowRight size={15} /><span><i>2</i> Create your account</span><ArrowRight size={15} /><span><i>3</i> Club approval</span><ArrowRight size={15} /><span><i>4</i> Pay & activate</span></div>
    {registered && <section className="order-confirmation membership-confirmation" role="status"><CircleCheck size={22} /><div><strong>Your membership update</strong><span>{registered}</span><small>Membership benefits are available once payment is confirmed.</small></div><button className="icon-button" aria-label="Dismiss membership update" onClick={() => setRegistered("")}><X size={17} /></button></section>}
    {memberMode && application && (application.status === "pending" || application.approval_status === "rejected") && <section className="card membership-application-status" role="status">
      <div><span className="eyebrow">YOUR APPLICATION</span><h3>{application.plan_name} membership</h3>
        <p>{application.approval_status === "rejected"
          ? "This application was not approved. Contact the membership desk if you need help."
          : application.approval_status === "approved"
          ? memberApplication?.onlinePaymentAvailable ? "Approved. Complete payment to activate your membership." : "Approved. Visit the club desk to complete payment and activate your membership."
          : "Your application is awaiting club approval. Payment becomes available once it is approved."}</p>
        {application.status === "pending" && application.approval_status === "approved" && memberApplication?.onlinePaymentAvailable &&
          <button className="primary-button" disabled={savingPayment} onClick={() => void startMembershipPayment()}>{savingPayment ? "Opening secure checkout…" : `Pay ${money(application.monthly_price)} & activate`}</button>}
      </div>
      <span className={`status-pill ${application.approval_status === "approved" ? "success" : "warning"}`}>{application.approval_status === "rejected" ? "Rejected" : application.approval_status === "approved" ? "Approved" : "Awaiting approval"}</span>
    </section>}
    {error && <p className="inline-error public-error" role="alert">{error}</p>}
    {loading ? <p className="empty-inline">Loading current membership plans…</p> : plans.length ? <div className="plans-grid">{plans.map((plan, index) => <article className={`plan-card ${index === 0 ? "featured" : ""}`} key={plan.id}>
      <span className="eyebrow">{plan.name.toUpperCase()}</span><h3>{plan.name}</h3><p className="plan-description">{plan.description || "Membership for your active club life."}</p>
      <strong>{money(plan.monthlyPrice)}<small> / month</small></strong>
      <ul><li>{Number(plan.benefits.courtFreeSessionsPerDay ?? 0)} free court sessions daily</li><li>{Number(plan.benefits.courtDiscountPercent ?? 0)}% court discount</li><li>{Number(plan.benefits.shopDiscountPercent ?? 0)}% shop discount</li><li>{Number(plan.benefits.barDiscountPercent ?? 0)}% cafeteria discount</li></ul>
      {memberMode ? <p className="member-plan-note">For plan changes or renewal, speak with the membership desk.</p> :
        <button className="primary-button full-width" onClick={() => setSelectedPlan(plan)}>Choose {plan.name} <ArrowRight size={15} /></button>}
    </article>)}</div> : !error && <p className="empty-inline">Membership plans will appear when the club catalog is ready.</p>}
    {selectedPlan && <MembershipSignupDialog plan={selectedPlan} onClose={() => setSelectedPlan(null)} onComplete={(email) => { setRegistered(`${selectedPlan.name} plan application submitted for ${email}; pending club approval.`); setSelectedPlan(null); }} />}
  </main>;
}

function MembershipSignupDialog({ plan, onClose, onComplete }: {
  plan: MembershipPlan; onClose: () => void; onComplete: (email: string) => void;
}) {
  const [values, setValues] = useState({ fullName: "", email: "", phone: "", password: "", dateOfBirth: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await apiRequest<ApiEnvelope<unknown>>("/api/v1/auth/register", {
        method: "POST",
        body: JSON.stringify({
          ...values,
          email: values.email.trim(),
          fullName: values.fullName.trim(),
          phone: values.phone.trim(),
          planCode: plan.code,
          role: "member",
          ...(values.dateOfBirth ? { dateOfBirth: values.dateOfBirth } : {}),
        }),
      });
      onComplete(values.email.trim());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create your membership account");
    } finally {
      setSaving(false);
    }
  };
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <section className="modal membership-signup-modal" role="dialog" aria-modal="true" aria-labelledby="membership-signup-title">
      <div className="modal-heading"><div><span className="eyebrow">MEMBERSHIP · {plan.name.toUpperCase()}</span><h2 id="membership-signup-title">Create your member account</h2><p>{money(plan.monthlyPrice)} / month · pay and activate at the club</p></div><button className="icon-button" aria-label="Close signup" disabled={saving} onClick={onClose}><X size={18} /></button></div>
      <form onSubmit={(event) => void submit(event)}><div className="form-grid">
        <label className="form-field">Full name<input required minLength={2} maxLength={120} autoComplete="name" value={values.fullName} onChange={(event) => setValues({ ...values, fullName: event.target.value })} /></label>
        <label className="form-field">Email address<input required type="email" maxLength={254} autoComplete="email" value={values.email} onChange={(event) => setValues({ ...values, email: event.target.value })} /></label>
        <label className="form-field">Phone number<input required minLength={7} maxLength={20} autoComplete="tel" value={values.phone} onChange={(event) => setValues({ ...values, phone: event.target.value })} /></label>
        <label className="form-field">Date of birth{plan.code === "JUNIOR" ? " (required)" : " (optional)"}<input required={plan.code === "JUNIOR"} type="date" value={values.dateOfBirth} onChange={(event) => setValues({ ...values, dateOfBirth: event.target.value })} /></label>
        <label className="form-field form-field-wide">Password<input required type="password" minLength={12} maxLength={128} autoComplete="new-password" value={values.password} onChange={(event) => setValues({ ...values, password: event.target.value })} /><small>Use at least 12 characters.</small></label>
      </div><p className="login-error" role="alert">{error}</p><div className="modal-actions"><button className="secondary-button" type="button" disabled={saving} onClick={onClose}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? "Creating account…" : "Create account & request plan"}</button></div></form>
    </section>
  </div>;
}

function MemberBookings({ member, setView }: { member: PublicState["member"]; setView: (view: string) => void }) {
  const [activity, setActivity] = useState<MemberActivity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    apiRequest<ApiEnvelope<MemberActivity>>("/api/v1/memberships/activity")
      .then((response) => { if (active) setActivity(response.data); })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "Could not load your account activity.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reload]);

  const paidTotal = activity?.payments
    .filter((payment) => payment.status.toLowerCase() === "paid")
    .reduce((total, payment) => total + payment.amount, 0) ?? 0;
  const statusTone = (status: string) => {
    const value = status.toLowerCase();
    return ["paid", "confirmed", "completed", "active", "ready", "fulfilled"].includes(value)
      ? "success" : ["pending", "requested", "processing"].includes(value) ? "warning" : "";
  };
  const statusLabel = (status: string) => status.replace(/_/g, " ");

  return <main className="public-section"><div className="section-title"><div><span className="eyebrow">YOUR ACCOUNT</span><h2>Activity &amp; history</h2><p>{member?.name ?? "Member"} · bookings, shop orders and payments</p></div><button className="primary-button" onClick={() => setView("courts")}>Book a court</button></div>
    <div className="member-activity-stats">
      <article className="card"><span className="activity-stat-icon"><CalendarDays size={18} /></span><strong>{loading ? "—" : activity?.bookings.length ?? 0}</strong><span>Bookings</span></article>
      <article className="card"><span className="activity-stat-icon"><Package size={18} /></span><strong>{loading ? "—" : activity?.orders.length ?? 0}</strong><span>Shop orders</span></article>
      <article className="card"><span className="activity-stat-icon"><CircleDollarSign size={18} /></span><strong>{loading ? "—" : money(paidTotal)}</strong><span>Paid to date</span></article>
    </div>
    {loading && <div className="card activity-message" role="status">Loading your account activity…</div>}
    {error && <div className="card activity-message activity-error" role="alert"><span>{error}</span><button className="secondary-button" onClick={() => setReload((value) => value + 1)}>Try again</button></div>}
    {!loading && !error && activity && <div className="member-activity-grid">
      <section className="card activity-panel"><header><div><h3>Bookings</h3><p>Your court reservations and their current status</p></div><span>{activity.bookings.length}</span></header>
        <div className="activity-list">{activity.bookings.map((booking) => <article className="activity-row" key={booking.id}>
          <span className="activity-icon"><CalendarDays size={17} /></span>
          <div className="activity-copy"><strong>{booking.courtName}</strong><small>{displayDate(booking.date)} · {booking.time} · {booking.durationMinutes} min</small></div>
          <div className="activity-end"><span className={`status-pill ${statusTone(booking.status)}`}>{statusLabel(booking.status)}</span><strong>{money(booking.amount)}</strong></div>
        </article>)}
          {!activity.bookings.length && <p className="activity-empty">No bookings yet. Find a court and reserve your first session.</p>}
        </div>
      </section>
      <section className="card activity-panel"><header><div><h3>Shop orders</h3><p>Order requests, fulfillment and discounts</p></div><span>{activity.orders.length}</span></header>
        <div className="activity-list">{activity.orders.map((order) => <article className="activity-row" key={order.id}>
          <span className="activity-icon"><Package size={17} /></span>
          <div className="activity-copy"><strong>{order.orderNumber}</strong><small>{displayDate(order.createdAt)} · {order.fulfillment.replace(/_/g, " ")}</small><small>{order.items.map((item) => `${item.name} × ${item.quantity}`).join(", ")}</small>
            {order.discountAmount > 0 && <small className="activity-discount">Membership savings: {money(order.discountAmount)}</small>}</div>
          <div className="activity-end"><span className={`status-pill ${statusTone(order.status)}`}>{statusLabel(order.status)}</span><strong>{money(order.totalAmount)}</strong></div>
        </article>)}
          {!activity.orders.length && <p className="activity-empty">Your shop orders will appear here after checkout.</p>}
        </div>
      </section>
      <section className="card activity-panel"><header><div><h3>Payments &amp; receipts</h3><p>Recorded payments, payment status and receipts</p></div><span>{activity.payments.length}</span></header>
        <div className="activity-list">{activity.payments.map((payment, index) => <article className="activity-row" key={`${payment.reference ?? payment.sourceType}-${index}`}>
          <span className="activity-icon"><CircleDollarSign size={17} /></span>
          <div className="activity-copy"><strong>{payment.description}</strong><small>{displayDate(payment.createdAt)} · {payment.method} · {payment.sourceType.replace(/_/g, " ")}</small><small>Reference: {payment.reference ?? "Unavailable"}</small></div>
          <div className="activity-end"><span className={`status-pill ${statusTone(payment.status)}`}>{statusLabel(payment.status)}</span><strong>{money(payment.amount)}</strong></div>
        </article>)}
          {!activity.payments.length && <p className="activity-empty">Payments and receipts will appear here when recorded.</p>}
        </div>
      </section>
    </div>}
  </main>;
}

function MemberAccount({ member }: { member: PublicState["member"] }) {
  return <main className="public-section"><div className="section-title"><div><span className="eyebrow">YOUR ACCOUNT</span><h2>Membership details</h2></div></div>
    <section className="member-account card">{[
      ["Member", member?.name], ["Member ID", member?.id], ["Plan", member?.plan],
      ["Membership status", member?.membershipStatus === "pending" ? "Pending payment at club" : member?.membershipStatus],
      ["Renewal date", member?.expiry ? displayDate(member.expiry) : null], ["Phone", member?.phone],
      ["Outstanding balance", member?.balance == null ? null : money(member.balance)],
    ].map(([label, value]) => <div className="member-row" key={label}><span>{label}</span><strong>{value ?? "Details unavailable"}</strong></div>)}</section>
  </main>;
}

function ClubOverview({ data, setView }: { data: PublicState | null; setView: (view: string) => void }) {
  const available = data?.courts.filter((court) => court.status === "Available").length ?? 0;
  const sports = new Set((data?.courts ?? []).map((court) => court.sport)).size;
  const features = [
    { title: "Courts for every game", text: "Explore the club's sports and reserve a time that fits your day.", value: `${available} courts available`, view: "courts", icon: CalendarDays },
    { title: "A considered club shop", text: "Find rackets, shoes, balls and essentials, with member savings at checkout.", value: `${data?.products.length ?? 0} products`, view: "shop", icon: ShoppingBag },
    { title: "Membership that fits", text: "Compare club plans, apply online and pay once your application is approved.", value: `${data?.plans.length ?? 0} plans`, view: "plans", icon: Users },
    { title: "Refuel between matches", text: "Take a break and enjoy food and drinks from the club cafeteria.", value: "Cafe on site", view: "home", icon: Coffee },
  ];
  return <main className="public-section"><div className="section-title"><div><span className="eyebrow">ABOUT CHAMPIONS CLUB</span><h2>More than a place to play</h2><p>A welcoming sports community built around great games, good company and the little details that make every visit easier.</p></div></div>
    <div className="club-overview-hero"><div className="club-overview-copy"><span className="eyebrow">PLAY · CONNECT · RECHARGE</span><h3>Your club, all in one place.</h3><p>From finding a court to choosing a membership and getting match-ready, Champions Club brings your sports day together around the way you like to play.</p><button className="primary-button" onClick={() => setView("courts")}>Find your next court <ArrowRight size={15} /></button></div>
      <div className="club-overview-art"><img src="/club-hero.svg" alt="Illustration of the courts and welcoming spaces at Champions Club" /><div className="club-live-stats"><span><strong>{sports}</strong> sports to explore</span><span><strong>{available}</strong> courts available</span><span><strong>{data?.plans.length ?? 0}</strong> ways to join</span></div></div>
    </div>
    <div className="club-feature-grid">{features.map(({ title, text: detail, value, view, icon: Icon }) => <article className="club-feature-card" key={title}>
      <span className="club-feature-icon"><Icon size={20} /></span><span className="club-feature-value">{value}</span><h3>{title}</h3><p>{detail}</p>
      <button className="text-button" onClick={() => setView(view)}>{view === "home" ? "Explore the club" : "Explore"} <ArrowRight size={14} /></button>
    </article>)}</div>
    <section className="club-journey">
      <div className="club-journey-heading"><span className="eyebrow">YOUR CLUB ROUTINE</span><h3>Make a day of it.</h3><p>Build your visit around the things you enjoy, all from one place.</p></div>
      <div className="club-journey-steps">
        <article><span>01</span><h4>Pick your game</h4><p>Check live court availability and reserve a suitable time.</p><button className="text-button" onClick={() => setView("courts")}>Explore courts <ArrowRight size={14} /></button></article>
        <article><span>02</span><h4>Find your people</h4><p>Compare membership plans and see the benefits available to members.</p><button className="text-button" onClick={() => setView("plans")}>Explore plans <ArrowRight size={14} /></button></article>
        <article><span>03</span><h4>Get match-ready</h4><p>Browse club essentials, enjoy member savings and collect your order at the club.</p><button className="text-button" onClick={() => setView("shop")}>Visit the shop <ArrowRight size={14} /></button></article>
      </div>
    </section>
  </main>;
}

export default App;
