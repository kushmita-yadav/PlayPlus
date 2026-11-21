import { bookingTimes, firstAvailableBookingTime, isSlotBooked } from "./booking.js";

const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];

let session = null;
try {
  session = JSON.parse(sessionStorage.getItem("playpulseSession") || "null");
} catch {
  sessionStorage.removeItem("playpulseSession");
}
const requestedMode = new URLSearchParams(location.search).get("mode");
const mode = location.pathname === "/visitor" ? "visitor"
  : requestedMode === "member" ? "member"
  : session?.role === "member" ? "member"
  : "visitor";
const isMember = mode === "member";
const localDateValue = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
const formatBookingDate = (date) => new Intl.DateTimeFormat("en-IN", {
  day: "numeric", month: "short", year: "numeric"
}).format(new Date(`${date}T00:00:00`));
let portalBookingDate = localDateValue();
let sharedPublicVersion = 0;
let sharedPublicReady = false;
let sharedPublicRetryDelay = 1000;
let sharedPublicRetryTimer;
let sharedPublicEventSource;
let sharedPublicEventRetryDelay = 1000;
let sharedPublicEventRetryTimer;
let visiblePortalView = "home";
let toastTimer;

function toast(message) {
  const element = $("#portalToast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove("show"), 2600);
}

function updatePortalSyncStatus(state, text) {
  const status = $("#portalSyncStatus");
  if (!status) return;
  status.dataset.state = state;
  status.textContent = text;
}

function renderVisiblePortalView() {
  if (visiblePortalView === "courts") renderCourts(portalBookingDate);
  else if (visiblePortalView === "shop") renderShop();
  else if (visiblePortalView === "home") renderHome();
  else if (visiblePortalView.startsWith("member:")) {
    const view = visiblePortalView.slice("member:".length);
    if (view === "overview" || view === "bookings") renderMemberContent(view);
  }
}

if (!isMember && session?.role === "member") {
  // A direct member URL remains a member experience.
}

if (isMember && session?.role !== "member") {
  sessionStorage.removeItem("playpulseSession");
  location.replace("/");
  window.playpulsePortalGuardBlocked = true;
}

const money = (n) => new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:0}).format(n);
const escapeHtml = (v) => String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");

const sample = {
  member:{name:"Aarav Mehta",id:"M-1001",plan:"Gold",expiry:"28 February 2027",phone:"98765 43210",balance:0},
  plans:[
    {name:"Gold",price:5000,featured:true,benefits:["Unlimited court access","2 free sessions per day","15% shop discount","15% bar discount"]},
    {name:"Silver",price:3000,featured:false,benefits:["Standard court access","25% court discount","10% shop discount","10% bar discount"]},
    {name:"Junior",price:1500,featured:false,benefits:["Junior court access","50% court discount","15% shop discount","10% bar discount"]}
  ],
  courts:[
    {id:"C-1",name:"Tennis Court 1",sport:"Tennis",price:1200,status:"Available"},
    {id:"C-2",name:"Tennis Court 2",sport:"Tennis",price:1200,status:"Available"},
    {id:"C-3",name:"Padel Court 1",sport:"Padel",price:1000,status:"Maintenance"},
    {id:"C-4",name:"Badminton Court 1",sport:"Badminton",price:800,status:"Available"},
    {id:"C-5",name:"Cricket Net 1",sport:"Cricket",price:1500,status:"Available"}
  ],
  products:[
    {id:"P-1",name:"Champions Pro Racket",category:"Rackets",price:4200,icon:"🎾"},
    {id:"P-2",name:"Court Training Shoes",category:"Footwear",price:3200,icon:"👟"},
    {id:"P-3",name:"Padel Balls - 3 Pack",category:"Balls",price:750,icon:"⚪"},
    {id:"P-4",name:"Dry-Fit Club Tee",category:"Apparel",price:1200,icon:"👕"},
    {id:"P-5",name:"Racket Grip Bundle",category:"Accessories",price:480,icon:"⌁"},
    {id:"P-6",name:"Champions Water Bottle",category:"Accessories",price:650,icon:"◒"}
  ],
  bookings:[
    {courtId:"C-1",court:"Tennis Court 1",date:"2026-11-21",time:"18:00",status:"Confirmed"},
    {courtId:"C-4",court:"Badminton Court 1",date:"2026-11-24",time:"19:30",status:"Confirmed"}
  ],
  memberBookings:[
    {courtId:"C-1",court:"Tennis Court 1",date:"2026-11-21",time:"18:00",status:"Confirmed"},
    {courtId:"C-4",court:"Badminton Court 1",date:"2026-11-24",time:"19:30",status:"Confirmed"}
  ],
  memberOrders:[],
  cart:[]
};

