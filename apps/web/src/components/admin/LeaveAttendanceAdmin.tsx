import { FormEvent, useCallback, useEffect, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { api } from "../../lib/api";
import { AdminAttendanceRecord, AdminLeaveRequest, SessionState } from "../../types";

type View = "leave" | "attendance" | "reports";

const leaveTypes: Record<string, string> = { annual: "Annual", personal: "Personal / sick", unpaid: "Unpaid", other: "Other" };

function localDateTime(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function LeaveAttendanceAdmin({ session }: { session: SessionState }) {
  const [view, setView] = useState<View>("leave");
  const [leaveRequests, setLeaveRequests] = useState<AdminLeaveRequest[]>([]);
  const [leaveReportRequests, setLeaveReportRequests] = useState<AdminLeaveRequest[]>([]);
  const [attendance, setAttendance] = useState<AdminAttendanceRecord[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [rejectionReason, setRejectionReason] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<AdminAttendanceRecord | null>(null);

  const loadLeave = useCallback(async () => {
    setLoading(true);
    setError("");
    try { setLeaveRequests(await api.getAdminLeaveRequests(session)); }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Could not load leave requests."); }
    finally { setLoading(false); }
  }, [session]);

  const loadAttendance = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [attendanceRows, requests] = await Promise.all([
        api.getAdminAttendance(session, from || undefined, to || undefined),
        view === "reports" ? api.getAdminLeaveRequests(session) : Promise.resolve([])
      ]);
      setAttendance(attendanceRows);
      if (view === "reports") setLeaveReportRequests(requests);
    }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Could not load attendance."); }
    finally { setLoading(false); }
  }, [session, from, to, view]);

  useEffect(() => { if (view === "leave") void loadLeave(); }, [view, loadLeave]);
  useEffect(() => { if (view !== "leave") void loadAttendance(); }, [view, loadAttendance]);

  const decide = async (request: AdminLeaveRequest, status: "approved" | "rejected") => {
    const reason = rejectionReason[request.id]?.trim();
    if (status === "rejected" && !reason) {
      setError("Enter a reason before rejecting this request.");
      return;
    }
    setError("");
    setMessage("");
    setLoading(true);
    try {
      await api.decideLeaveRequest(session, request.id, status, reason);
      setMessage(`Leave request ${status}.`);
      await loadLeave();
    } catch (decisionError) {
      setError(decisionError instanceof Error ? decisionError.message : "Could not update leave request.");
    } finally { setLoading(false); }
  };

  const startEdit = (record: AdminAttendanceRecord) => {
    setEditingId(record.id);
    setEditDraft({ ...record, checkinTime: localDateTime(record.checkinTime), checkoutTime: localDateTime(record.checkoutTime) });
  };

  const saveAttendance = async (event: FormEvent) => {
    event.preventDefault();
    if (!editDraft) return;
    setLoading(true);
    setError("");
    try {
      await api.updateAdminAttendance(session, {
        ...editDraft,
        checkinTime: new Date(editDraft.checkinTime).toISOString(),
        checkoutTime: editDraft.checkoutTime ? new Date(editDraft.checkoutTime).toISOString() : null
      });
      setEditingId(null);
      setEditDraft(null);
      setMessage("Attendance record updated.");
      await loadAttendance();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not update attendance record.");
    } finally { setLoading(false); }
  };

  const downloadReport = () => {
    const columns = ["Driver", "User ID", "Worksite", "Vehicle", "Check-in", "Check-out", "Status", "Hours driven", "Hours rested"];
    const lines = [columns, ...attendance.map((record) => [
      record.driverName, record.userId, record.depotName, record.vehicleRego, record.checkinTime, record.checkoutTime ?? "", record.status,
      String(record.hoursDrivenToday), String(record.hoursRestedLast24h)
    ])].map((row) => row.map((value) => `"${value.replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([lines], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `bnt-attendance-${from || "all"}-${to || "dates"}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const downloadLeaveReport = () => {
    const columns = ["Employee", "Email", "Leave type", "Start date", "End date", "Status", "Submitted", "Reviewed"];
    const lines = [columns, ...leaveReportRequests.map((request) => [
      request.employee?.full_name ?? "", request.employee?.email ?? "", leaveTypes[request.leave_type] ?? request.leave_type,
      request.start_date, request.end_date, request.status, request.created_at, request.reviewed_at ?? ""
    ])].map((row) => row.map((value) => `"${value.replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([lines], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "bnt-leave-requests.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const buttonClass = "rounded-lg px-4 py-2 text-sm font-bold";
  const fieldClass = "rounded-md border border-slate-600 bg-slate-800 px-2 py-2 text-sm text-white";
  const hours = attendance.reduce((sum, item) => sum + (item.checkoutTime ? Math.max(0, (new Date(item.checkoutTime).getTime() - new Date(item.checkinTime).getTime()) / 3_600_000) : 0), 0);

  return (
    <section className="space-y-5 rounded-2xl border border-slate-700 bg-slate-900 p-5 text-white md:p-7">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-2xl font-black">Leave and attendance</h2><p className="mt-1 text-sm text-slate-300">Review leave, manage existing check-in records, and report attendance.</p></div>
        <button type="button" disabled={loading} onClick={() => void (view === "leave" ? loadLeave() : loadAttendance())} className={`${buttonClass} border border-slate-600`}><RefreshCw className="mr-1 inline h-4 w-4" />Refresh</button>
      </header>
      <nav className="flex flex-wrap gap-2" aria-label="Leave and attendance views">
        {(["leave", "attendance", "reports"] as const).map((tab) => <button key={tab} type="button" onClick={() => setView(tab)} className={`${buttonClass} ${view === tab ? "bg-emerald-600 text-white" : "bg-slate-800 text-slate-300"}`}>{tab === "leave" ? "Leave requests" : tab === "attendance" ? "Attendance records" : "Reports"}</button>)}
      </nav>
      {error && <p role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</p>}
      {message && <p role="status" className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-200">{message}</p>}
      {loading && <p role="status" className="text-sm text-slate-300">Loading…</p>}

      {view === "leave" && !loading && (
        <div className="space-y-3">
          {leaveRequests.length === 0 ? <p className="text-sm text-slate-400">No leave requests found.</p> : leaveRequests.map((request) => (
            <article key={request.id} className="rounded-xl border border-slate-700 p-4">
              <div className="flex flex-wrap justify-between gap-3">
                <div><h3 className="font-bold">{request.employee?.full_name || request.employee?.email || request.user_id}</h3>
                  <p className="text-sm text-slate-300">{leaveTypes[request.leave_type]} · {request.start_date} to {request.end_date}</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-slate-200">{request.reason}</p>
                  {request.decision_reason && <p className="mt-2 text-sm text-amber-200">Decision note: {request.decision_reason}</p>}
                </div>
                <span className="h-fit rounded-full bg-slate-700 px-3 py-1 text-xs font-bold">{request.status.toUpperCase()}</span>
              </div>
              {request.status === "pending" && <div className="mt-3 flex flex-wrap gap-2">
                <input aria-label="Rejection reason" placeholder="Reason required to reject" value={rejectionReason[request.id] ?? ""} onChange={(event) => setRejectionReason((previous) => ({ ...previous, [request.id]: event.target.value }))} className={`${fieldClass} min-w-64 flex-1`} />
                <button disabled={loading} type="button" onClick={() => void decide(request, "approved")} className={`${buttonClass} bg-emerald-700`}>Approve</button>
                <button disabled={loading} type="button" onClick={() => void decide(request, "rejected")} className={`${buttonClass} bg-rose-700`}>Reject</button>
              </div>}
            </article>
          ))}
        </div>
      )}

      {(view === "attendance" || view === "reports") && (
        <>
          <form onSubmit={(event) => { event.preventDefault(); void loadAttendance(); }} className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-700 p-4">
            <label className="grid gap-1 text-xs text-slate-300">From<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className={fieldClass} /></label>
            <label className="grid gap-1 text-xs text-slate-300">To<input type="date" value={to} onChange={(event) => setTo(event.target.value)} className={fieldClass} /></label>
            <button type="submit" disabled={loading} className={`${buttonClass} bg-emerald-700`}>Apply dates</button>
            {view === "reports" && <button type="button" onClick={downloadReport} className={`${buttonClass} border border-slate-600`}><Download className="mr-1 inline h-4 w-4" />Download CSV</button>}
          </form>
          {view === "reports" && <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-slate-700 p-4"><p className="text-xs text-slate-400">Attendance records</p><p className="text-2xl font-black">{attendance.length}</p></div>
            <div className="rounded-xl border border-slate-700 p-4"><p className="text-xs text-slate-400">Active check-ins</p><p className="text-2xl font-black">{attendance.filter((row) => row.status === "Active").length}</p></div>
            <div className="rounded-xl border border-slate-700 p-4"><p className="text-xs text-slate-400">Recorded hours (signed out)</p><p className="text-2xl font-black">{hours.toFixed(1)}</p></div>
            <div className="rounded-xl border border-slate-700 p-4"><p className="text-xs text-slate-400">Pending leave requests</p><p className="text-2xl font-black">{leaveReportRequests.filter((request) => request.status === "pending").length}</p></div>
            <div className="rounded-xl border border-slate-700 p-4"><p className="text-xs text-slate-400">Approved leave requests</p><p className="text-2xl font-black">{leaveReportRequests.filter((request) => request.status === "approved").length}</p></div>
            <div className="rounded-xl border border-slate-700 p-4"><p className="text-xs text-slate-400">Rejected leave requests</p><p className="text-2xl font-black">{leaveReportRequests.filter((request) => request.status === "rejected").length}</p></div>
            <div className="md:col-span-3"><button type="button" onClick={downloadLeaveReport} className={`${buttonClass} border border-slate-600`}><Download className="mr-1 inline h-4 w-4" />Download leave CSV</button></div>
          </div>}
          {!loading && attendance.length === 0 ? <p className="text-sm text-slate-400">No attendance records found for this date range.</p> : (
            <div className="space-y-3">
              {attendance.map((record) => editingId === record.id && editDraft ? (
                <form key={record.id} onSubmit={(event) => void saveAttendance(event)} className="grid gap-3 rounded-xl border border-emerald-500/40 p-4 md:grid-cols-3">
                  <label className="grid gap-1 text-xs text-slate-300">Driver<input disabled value={record.driverName} className={fieldClass} /></label>
                  <label className="grid gap-1 text-xs text-slate-300">Worksite<input required value={editDraft.depotName} onChange={(event) => setEditDraft({ ...editDraft, depotName: event.target.value })} className={fieldClass} /></label>
                  <label className="grid gap-1 text-xs text-slate-300">Vehicle<input value={editDraft.vehicleRego} onChange={(event) => setEditDraft({ ...editDraft, vehicleRego: event.target.value })} className={fieldClass} /></label>
                  <label className="grid gap-1 text-xs text-slate-300">Check-in<input required type="datetime-local" value={editDraft.checkinTime} onChange={(event) => setEditDraft({ ...editDraft, checkinTime: event.target.value })} className={fieldClass} /></label>
                  <label className="grid gap-1 text-xs text-slate-300">Check-out<input type="datetime-local" value={editDraft.checkoutTime ?? ""} onChange={(event) => setEditDraft({ ...editDraft, checkoutTime: event.target.value || null })} className={fieldClass} /></label>
                  <label className="grid gap-1 text-xs text-slate-300">Status<select value={editDraft.status} onChange={(event) => setEditDraft({ ...editDraft, status: event.target.value as AdminAttendanceRecord["status"] })} className={fieldClass}><option value="Active">Active</option><option value="Checked Out">Checked Out</option></select></label>
                  <label className="grid gap-1 text-xs text-slate-300">Hours driven<input type="number" min="0" max="24" step="0.5" value={editDraft.hoursDrivenToday} onChange={(event) => setEditDraft({ ...editDraft, hoursDrivenToday: Number(event.target.value) })} className={fieldClass} /></label>
                  <label className="grid gap-1 text-xs text-slate-300">Hours rested<input type="number" min="0" max="24" step="0.5" value={editDraft.hoursRestedLast24h} onChange={(event) => setEditDraft({ ...editDraft, hoursRestedLast24h: Number(event.target.value) })} className={fieldClass} /></label>
                  <label className="flex items-center gap-2 text-sm text-slate-200"><input type="checkbox" checked={editDraft.fitnessDeclaration} onChange={(event) => setEditDraft({ ...editDraft, fitnessDeclaration: event.target.checked })} /> Fitness declared</label>
                  <div className="flex gap-2 md:col-span-3"><button disabled={loading} className={`${buttonClass} bg-emerald-700`}>Save</button><button type="button" onClick={() => { setEditingId(null); setEditDraft(null); }} className={`${buttonClass} border border-slate-600`}>Cancel</button></div>
                </form>
              ) : (
                <article key={record.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-700 p-4">
                  <div><h3 className="font-bold">{record.driverName}</h3><p className="text-sm text-slate-300">{record.depotName} · {record.vehicleRego || "No vehicle"} · {record.checkinTime}</p><p className="text-xs text-slate-400">{record.checkoutTime ? `Out ${record.checkoutTime}` : "Still checked in"} · {record.hoursDrivenToday}h driven · {record.hoursRestedLast24h}h rested</p></div>
                  <div className="flex items-center gap-3"><span className="text-xs font-bold">{record.status}</span><button type="button" onClick={() => startEdit(record)} className={`${buttonClass} border border-slate-600`}>Edit record</button></div>
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
