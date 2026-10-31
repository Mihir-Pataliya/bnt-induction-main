import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { SessionState } from "../../types";

type EmployeeRow = { id: string; name: string; email: string; payrollSetupComplete: boolean };
type AdminRow = { id: string; name: string; email: string; payrollAccess: boolean };

export function PayrollAdmin({ session }: { session: SessionState }) {
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [admins, setAdmins] = useState<AdminRow[]>([]);
  const [selected, setSelected] = useState<Record<string, string> | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    const [employeeRows, adminRows] = await Promise.all([api.getPayrollEmployees(session), api.getPayrollAdmins(session)]);
    setEmployees(employeeRows);
    setAdmins(adminRows);
  }, [session]);
  useEffect(() => { void refresh().catch((error) => setMessage(error.message)); }, [refresh]);

  async function toggleAccess(admin: AdminRow) {
    setBusy(true); setMessage("");
    try { await api.setPayrollAccess(session, admin.id, !admin.payrollAccess); await refresh(); setMessage("Payroll permission updated."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not update access."); }
    finally { setBusy(false); }
  }
  async function showDetails(employee: EmployeeRow) {
    setBusy(true); setMessage(""); setSelected(null);
    try { setSelected(await api.getEmployeePayrollDetails(session, employee.id)); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not load payroll details."); }
    finally { setBusy(false); }
  }

  return <section className="glass" style={{ padding: 24, borderRadius: 16 }}>
    <h2 style={{ marginTop: 0 }}>Employee payroll</h2>
    <p className="muted">Payroll data is encrypted at rest. Only admins with payroll permission can view it. Access grants and record reads are audited.</p>
    {message && <p role="status">{message}</p>}
    <h3>Payroll access</h3>
    <div style={{ display: "grid", gap: 8, marginBottom: 24 }}>
      {admins.map((admin) => <div key={admin.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", padding: 10, borderBottom: "1px solid var(--border)" }}>
        <span>{admin.name} · {admin.email}</span>
        <button disabled={busy} onClick={() => void toggleAccess(admin)}>{admin.payrollAccess ? "Remove payroll access" : "Grant payroll access"}</button>
      </div>)}
    </div>
    <h3>Employee records</h3>
    <div style={{ display: "grid", gap: 8 }}>
      {employees.map((employee) => <div key={employee.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", padding: 10, borderBottom: "1px solid var(--border)" }}>
        <span>{employee.name} · {employee.email} · {employee.payrollSetupComplete ? "Setup complete" : "Not submitted"}</span>
        {employee.payrollSetupComplete && <button disabled={busy} onClick={() => void showDetails(employee)}>View payroll details</button>}
      </div>)}
    </div>
    {selected && <div role="dialog" aria-label="Sensitive payroll details" style={{ marginTop: 20, padding: 16, border: "1px solid var(--border)", borderRadius: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}><strong>Payroll details — authorized access only</strong><button onClick={() => setSelected(null)}>Close</button></div>
      <dl style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "8px 16px" }}>
        <dt>Employee</dt><dd>{selected.employeeName}</dd><dt>Tax file number</dt><dd>{selected.tfn}</dd>
        <dt>Bank account name</dt><dd>{selected.bankAccountName}</dd><dt>BSB</dt><dd>{selected.bankBsb}</dd><dt>Account number</dt><dd>{selected.bankAccountNumber}</dd>
        <dt>Super option</dt><dd>{selected.superFundChoice}</dd><dt>Super fund</dt><dd>{selected.superFundName || "Employer default"}</dd><dt>Member number</dt><dd>{selected.superMemberNumber}</dd>
        <dt>Last updated</dt><dd>{selected.updatedAt ? new Date(selected.updatedAt).toLocaleString() : "—"}</dd>
      </dl>
    </div>}
  </section>;
}