const accountButton = $("#accountButton");
if (isMember) {
  accountButton.textContent = "Aarav Mehta";
  accountButton.onclick = () => renderMember("overview");
} else {
  accountButton.textContent = "Member login";
  accountButton.onclick = () => location.href = "/";
}
$("#cartButton").onclick = () => openCart();

function renderHeaderNav() {
  $$(".public-nav button").forEach((button) => button.onclick = () => {
    $$(".public-nav button").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    renderPublic(button.dataset.portalView);
  });
}
renderHeaderNav();

function renderPublic(view) {
  visiblePortalView = view;
  if (isMember && view === "home") return renderMember("overview");
  if (view === "courts") return renderCourts();
  if (view === "shop") return renderShop();
  if (view === "plans") return renderPlans();
  if (view === "club") return renderClub();
  renderHome();
}

function renderHome() {
  $("#portalView").innerHTML = `
    <section class="hero"><div class="hero-content"><p class="eyebrow">Welcome to Champions Club</p><h1>Find your court.<br>Own your game.</h1><p>Play tennis, padel, badminton or cricket. Explore memberships, book a court and discover everything the club has to offer.</p><div class="hero-actions"><button class="hero-primary" data-public-action="book">Book a court</button><button class="hero-secondary" data-public-action="trial">Request a trial</button></div></div></section>
    <section class="section"><div class="section-head"><div><h2>Everything under one club</h2><p>Made for every part of your playing experience</p></div></div><div class="feature-grid">${[
      ["◉","Courts","Real-time availability for tennis, padel, badminton and cricket."],
      ["♙","Membership","Flexible Gold, Silver and Junior plans with clear benefits."],
      ["◇","Club Shop","Rackets, shoes, balls and accessories ready for collection."],
      ["♨","Cafeteria","Food and drinks to enjoy before or after a match."]
    ].map((item)=>`<article class="feature-card"><span>${item[0]}</span><h3>${item[1]}</h3><p>${item[2]}</p></article>`).join("")}</div></section>
    <section class="section" style="background:#f7f9f6"><div class="section-head"><div><h2>Choose your sport</h2><p>Professional courts and nets for every player</p></div></div><div class="sports-grid">${[
      ["Tennis","Competitive and recreational courts"],
      ["Padel","Fast-paced doubles play"],
      ["Badminton","Premium indoor courts"],
      ["Cricket","Professional practice nets"]
    ].map((item)=>`<article class="sport-card"><div><h3>${item[0]}</h3><p>${item[1]}</p></div></article>`).join("")}</div></section>
    <section class="section"><div class="section-head"><div><h2>Membership plans</h2><p>Choose the access and benefits that suit you</p></div><button class="text-button" data-portal-view-link="plans">Compare plans →</button></div>${plansHtml()}</section>`;
  bindPublicActions();
}

function plansHtml() {
  return `<div class="plan-grid">${sample.plans.map((plan)=>`<article class="plan-card ${plan.featured?"featured":""}"><div class="name">${plan.name}</div><div class="price">${money(plan.price)} <small>/ month</small></div><ul>${plan.benefits.map((item)=>`<li>${item}</li>`).join("")}</ul><button data-plan="${plan.name}">${isMember?"Manage plan":"Choose "+plan.name}</button></article>`).join("")}</div>`;
}

