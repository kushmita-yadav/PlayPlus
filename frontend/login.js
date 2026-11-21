const demoAccounts = {
  admin: { email: "admin@champions.club", password: "Admin@123", role: "admin", name: "Alex Kumar" },
  member: { email: "member@champions.club", password: "Member@123", role: "member", name: "Aarav Mehta" }
};

let selectedRole = "admin";
const $ = (selector) => document.querySelector(selector);

function $$(selector) { return [...document.querySelectorAll(selector)]; }

function setRole(role) {
  selectedRole = role;
  $$(".role-tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.role === role));
  const form = $("#loginForm");
  const visitorAction = $("#visitorAction");
  const credentials = $("#demoCredentials");
  $("#loginError").textContent = "";
  if (role === "visitor") {
    form.hidden = true;
    visitorAction.hidden = false;
    credentials.hidden = true;
  } else {
    form.hidden = false;
    visitorAction.hidden = true;
    credentials.hidden = false;
    $("#email").value = demoAccounts[role].email;
    $("#password").value = demoAccounts[role].password;
    $("#demoEmail").textContent = demoAccounts[role].email;
    $("#demoPassword").textContent = demoAccounts[role].password;
  }
}

$$(".role-tab").forEach((tab) => tab.addEventListener("click", () => setRole(tab.dataset.role)));
setRole("admin");

$("#togglePassword").addEventListener("click", () => {
  const password = $("#password");
  password.type = password.type === "password" ? "text" : "password";
  $("#togglePassword").textContent = password.type === "password" ? "Show" : "Hide";
});

$("#forgotButton").addEventListener("click", () => {
  $("#loginError").textContent = "Password reset is available after the backend email provider is configured.";
});

$("#visitorButton").addEventListener("click", () => {
  sessionStorage.setItem("playpulseSession", JSON.stringify({ role: "visitor", name: "Visitor" }));
  window.location.href = "/portal?mode=visitor";
});

$("#loginForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const account = demoAccounts[selectedRole];
  if (!account) return;
  const email = $("#email").value.trim().toLowerCase();
  const password = $("#password").value;
  if (email !== account.email || password !== account.password) {
    $("#loginError").textContent = "Use the displayed demo email and password.";
    return;
  }
  sessionStorage.setItem("playpulseSession", JSON.stringify({
    role: account.role,
    name: account.name,
    email: account.email
  }));
  window.location.href = account.role === "admin" ? "/admin" : "/portal?mode=member";
});
