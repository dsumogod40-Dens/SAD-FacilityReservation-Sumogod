// ==========================================
// Reservations Module
// ==========================================

let allReservations = [];

// ---------- LOAD RESERVATIONS TABLE ----------
async function loadReservations() {
  const { data, error } = await supabaseClient
    .from("reservations")
    .select("*, facilities(facility_name, location, condition_status)")
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    return;
  }

  allReservations = data;
  renderReservationsTable(allReservations);
}

function renderReservationsTable(list) {
  const tbody = document.getElementById("reservationsTableBody");
  const emptyState = document.getElementById("reservationsEmptyState");
  tbody.innerHTML = "";

  // Requesters only see their own reservations (RLS also enforces this server-side)
  let visibleList = list;
  if (currentUserProfile && currentUserProfile.role === "Requester") {
    visibleList = list.filter(r => r.requester_id === currentUserProfile.id);
  }

  if (visibleList.length === 0) {
    emptyState.classList.remove("hidden");
    return;
  }
  emptyState.classList.add("hidden");

  visibleList.forEach(res => {
    const badgeClass = statusClass(res.status);
    const facilityLabel = res.facilities ? res.facilities.facility_name : "Unknown";
    const actions = buildReservationActions(res);

    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${facilityLabel}</td>
      <td>${res.purpose || "-"}</td>
      <td>${new Date(res.start_time).toLocaleString()}</td>
      <td>${new Date(res.end_time).toLocaleString()}</td>
      <td><span class="badge ${badgeClass}">${res.status}</span></td>
      <td>${actions}</td>
    `;
    tbody.appendChild(row);
  });
}

// ---------- BUILD ACTION BUTTONS PER ROW BASED ON ROLE + STATUS ----------
function buildReservationActions(res) {
  const role = currentUserProfile ? currentUserProfile.role : null;
  const isOwner = currentUserProfile && res.requester_id === currentUserProfile.id;
  let buttons = "";

  // BR-B4-07: Completed reservations cannot be edited / actioned further
  if (res.status === "Completed" || res.status === "Cancelled" || res.status === "Rejected") {
    return "-";
  }

  // BR-B4-04: Only Administrator may approve/reject
  if (role === "Administrator" && res.status === "Pending") {
    buttons += `<button class="btn btn-success btn-sm" onclick="approveReservation(${res.id})">Approve</button>
                <button class="btn btn-danger btn-sm" onclick="rejectReservation(${res.id})">Reject</button>`;
  }

  // Facility Staff / Administrator: confirm usage and completion
  if ((role === "Administrator" || role === "Facility Staff") && res.status === "Scheduled") {
    buttons += `<button class="btn btn-primary btn-sm" onclick="markInUse(${res.id})">Mark In Use</button>`;
  }
  if ((role === "Administrator" || role === "Facility Staff") && res.status === "In Use") {
    buttons += `<button class="btn btn-primary btn-sm" onclick="markCompleted(${res.id})">Mark Completed</button>`;
  }

  // BR-B4-09: Requester may cancel only their own Pending requests
  if (role === "Requester" && isOwner && res.status === "Pending") {
    buttons += `<button class="btn btn-danger btn-sm" onclick="cancelReservation(${res.id})">Cancel</button>`;
  }

  return buttons || "-";
}

// ---------- MODAL: NEW RESERVATION (Requester) ----------
const reservationModalOverlay = document.getElementById("reservationModalOverlay");
const reservationForm = document.getElementById("reservationForm");
const reservationFormError = document.getElementById("reservationFormError");

function openReservationModal() {
  reservationForm.reset();
  reservationFormError.textContent = "";
  populateFacilityDropdown();
  reservationModalOverlay.classList.add("active");
}

function closeReservationModal() {
  reservationModalOverlay.classList.remove("active");
}

reservationForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  reservationFormError.textContent = "";

  const facilityId = document.getElementById("resFacility").value;
  const purpose = document.getElementById("resPurpose").value.trim();
  const startTime = document.getElementById("resStart").value;
  const endTime = document.getElementById("resEnd").value;

  if (!facilityId) {
    reservationFormError.textContent = "Please select a facility.";
    return;
  }

  // BR-B4-02: start must precede end
  if (new Date(startTime) >= new Date(endTime)) {
    reservationFormError.textContent = "Start time must be before end time.";
    return;
  }

  // BR-B4-01 / BR-B4-08: only Active facilities may be reserved
  const facility = allFacilities.find(f => f.id == facilityId);
  if (!facility || facility.condition_status !== "Active") {
    reservationFormError.textContent = "This facility is not available for reservation.";
    return;
  }

  const { data: { session } } = await supabaseClient.auth.getSession();

  const { data, error } = await supabaseClient
    .from("reservations")
    .insert({
      facility_id: facilityId,
      requester_id: session.user.id,
      purpose: purpose,
      start_time: startTime,
      end_time: endTime,
      status: "Pending",
    })
    .select()
    .single();

  if (error) {
    reservationFormError.textContent = "Error: " + error.message;
    return;
  }

  await logAudit("Reservation Submitted", "reservations", data.id, `Submitted reservation for facility ID ${facilityId}`);

  closeReservationModal();
  await loadReservations();
  await loadDashboardStats();
});

// ---------- CONFLICT CHECK (BR-B4-03) ----------
// Overlapping schedules among Approved/Scheduled/In Use for the same facility are prohibited.
function hasSchedulingConflict(reservation, excludeId) {
  return allReservations.some(r => {
    if (r.id === excludeId) return false;
    if (r.facility_id !== reservation.facility_id) return false;
    if (!["Approved", "Scheduled", "In Use"].includes(r.status)) return false;

    const existingStart = new Date(r.start_time);
    const existingEnd = new Date(r.end_time);
    const newStart = new Date(reservation.start_time);
    const newEnd = new Date(reservation.end_time);

    return existingStart < newEnd && existingEnd > newStart;
  });
}

// ---------- APPROVE (Administrator only, BR-B4-04) ----------
async function approveReservation(id) {
  const res = allReservations.find(r => r.id === id);
  if (!res) return;

  // BR-B4-03: block overlapping approved/scheduled reservations
  if (hasSchedulingConflict(res, id)) {
    alert("Cannot approve: this time slot conflicts with an existing approved/scheduled reservation for the same facility.");
    return;
  }

  const confirmed = confirm("Approve this reservation? It will be scheduled and the time slot reserved (BR-B4-06).");
  if (!confirmed) return;

  const { data: { session } } = await supabaseClient.auth.getSession();

  // Approved reservations move directly to Scheduled, reserving the time slot (BR-B4-06)
  const { error } = await supabaseClient
    .from("reservations")
    .update({ status: "Scheduled", reviewed_by: session.user.id, reviewed_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    alert("Error approving reservation: " + error.message);
    return;
  }

  await logAudit("Reservation Approved", "reservations", id, "Status changed to Scheduled");
  await loadReservations();
  await loadDashboardStats();
}

// ---------- REJECT (Administrator only, BR-B4-04 / BR-B4-05) ----------
async function rejectReservation(id) {
  const confirmed = confirm("Reject this reservation? Rejected reservations cannot be scheduled later (BR-B4-05).");
  if (!confirmed) return;

  const { data: { session } } = await supabaseClient.auth.getSession();

  const { error } = await supabaseClient
    .from("reservations")
    .update({ status: "Rejected", reviewed_by: session.user.id, reviewed_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    alert("Error rejecting reservation: " + error.message);
    return;
  }

  await logAudit("Reservation Rejected", "reservations", id, "Status changed to Rejected");
  await loadReservations();
  await loadDashboardStats();
}

// ---------- MARK IN USE (Facility Staff / Administrator) ----------
async function markInUse(id) {
  const { error } = await supabaseClient.from("reservations").update({ status: "In Use" }).eq("id", id);
  if (error) {
    alert("Error: " + error.message);
    return;
  }
  await logAudit("Status Changed", "reservations", id, "Status changed to In Use");
  await loadReservations();
  await loadDashboardStats();
}

// ---------- MARK COMPLETED (Facility Staff / Administrator, BR-B4-07) ----------
async function markCompleted(id) {
  const { error } = await supabaseClient.from("reservations").update({ status: "Completed" }).eq("id", id);
  if (error) {
    alert("Error: " + error.message);
    return;
  }
  await logAudit("Status Changed", "reservations", id, "Status changed to Completed");
  await loadReservations();
  await loadDashboardStats();
}

// ---------- CANCEL (Requester, own Pending only - BR-B4-09) ----------
async function cancelReservation(id) {
  const confirmed = confirm("Cancel this reservation request?");
  if (!confirmed) return;

  const { error } = await supabaseClient.from("reservations").update({ status: "Cancelled" }).eq("id", id);
  if (error) {
    alert("Error: " + error.message);
    return;
  }
  await logAudit("Reservation Cancelled", "reservations", id, "Cancelled by requester");
  await loadReservations();
  await loadDashboardStats();
}