function renderPlans() {
  $("#portalView").innerHTML = `<section class="section"><div class="section-head"><div><h2>Membership plans</h2><p>Transparent pricing and automatic benefit calculation</p></div></div>${plansHtml()}</section>`;
  $$("[data-plan]").forEach((button)=>button.onclick=()=>openSimpleModal(`${button.dataset.plan} membership`,`<p>Plan request for <strong>${button.dataset.plan}</strong> is ready for the front desk.</p><div class="form-field"><label>Email</label><input id="planEmail" type="email" value="${isMember?"aarav.mehta@champions.club":""}" placeholder="you@example.com"></div>`,`Submit enquiry`,()=>toast(`${button.dataset.plan} membership enquiry submitted`)));
}

function renderCourts(date = portalBookingDate) {
  visiblePortalView = "courts";
  portalBookingDate = date;
  $("#portalView").innerHTML = `<section class="section"><div class="section-head"><div><h2>Courts & availability</h2><p>${formatBookingDate(date)}</p></div></div><div class="court-layout"><div class="court-list">${sample.courts.map((court)=>`<div class="court-row"><div><strong>${court.name}</strong><small>${court.sport} · ${money(court.price)} / hour · ${court.status}</small></div><button ${court.status!=="Available"? "disabled":""} data-court="${court.id}">${court.status==="Available"?"View slots":"Unavailable"}</button></div>`).join("")}</div><aside class="booking-card"><h3>Quick booking</h3><div class="form-field"><label for="portalCourt">Court</label><select id="portalCourt">${sample.courts.filter((c)=>c.status==="Available").map((c)=>`<option value="${c.id}">${c.name}</option>`).join("")}</select></div><div class="form-field"><label for="portalDate">Date</label><input id="portalDate" type="date" value="${date}"></div><div class="form-field"><label for="portalTime">Time</label><select id="portalTime"></select></div><button id="quickBook">Check & book</button></aside></div></section>`;
  const updateTimes = (preferredTime) => {
    const courtId = $("#portalCourt").value;
    const selectedDate = $("#portalDate").value;
    const chosenTime = firstAvailableBookingTime(sample.bookings, courtId, selectedDate, preferredTime);
    $("#portalTime").innerHTML = bookingTimes.map((time) => {
      const booked = isSlotBooked(sample.bookings, courtId, selectedDate, time);
      return `<option value="${time}" ${booked ? "disabled" : ""}>${time}${booked ? " — Booked" : ""}</option>`;
    }).join("");
    $("#portalTime").value = chosenTime;
  };
  updateTimes();
  $$("[data-court]").forEach((button)=>button.onclick=()=>{ $("#portalCourt").value=button.dataset.court; updateTimes(); });
  $("#portalCourt").onchange=()=>updateTimes();
  $("#portalDate").onchange=()=>{ portalBookingDate=$("#portalDate").value; updateTimes(); };
  $("#quickBook").onclick=()=>{
    const courtId=$("#portalCourt").value;
    const court=sample.courts.find((item)=>item.id===courtId);
    const selectedDate=$("#portalDate").value;
    const time=$("#portalTime").value;
    if (!court || !selectedDate || !time) return toast("Choose an available court, date and time");
    if (isSlotBooked(sample.bookings,courtId,selectedDate,time)) {
      updateTimes();
      return toast("That court slot is no longer available. Choose another time.");
    }
    openSimpleModal("Confirm court booking",`<p><strong>${court.name}</strong> on <strong>${formatBookingDate(selectedDate)}</strong> at <strong>${time}</strong>.</p><p>Estimated price: <strong>${isMember?"₹0 – included in Gold benefits":money(court.price)}</strong>.</p>`,`Confirm booking`,async()=>{
      if (isSlotBooked(sample.bookings,courtId,selectedDate,time)) {
        toast("That court slot is no longer available. Choose another time.");
        renderCourts(selectedDate);
        return;
      }
      if (sharedPublicReady) {
        try {
          const response = await fetch("/api/v1/demo-data/public/bookings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ courtId, date: selectedDate, time }),
          });
          if (response.status === 409) {
            await refreshSharedPublicData(false);
            toast("That slot was just booked. Availability has been refreshed.");
            return;
          }
          if (!response.ok) throw new Error(`Booking request failed (${response.status})`);
          await refreshSharedPublicData(false);
          toast("Court booking confirmed and shared with the club");
        } catch (error) {
          console.error("Unable to create shared court booking", error);
          updatePortalSyncStatus("error", "Booking sync failed");
          toast("The server could not confirm this booking. Please try again.");
        }
        return;
      }
      sample.bookings.push({courtId,court:court.name,date:selectedDate,time,status:"Confirmed"});
      toast("Demo booking confirmed locally only");
      renderCourts(selectedDate);
    });
  };
}

