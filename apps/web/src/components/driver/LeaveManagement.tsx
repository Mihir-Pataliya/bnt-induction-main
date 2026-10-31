import { FormEvent, useEffect, useState } from "react";
import { CalendarDays, Loader2 } from "lucide-react";
import { api } from "../../lib/api";
import { LeaveRequest, LeaveType, SessionState } from "../../types";

const leaveTypeLabels: Record<LeaveType, string> = {
  annual: "Annual leave",
  personal: "Personal / sick leave",
  unpaid: "Unpaid leave",
  other: "Other"
};

function formatDate(value: string) {
  return new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString("en-AU");
}

export function LeaveManagement({ session }: { session: SessionState }) {
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [leaveType, setLeaveType] = useState<LeaveType>("annual");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const refresh = async () => {
    setLoading(true);
    try {
      setRequests(await api.getLeaveRequests(session));
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load leave requests.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, [session]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await api.submitLeaveRequest(session, { leaveType, startDate, endDate, reason });
      setStartDate("");
      setEndDate("");
      setReason("");
      setMessage("Leave request submitted for review.");
      await refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not submit leave request.");
    } finally {
      setSaving(false);
    }
  };

  const cancel = async (request: LeaveRequest) => {
    setSaving(true);
    setError("");
    try {
      await api.cancelLeaveRequest(session, request.id);
      await refresh();
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : "Could not cancel leave request.");
    } finally {
      setSaving(false);
    }
  };

  const cardStyle = { background: "#0f172a", border: "1px solid #1e293b", borderRadius: 16, padding: 22, color: "#f8fafc" };
  const fieldStyle = { width: "100%", boxSizing: "border-box" as const, padding: "10px 12px", borderRadius: 9, border: "1px solid #334155", background: "#1e293b", color: "#fff" };

  return (
    <section className="space-y-6">
      <header>
        <h2 className="text-2xl font-black text-white flex items-center gap-2"><CalendarDays className="w-6 h-6 text-emerald-400" /> Leave management</h2>
        <p className="text-slate-300 text-sm mt-1">Submit a leave request and track its approval status. Attendance history is available under Check-in.</p>
      </header>

      {error && <p role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</p>}
      {message && <p role="status" className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-200">{message}</p>}

      <form onSubmit={(event) => void submit(event)} style={cardStyle} className="space-y-4">
        <h3 className="text-lg font-bold">Apply for leave</h3>
        <div className="grid gap-4 md:grid-cols-3">
          <label className="space-y-1 text-sm text-slate-200">Leave type
            <select value={leaveType} onChange={(event) => setLeaveType(event.target.value as LeaveType)} style={fieldStyle}>
              {Object.entries(leaveTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-sm text-slate-200">Start date
            <input type="date" required value={startDate} onChange={(event) => setStartDate(event.target.value)} style={fieldStyle} />
          </label>
          <label className="space-y-1 text-sm text-slate-200">End date
            <input type="date" required min={startDate || undefined} value={endDate} onChange={(event) => setEndDate(event.target.value)} style={fieldStyle} />
          </label>
        </div>
        <label className="block space-y-1 text-sm text-slate-200">Reason / relevant details
          <textarea required minLength={5} maxLength={2000} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} style={fieldStyle} />
        </label>
        <button type="submit" disabled={saving} className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-60">
          {saving ? <><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Submitting…</> : "Submit request"}
        </button>
      </form>

      <section style={cardStyle}>
        <h3 className="mb-4 text-lg font-bold">My leave requests</h3>
        {loading ? <p role="status" className="text-slate-300">Loading requests…</p> : requests.length === 0 ? <p className="text-sm text-slate-400">No leave requests yet.</p> : (
          <div className="space-y-3">
            {requests.map((request) => (
              <article key={request.id} className="rounded-lg border border-slate-700 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h4 className="font-bold text-white">{leaveTypeLabels[request.leave_type]}</h4>
                    <p className="mt-1 text-sm text-slate-300">{formatDate(request.start_date)} – {formatDate(request.end_date)}</p>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-slate-300">{request.reason}</p>
                    {request.decision_reason && <p className="mt-2 text-sm text-amber-200">Admin note: {request.decision_reason}</p>}
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-bold ${request.status === "approved" ? "bg-emerald-500/15 text-emerald-300" : request.status === "rejected" ? "bg-rose-500/15 text-rose-300" : request.status === "pending" ? "bg-amber-500/15 text-amber-200" : "bg-slate-700 text-slate-300"}`}>
                    {request.status.toUpperCase()}
                  </span>
                </div>
                {request.status === "pending" && <button type="button" disabled={saving} onClick={() => void cancel(request)} className="mt-3 rounded-md border border-slate-600 px-3 py-1.5 text-xs font-bold text-slate-200 disabled:opacity-60">Cancel request</button>}
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}
