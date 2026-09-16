// ==========================================
// Authentication Logic + Role Detection
// ==========================================

let currentUserProfile = null; // { id, full_name, role }

// ---- LOGIN (used in login.html) ----
const loginForm = document.getElementById("loginForm");

if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    const errorMessage = document.getElementById("errorMessage");
    errorMessage.textContent = "";

    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email: email,
      password: password,
    });

    if (error) {
      errorMessage.textContent = "Login failed: " + error.message;
      return;
    }

    window.location.href = "index.html";
  });
}

// ---- LOGOUT (used in index.html) ----
async function logout() {
  await supabaseClient.auth.signOut();
  window.location.href = "login.html";
}

// ---- SESSION CHECK (protects index.html) ----
async function requireLogin() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) {
    window.location.href = "login.html";
    return null;
  }
  return session;
}

// ---- LOAD CURRENT USER'S PROFILE (id, name, role) ----
// Must be called after requireLogin(). Populates currentUserProfile
// and applies role-based UI visibility.
async function loadCurrentUserProfile() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return null;

  const { data, error } = await supabaseClient
    .from("profiles")
    .select("id, full_name, role")
    .eq("id", session.user.id)
    .single();

  if (error) {
    console.error("Could not load profile:", error);
    return null;
  }

  currentUserProfile = data;
  applyRoleBasedUI(currentUserProfile.role);
  return currentUserProfile;
}

// ---- APPLY ROLE-BASED UI VISIBILITY ----
// Elements are tagged with data-roles="Administrator,Facility Staff"
// If the element has a data-roles attribute, it is only shown to those roles.
function applyRoleBasedUI(role) {
  document.getElementById("userNameLabel").textContent = currentUserProfile.full_name;
  document.getElementById("userRoleLabel").textContent = role;

  document.querySelectorAll("[data-roles]").forEach((el) => {
    const allowedRoles = el.getAttribute("data-roles").split(",").map(r => r.trim());
    if (allowedRoles.includes(role)) {
      el.classList.remove("hidden");
    } else {
      el.classList.add("hidden");
    }
  });
}

// ---- AUDIT LOG HELPER (BR-B4-10) ----
async function logAudit(action, tableName, recordId, details) {
  const { data: { session } } = await supabaseClient.auth.getSession();
  const actorId = session ? session.user.id : null;

  const { error } = await supabaseClient.from("audit_logs").insert({
    actor_id: actorId,
    action: action,
    table_name: tableName,
    record_id: recordId,
    details: details,
  });

  if (error) {
    console.error("Failed to write audit log:", error);
  }
}