function renderShop() {
  visiblePortalView = "shop";
  $("#portalView").innerHTML = `<section class="section"><div class="section-head"><div><h2>Club shop</h2><p>Collection and delivery options available</p></div></div><div class="shop-tools"><input id="shopSearch" placeholder="Search rackets, shoes or apparel"><button data-category="">All</button><button data-category="Rackets">Rackets</button><button data-category="Footwear">Shoes</button><button data-category="Balls">Balls</button><button data-category="Apparel">Apparel</button></div><div class="product-grid" id="portalProducts">${shopCards("")}</div></section>`;
  $("#shopSearch").oninput=()=>{$("#portalProducts").innerHTML=shopCards("",$("#shopSearch").value)};
  $$("[data-category]").forEach((button)=>button.onclick=()=>{$("#portalProducts").innerHTML=shopCards(button.dataset.category,$("#shopSearch").value)});
}

function shopCards(category="",query="") {
  return sample.products.filter((p)=>(!category||p.category===category)&&`${p.name} ${p.category}`.toLowerCase().includes(query.toLowerCase())).map((p)=>`<article class="product-card"><div class="product-art">${p.icon}</div><h3>${p.name}</h3><p>${p.category}</p><div class="product-bottom"><strong>${money(p.price)}</strong><button data-add-product="${p.id}">Add to bag</button></div></article>`).join("");
}

function renderClub() {
  $("#portalView").innerHTML = `<section class="section"><div class="section-head"><div><h2>About Champions Club</h2><p>The club for tennis, padel, badminton and cricket</p></div></div><div class="feature-grid"><article class="feature-card"><h3>Professional facilities</h3><p>Five courts and nets with hourly booking, social play and coaching.</p></article><article class="feature-card"><h3>Sports shop</h3><p>Essential equipment with in-club pickup and delivery.</p></article><article class="feature-card"><h3>Cafeteria</h3><p>Food and drinks available before and after your match.</p></article><article class="feature-card"><h3>Club community</h3><p>Membership plans, trials, match-making and social play.</p></article></div></section>`;
}

function renderMember(view) {
  visiblePortalView = `member:${view}`;
  const initials = sample.member.name.split(/\s+/).map((part)=>part[0]).join("").slice(0,2).toUpperCase();
  $("#portalView").innerHTML = `<div class="member-shell"><aside class="member-sidebar"><div class="member-profile"><span class="member-avatar">${initials}</span><div><strong>${escapeHtml(sample.member.name)}</strong><small>${escapeHtml(sample.member.plan)} member</small></div></div><nav class="member-nav"><button class="active" data-member-view="overview">Overview</button><button data-member-view="bookings">My bookings</button><button data-member-view="shop">My orders</button><button data-member-view="membership">Membership</button><button data-member-view="billing">Billing</button><button data-member-view="account">Account</button><button data-member-view="switch">Log in / switch account</button><button data-member-view="logout">Log out</button></nav></aside><section class="member-content" id="memberContent"></section></div>`;
  $$("[data-member-view]").forEach((button)=>button.onclick=()=>{
    $$(".member-nav button").forEach((item)=>item.classList.remove("active"));
    button.classList.add("active");
    if (button.dataset.memberView==="logout" || button.dataset.memberView==="switch") {
      sessionStorage.removeItem("playpulseSession");
      fetch("/api/v1/auth/demo-logout", { method: "POST" }).finally(() => {
        location.href="/";
      });
      return;
    }
    renderMemberContent(button.dataset.memberView);
  });
  renderMemberContent(view);
}

