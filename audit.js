// ==========================================
// Audit Log Module (Administrator only)
// ==========================================

async function loadAuditLogs() {
  const { data, error } = await supabaseClient
    .from("audit_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error(error);
    return;
  }

  renderAuditLogsTable(data);
}

function renderAuditLogsTable(list) {
  const tbody = document.getElementById("auditLogsTableBody");
  const emptyState = document.getElementById("auditLogsEmptyState");
  tbody.innerHTML = "";

  if (list.length === 0) {
    emptyState.classList.remove("hidden");
    return;
  }
  emptyState.classList.add("hidden");

  list.forEach(log => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${new Date(log.created_at).toLocaleString()}</td>
      <td>${log.action}</td>
      <td>${log.table_name}</td>
      <td>${log.record_id ?? "-"}</td>
      <td>${log.details || "-"}</td>
    `;
    tbody.appendChild(row);
  });
}
