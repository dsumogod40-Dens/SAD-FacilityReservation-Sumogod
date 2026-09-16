// ==========================================
// Facilities Module
// ==========================================

let allFacilities = [];

function statusClass(status) {
  return status.toLowerCase().replace(/\s+/g, "-");
}

// ---------- LOAD DASHBOARD STATS ----------
async function loadDashboardStats() {
  const { data: facilityData, error: fError } = await supabaseClient.from("facilities").select("*");
  const { data: resData, error: rError } = await supabaseClient.from("reservations").select("*");

  if (fError || rError) {
    console.error(fError || rError);
    return;
  }

  const totalFacilities = facilityData.length;
  const activeFacilities = facilityData.filter(f => f.condition_status === "Active").length;
  const pending = resData.filter(r => r.status === "Pending").length;
  const scheduled = resData.filter(r => r.status === "Scheduled" || r.status === "Approved").length;
  const completed = resData.filter(r => r.status === "Completed").length;

  document.getElementById("statTotal").textContent = totalFacilities;
  document.getElementById("statActive").textContent = activeFacilities;
  document.getElementById("statPending").textContent = pending;
  document.getElementById("statScheduled").textContent = scheduled;
  document.getElementById("statCompleted").textContent = completed;
}

// ---------- LOAD FACILITIES TABLE ----------
async function loadFacilities() {
  const { data, error } = await supabaseClient
    .from("facilities")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    return;
  }

  allFacilities = data;
  renderFacilitiesTable(allFacilities);
  populateFacilityDropdown();
}

function renderFacilitiesTable(list) {
  const tbody = document.getElementById("facilitiesTableBody");
  const emptyState = document.getElementById("facilitiesEmptyState");
  tbody.innerHTML = "";

  if (list.length === 0) {
    emptyState.classList.remove("hidden");
    return;
  }
  emptyState.classList.add("hidden");

  const isAdmin = currentUserProfile && currentUserProfile.role === "Administrator";

  list.forEach(item => {
    const badgeClass = statusClass(item.condition_status);
    const actions = isAdmin
      ? `<button class="btn btn-secondary btn-sm" onclick="editFacility(${item.id})">Edit</button>
         <button class="btn btn-danger btn-sm" onclick="deleteFacility(${item.id})">Delete</button>`
      : "";

    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${item.facility_name}</td>
      <td>${item.facility_type || "-"}</td>
      <td>${item.location || "-"}</td>
      <td>${item.capacity ?? "-"}</td>
      <td><span class="badge ${badgeClass}">${item.condition_status}</span></td>
      <td>${actions}</td>
    `;
    tbody.appendChild(row);
  });
}

// ---------- ADD / EDIT MODAL (Administrator only) ----------
const facilityModalOverlay = document.getElementById("facilityModalOverlay");
const facilityForm = document.getElementById("facilityForm");
const facilityFormError = document.getElementById("facilityFormError");

function openFacilityModal() {
  document.getElementById("facilityModalTitle").textContent = "Add Facility";
  facilityForm.reset();
  document.getElementById("facilityId").value = "";
  facilityFormError.textContent = "";
  facilityModalOverlay.classList.add("active");
}

function closeFacilityModal() {
  facilityModalOverlay.classList.remove("active");
}

function editFacility(id) {
  const item = allFacilities.find(f => f.id === id);
  if (!item) return;

  document.getElementById("facilityModalTitle").textContent = "Edit Facility";
  document.getElementById("facilityId").value = item.id;
  document.getElementById("facilityName").value = item.facility_name;
  document.getElementById("facilityType").value = item.facility_type || "";
  document.getElementById("facilityLocation").value = item.location || "";
  document.getElementById("facilityCapacity").value = item.capacity || "";
  document.getElementById("facilityCondition").value = item.condition_status;
  facilityFormError.textContent = "";
  facilityModalOverlay.classList.add("active");
}

facilityForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  facilityFormError.textContent = "";

  const id = document.getElementById("facilityId").value;
  const name = document.getElementById("facilityName").value.trim();
  const type = document.getElementById("facilityType").value.trim();
  const location = document.getElementById("facilityLocation").value.trim();
  const capacity = document.getElementById("facilityCapacity").value || null;
  const condition = document.getElementById("facilityCondition").value;

  if (!name) {
    facilityFormError.textContent = "Facility name cannot be empty.";
    return;
  }

  const payload = {
    facility_name: name,
    facility_type: type,
    location: location,
    capacity: capacity,
    condition_status: condition,
  };

  if (id) {
    const { error } = await supabaseClient.from("facilities").update(payload).eq("id", id);
    if (error) {
      facilityFormError.textContent = "Error: " + error.message;
      return;
    }
    await logAudit("Facility Updated", "facilities", id, `Updated facility: ${name}`);
  } else {
    const { data, error } = await supabaseClient.from("facilities").insert(payload).select().single();
    if (error) {
      facilityFormError.textContent = "Error: " + error.message;
      return;
    }
    await logAudit("Facility Created", "facilities", data.id, `Created facility: ${name}`);
  }

  closeFacilityModal();
  await loadFacilities();
  await loadDashboardStats();
});

async function deleteFacility(id) {
  const confirmed = confirm("Are you sure you want to delete this facility?");
  if (!confirmed) return;

  const { error } = await supabaseClient.from("facilities").delete().eq("id", id);

  if (error) {
    if (error.code === "23503") {
      alert("This facility cannot be deleted because it has existing reservation history.");
    } else {
      alert("Error deleting facility: " + error.message);
    }
    return;
  }

  await logAudit("Facility Deleted", "facilities", id, `Deleted facility ID ${id}`);
  await loadFacilities();
  await loadDashboardStats();
}

// ---------- POPULATE FACILITY DROPDOWN FOR RESERVATION FORM ----------
// BR-B4-01 / BR-B4-08: only Active facilities may be reserved
function populateFacilityDropdown() {
  const select = document.getElementById("resFacility");
  if (!select) return;
  select.innerHTML = "";

  const activeFacilities = allFacilities.filter(f => f.condition_status === "Active");

  if (activeFacilities.length === 0) {
    select.innerHTML = `<option value="">No active facilities available</option>`;
    return;
  }

  activeFacilities.forEach(item => {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = `${item.facility_name} (${item.location || "N/A"})`;
    select.appendChild(option);
  });
}