function renderMemberContent(view) {
  const content=$("#memberContent");
  if (!content) return;
  if (view==="bookings") {
    content.innerHTML=`<div class="section-head"><div><h2>My bookings</h2><p>Upcoming court reservations</p></div><button class="account-button" data-member-book>New booking</button></div><div class="member-card">${sample.memberBookings.map((b)=>`<div class="member-row"><span><strong>${b.court}</strong><br><small>${formatBookingDate(b.date)} · ${b.time}</small></span><span>${b.status}</span></div>`).join("") || "<p>No bookings yet.</p>"}</div>`;
    $("[data-member-book]",content).onclick=()=>{renderCourts();};
  } else if (view==="shop") {
    content.innerHTML=`<div class="section-head"><div><h2>My orders</h2><p>Recent shop orders</p></div></div><div class="member-card">${sample.memberOrders.map((order)=>`<div class="member-row"><span><strong>${escapeHtml(order.id)}</strong><br><small>${escapeHtml(order.fulfillment)} · ${formatBookingDate(order.date)}</small></span><strong>${escapeHtml(order.status)} · ${money(order.total)}</strong></div>`).join("") || "<p>No orders yet.</p>"}</div>`;
  } else if (view==="membership") {
    const activePlan = sample.plans.find((plan)=>plan.name===sample.member.plan);
    content.innerHTML=`<div class="section-head"><div><h2>Membership</h2><p>Your active plan and benefits</p></div></div><div class="member-card"><div class="member-row"><span>Plan</span><strong>${escapeHtml(sample.member.plan)}</strong></div><div class="member-row"><span>Member ID</span><strong>${escapeHtml(sample.member.id)}</strong></div><div class="member-row"><span>Expiry</span><strong>${formatBookingDate(sample.member.expiry)}</strong></div><div class="member-row"><span>Monthly fee</span><strong>${money(activePlan?.price ?? 0)}</strong></div></div>`;
  } else if (view==="billing") {
    content.innerHTML=`<div class="section-head"><div><h2>Billing</h2><p>Recent orders and account balance</p></div></div><div class="member-card">${sample.memberOrders.map((order)=>`<div class="member-row"><span>${escapeHtml(order.id)}</span><strong>${money(order.total)} · ${escapeHtml(order.status)}</strong></div>`).join("")}<div class="member-row"><span>Outstanding balance</span><strong>${money(sample.member.balance)}</strong></div></div>`;
  } else if (view==="account") {
    content.innerHTML=`<div class="section-head"><div><h2>Account</h2><p>Member profile and security</p></div></div><div class="member-card"><div class="member-row"><span>Email</span><strong>aarav.mehta@champions.club</strong></div><div class="member-row"><span>Phone</span><strong>${escapeHtml(sample.member.phone)}</strong></div><div class="member-row"><span>Password</span><button class="text-button" data-reset-password>Reset password</button></div></div>`;
    $("[data-reset-password]",content).onclick=()=>toast("Password reset instructions prepared");
  } else {
    content.innerHTML=`<div class="section-head"><div><h2>Good evening, ${escapeHtml(sample.member.name)}</h2><p>Here is your club activity</p></div><button class="account-button" data-member-book>Book court</button></div><div class="member-stats"><div class="member-stat"><span>Membership</span><strong>${escapeHtml(sample.member.plan)}</strong></div><div class="member-stat"><span>Sessions this month</span><strong>${sample.memberBookings.length}</strong></div><div class="member-stat"><span>Outstanding</span><strong>${money(sample.member.balance)}</strong></div></div><div class="member-card-grid"><div class="member-card"><h3>Upcoming bookings</h3>${sample.memberBookings.map((b)=>`<div class="member-row"><span><strong>${escapeHtml(b.court)}</strong><br><small>${formatBookingDate(b.date)} · ${b.time}</small></span><span>${escapeHtml(b.status)}</span></div>`).join("") || "<p>No bookings yet.</p>"}</div><div class="member-card"><h3>Membership benefits</h3><div class="member-row"><span>Free court sessions</span><strong>2 / day</strong></div><div class="member-row"><span>Shop discount</span><strong>15%</strong></div><div class="member-row"><span>Bar discount</span><strong>15%</strong></div></div></div>`;
    $("[data-member-book]",content).onclick=()=>{renderCourts();};
  }
}

function bindPublicActions() {
  $$("[data-public-action]").forEach((button)=>button.onclick=()=>{
    if (button.dataset.publicAction==="book") renderCourts();
    if (button.dataset.publicAction==="trial") openSimpleModal("Request a trial","<div class=\"form-field\"><label>Name</label><input id=\"trialName\"></div><div class=\"form-field\"><label>Phone</label><input id=\"trialPhone\"></div><div class=\"form-field\"><label>Sport</label><select id=\"trialSport\"><option>Tennis</option><option>Padel</option><option>Badminton</option><option>Cricket</option></select></div>","Send enquiry",()=>toast("Trial request submitted"));
  });
  $$("[data-plan]").forEach((button)=>button.onclick=()=>openSimpleModal(`${button.dataset.plan} membership`,`<p>Plan request for <strong>${button.dataset.plan}</strong>.</p><div class="form-field"><label>Email</label><input id="planEmail" type="email" placeholder="you@example.com"></div>`,"Submit",()=>toast("Membership enquiry submitted")));
  $$("[data-portal-view-link]").forEach((button)=>button.onclick=()=>renderPlans());
}

function openSimpleModal(title,body,submitLabel,onSubmit) {
  $("#portalModal").innerHTML=`<h2>${title}</h2>${body}<div class="modal-actions"><button class="cancel" id="modalCancel">Cancel</button><button class="confirm" id="modalConfirm">${submitLabel}</button></div>`;
  $("#portalModalBackdrop").classList.add("open");
  $("#portalModalBackdrop").setAttribute("aria-hidden","false");
  $("#modalCancel").onclick=closeModal;
  $("#modalConfirm").onclick=()=>{closeModal();onSubmit();}
}
function closeModal() { $("#portalModalBackdrop").classList.remove("open"); $("#portalModalBackdrop").setAttribute("aria-hidden","true"); }
$("#portalModalBackdrop").onclick=(event)=>{if(event.target===event.currentTarget)closeModal();};

function openCart() {
  openSimpleModal("Your bag",sample.cart.length?sample.cart.map((p)=>`<div class="member-row"><span>${p.name}</span><strong>${money(p.price)}</strong></div>`).join(""):`<p>Your bag is empty.</p>`,"Continue",()=>toast("Checkout is available in the member prototype"));
}

document.addEventListener("click",(event)=>{
  const add=event.target.closest("[data-add-product]");
  if(add){
    const product=sample.products.find((p)=>p.id===add.dataset.addProduct);
    sample.cart.push(product);
    $("#cartCount").textContent=sample.cart.length;
    toast(`${product.name} added to bag`);
  }
});

if(isMember) {
  renderMember("overview");
} else {
  renderHome();
}

async function refreshSharedPublicData(announce) {
  const response = await fetch("/api/v1/demo-data/public");
  if (!response.ok) throw new Error(`Shared public data unavailable (${response.status})`);
  const body = await response.json();
  const state = body.data.state;
  const version = Number(body.data.version);
  if (!state || version <= sharedPublicVersion) return;
  sample.courts = state.courts;
  if (state.member) sample.member = state.member;
  if (state.memberOrders) sample.memberOrders = state.memberOrders;
  if (isMember && state.member) accountButton.textContent = state.member.name;
  sample.plans = state.plans.map((plan)=>({
    name:plan.name,
    price:plan.price,
    featured:plan.name===sample.member?.plan,
    benefits:[
      `${plan.freeSessions} free sessions per day`,
      `${plan.courtDiscount}% court discount`,
      `${plan.shopDiscount}% shop discount`,
      `${plan.barDiscount}% bar discount`,
    ],
  }));
  sample.bookings = state.bookings.map((booking) => ({
    ...booking,
    court: state.courts.find((court) => court.id === booking.courtId)?.name || "Court",
  }));
  if (state.memberBookings) {
    sample.memberBookings = state.memberBookings.map((booking) => ({
      ...booking,
      court: state.courts.find((court) => court.id === booking.courtId)?.name || "Court",
    }));
  }
  sample.products = state.products;
  sharedPublicVersion = version;
  sharedPublicReady = true;
  sharedPublicRetryDelay = 1000;
  updatePortalSyncStatus("live", `Live · ${syncTimeLabel()}`);
  renderVisiblePortalView();
  if (announce) toast("Club availability and catalog updated");
}

function syncTimeLabel() {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit"
  }).format(new Date());
}

function scheduleSharedPublicRetry(error) {
  const match = error instanceof Error ? error.message.match(/\((\d{3})\)/) : null;
  const status = match ? Number(match[1]) : null;
  if (status !== null && status < 500) {
    updatePortalSyncStatus("error", "Live sync unavailable for this request");
    return;
  }
  const delay = sharedPublicRetryDelay;
  sharedPublicRetryDelay = Math.min(sharedPublicRetryDelay * 2, 30_000);
  updatePortalSyncStatus("connecting", `Live sync unavailable · retrying in ${Math.ceil(delay / 1000)}s`);
  clearTimeout(sharedPublicRetryTimer);
  sharedPublicRetryTimer = setTimeout(() => void initializeSharedPublicData(), delay);
}

function connectSharedPublicEvents() {
  const events = new EventSource("/api/v1/demo-data/public/events");
  sharedPublicEventSource = events;
  events.onopen = async () => {
    if (sharedPublicEventSource !== events) return;
    clearTimeout(sharedPublicEventRetryTimer);
    sharedPublicEventRetryDelay = 1000;
    if (sharedPublicReady) updatePortalSyncStatus("live", `Live · ${syncTimeLabel()}`);
    try {
      await refreshSharedPublicData(false);
    } catch (error) {
      console.error("Unable to catch up with live club data", error);
      updatePortalSyncStatus("error", "Live refresh failed");
    }
  };
  events.onmessage = async (event) => {
    try {
      const notification = JSON.parse(event.data);
      if (Number(notification.version) > sharedPublicVersion) {
        await refreshSharedPublicData(true);
      }
    } catch (error) {
      console.error("Unable to refresh live club data", error);
      updatePortalSyncStatus("error", "Live refresh failed");
    }
  };
  events.onerror = () => {
    if (sharedPublicEventSource !== events) return;
    events.close();
    sharedPublicEventSource = undefined;
    const delay = sharedPublicEventRetryDelay;
    sharedPublicEventRetryDelay = Math.min(sharedPublicEventRetryDelay * 2, 30_000);
    updatePortalSyncStatus("connecting", `Reconnecting live data in ${Math.ceil(delay / 1000)}s…`);
    clearTimeout(sharedPublicEventRetryTimer);
    sharedPublicEventRetryTimer = setTimeout(connectSharedPublicEvents, delay);
  };
}

async function initializeSharedPublicData() {
  try {
    await refreshSharedPublicData(false);
    if (!sharedPublicReady) updatePortalSyncStatus("connecting", "Waiting for shared club data…");
    connectSharedPublicEvents();
  } catch (error) {
    console.error("Shared club data is unavailable", error);
    updatePortalSyncStatus("local", "Local demo only · sync retrying");
    scheduleSharedPublicRetry(error);
  }
}

void initializeSharedPublicData();
