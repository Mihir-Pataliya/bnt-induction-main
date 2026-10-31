import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Eye, HeartPulse, RefreshCw, Search, X } from "lucide-react";
import { api } from "../../lib/api";
import { apiBaseUrl } from "../../lib/supabase";
import { showToast } from "../ui/Toast";
import type { DriverMedicalFitnessReportRecord, SessionState } from "../../types";

const inputClass = "mt-1 block w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/30";

function displayDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function documentStatusLabel(status: DriverMedicalFitnessReportRecord["documentStatus"]) {
  if (status === "approved") return "Submitted / Approved";
  if (status === "pending") return "Submitted / Pending";
  if (status === "rejected") return "Submitted / Rejected";
  return "Not submitted";
}

function reviewStatusLabel(status: DriverMedicalFitnessReportRecord["reviewStatus"]) {
  if (status === "reviewed") return "Reviewed";
  if (status === "correction_required") return "Correction required";
  if (status === "pending_review") return "Pending review";
  return "Not submitted";
}

function statusColor(status: DriverMedicalFitnessReportRecord["reviewStatus"] | DriverMedicalFitnessReportRecord["documentStatus"]) {
  if (status === "reviewed" || status === "approved") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
  if (status === "correction_required" || status === "rejected") return "border-red-500/30 bg-red-500/10 text-red-200";
  if (status === "pending" || status === "pending_review") return "border-amber-400/30 bg-amber-400/10 text-amber-200";
  return "border-slate-600 bg-slate-900 text-slate-300";
}

export function DriverMedicalFitnessReport({ session, onBack }: { session: SessionState; onBack: () => void }) {
  const [records, setRecords] = useState<DriverMedicalFitnessReportRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [reload, setReload] = useState(0);
  const [previewRecord, setPreviewRecord] = useState<DriverMedicalFitnessReportRecord | null>(null);
  const [reviewingRecord, setReviewingRecord] = useState<DriverMedicalFitnessReportRecord | null>(null);
  const [reviewAction, setReviewAction] = useState<"approve" | "reject">("approve");
  const [expiryDate, setExpiryDate] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const [processing, setProcessing] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError("");
    api.getDriverMedicalFitnessReport(session)
      .then((result) => {
        if (active) setRecords(result);
      })
      .catch((cause: unknown) => {
        if (active) setLoadError(cause instanceof Error ? cause.message : "Could not load driver medical fitness report.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [session, reload]);

  const filteredRecords = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return records.filter((record) => {
      if (statusFilter !== "all" && record.reviewStatus !== statusFilter) return false;
      if (!needle) return true;
      return [
        record.driverName,
        record.workerType,
        record.role,
        record.depotLocation ?? "",
        documentStatusLabel(record.documentStatus),
        reviewStatusLabel(record.reviewStatus),
        record.fileName ?? ""
      ].some((value) => value.toLocaleLowerCase().includes(needle));
    });
  }, [records, query, statusFilter]);

  const summary = useMemo(() => {
    const total = records.length;
    const submitted = records.filter((record) => record.documentId).length;
    const reviewed = records.filter((record) => record.reviewStatus === "reviewed").length;
    const correction = records.filter((record) => record.reviewStatus === "correction_required").length;
    const pending = records.filter((record) => record.reviewStatus === "pending_review").length;
    const missing = records.filter((record) => record.reviewStatus === "not_submitted").length;
    return { total, submitted, reviewed, correction, pending, missing };
  }, [records]);

  function openReview(record: DriverMedicalFitnessReportRecord, action: "approve" | "reject") {
    setReviewingRecord(record);
    setReviewAction(action);
    setExpiryDate(record.expiresAt ? record.expiresAt.slice(0, 10) : "");
    setRejectionReason(record.rejectionReason ?? "");
  }

  async function submitReview(event: React.FormEvent) {
    event.preventDefault();
    if (!reviewingRecord?.documentId || !session?.accessToken || !apiBaseUrl) return;
    if (reviewAction === "reject" && rejectionReason.trim().length < 3) return;
    if (reviewAction === "approve" && !expiryDate) return;

    setProcessing(reviewingRecord.documentId + reviewAction);
    try {
      const response = await fetch(`${apiBaseUrl}/admin/documents/${reviewingRecord.documentId}/verify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.accessToken}`
        },
        body: JSON.stringify({
          action: reviewAction === "approve" ? "approve" : "reject",
          ...(reviewAction === "reject" ? { reason: rejectionReason.trim() } : {}),
          ...(reviewAction === "approve" ? { expiresAt: new Date(`${expiryDate}T00:00:00.000Z`).toISOString() } : {})
        })
      });
      const data = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(data.message ?? "Medical document review failed.");
      showToast(data.message ?? (reviewAction === "approve" ? "Medical document marked as reviewed." : "Correction required recorded."), "success");
      setReviewingRecord(null);
      setExpiryDate("");
      setRejectionReason("");
      setReload((value) => value + 1);
    } catch (cause: unknown) {
      showToast(cause instanceof Error ? cause.message : "Medical document review failed.", "error");
    } finally {
      setProcessing(null);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-700 bg-slate-900 p-5 text-white md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <button
            type="button"
            onClick={onBack}
            className="mb-4 inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-200 transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:opacity-50"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to Inductions and Training
          </button>
          <p className="mb-1 text-xs font-bold uppercase tracking-wider text-emerald-300">COR / Inductions &amp; Training</p>
          <h2 className="text-2xl font-black">Assessing Fitness to Drive (Driver Medical)</h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-300">
            Review each driver's confidential medical certificate status. Medical results are not stored or displayed; preview is available via secure signed URLs.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setReload((value) => value + 1)}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-4 py-2.5 text-sm font-semibold text-slate-200 transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:cursor-wait disabled:opacity-50"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" /> Refresh
          </button>
        </div>
      </div>
      {loadError && (
        <div className="mt-5 flex flex-wrap items-center gap-3 rounded-lg border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200" role="alert">
          <span>{loadError}</span>
          <button type="button" onClick={() => setReload((value) => value + 1)} className="rounded-md border border-rose-300/40 px-3 py-2 font-semibold hover:bg-rose-500/10">
            Retry
          </button>
        </div>
      )}

      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Drivers</p>
          <p className="mt-2 text-2xl font-black text-white">{summary.total}</p>
        </div>
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-emerald-300">Reviewed</p>
          <p className="mt-2 text-2xl font-black text-emerald-200">{summary.reviewed}</p>
        </div>
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-red-300">Correction required</p>
          <p className="mt-2 text-2xl font-black text-red-200">{summary.correction}</p>
        </div>
        <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-amber-300">Pending review</p>
          <p className="mt-2 text-2xl font-black text-amber-200">{summary.pending}</p>
        </div>
        <div className="rounded-xl border border-slate-600 bg-slate-800/50 p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Not submitted</p>
          <p className="mt-2 text-2xl font-black text-slate-200">{summary.missing}</p>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Submitted</p>
          <p className="mt-2 text-2xl font-black text-white">{summary.submitted}</p>
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <label className="block text-sm font-semibold text-slate-200 sm:max-w-xl">
          Search report
          <span className="relative mt-1 block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input
              className={`${inputClass} pl-9`}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Driver, role, depot, status..."
            />
          </span>
        </label>
        <label className="block text-sm font-semibold text-slate-200 sm:w-56">
          Review status
          <select
            className={inputClass}
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="all">All statuses</option>
            <option value="reviewed">Reviewed</option>
            <option value="correction_required">Correction required</option>
            <option value="pending_review">Pending review</option>
            <option value="not_submitted">Not submitted</option>
          </select>
        </label>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-700">
        <table className="min-w-full divide-y divide-slate-700 text-sm">
          <thead className="bg-slate-800/70 text-left text-xs font-bold uppercase tracking-wider text-slate-300">
            <tr>
              <th className="px-4 py-3">Driver</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Depot</th>
              <th className="px-4 py-3">Medical document</th>
              <th className="px-4 py-3">Assessment date</th>
              <th className="px-4 py-3">Review status</th>
              <th className="px-4 py-3">Expiry</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {loading ? (
              <tr><td className="px-4 py-6 text-slate-400" colSpan={8}>Loading medical fitness records…</td></tr>
            ) : filteredRecords.length === 0 ? (
              <tr><td className="px-4 py-6 text-slate-400" colSpan={8}>No drivers match the current filters.</td></tr>
            ) : (
              filteredRecords.map((record) => (
                <tr key={record.id} className="hover:bg-slate-800/30">
                  <td className="px-4 py-3 font-semibold text-white">{record.driverName}</td>
                  <td className="px-4 py-3 text-slate-300">{record.workerType === "contractor" ? "Contractor" : record.workerType === "employee" ? "Employee" : "Worker"}</td>
                  <td className="px-4 py-3 text-slate-300">{record.depotLocation ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusColor(record.documentStatus)}`}>
                      {documentStatusLabel(record.documentStatus)}
                    </span>
                    {record.fileName && <p className="mt-1 text-xs text-slate-500">{record.fileName}</p>}
                  </td>
                  <td className="px-4 py-3 text-slate-300">{displayDate(record.assessmentDate)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusColor(record.reviewStatus)}`}>
                      {reviewStatusLabel(record.reviewStatus)}
                    </span>
                    {record.rejectionReason && <p className="mt-1 max-w-xs text-xs text-red-300">{record.rejectionReason}</p>}
                  </td>
                  <td className="px-4 py-3 text-slate-300">{displayDate(record.expiresAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => setPreviewRecord(record)} disabled={!record.previewUrl} className="inline-flex items-center gap-1 rounded-lg border border-slate-600 px-2.5 py-1.5 text-xs font-semibold text-slate-200 transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40">
                        <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                        View
                      </button>
                      {record.documentId && (
                        <>
                          <button type="button" onClick={() => openReview(record, "approve")} className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1.5 text-xs font-semibold text-emerald-200 transition-colors hover:bg-emerald-500/20">
                            Mark reviewed
                          </button>
                          <button type="button" onClick={() => openReview(record, "reject")} className="inline-flex items-center gap-1 rounded-lg border border-red-500/40 bg-red-500/10 px-2.5 py-1.5 text-xs font-semibold text-red-200 transition-colors hover:bg-red-500/20">
                            Correction required
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {previewRecord && (
        <div role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreviewRecord(null); }} style={{ position: "fixed", inset: 0, zIndex: 150, background: "rgba(2,6,23,.78)", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
          <section role="dialog" aria-modal="true" aria-label={`Preview ${previewRecord.fileName ?? "medical document"}`} style={{ background: "var(--bg-elevated, #0f172a)", border: "1px solid var(--border)", borderRadius: "16px", width: "min(1000px, 96vw)", height: "min(820px, 90vh)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
              <div>
                <p style={{ margin: 0, fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#6ee7b7" }}>Confidential medical document</p>
                <h3 style={{ margin: "4px 0 0", fontSize: "1.05rem" }}>{previewRecord.driverName} — {previewRecord.fileName ?? "Medical certificate"}</h3>
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                {previewRecord.previewUrl && <a href={previewRecord.previewUrl} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: "5px", padding: "7px 10px", border: "1px solid var(--border)", borderRadius: "8px", color: "inherit", textDecoration: "none", fontSize: "0.82rem" }}>Open file</a>}
                <button type="button" onClick={() => setPreviewRecord(null)} aria-label="Close preview" style={{ padding: "7px 10px", border: "1px solid var(--border)", borderRadius: "8px", background: "transparent", color: "inherit", cursor: "pointer" }}><X className="w-4 h-4" /></button>
              </div>
            </header>
            <div style={{ flex: 1, minHeight: 0, background: "#0b1120", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {previewRecord.previewUrl && previewRecord.mimeType?.startsWith("image/") ? <img src={previewRecord.previewUrl} alt={previewRecord.fileName ?? "Medical document"} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
                : previewRecord.previewUrl && previewRecord.mimeType === "application/pdf" ? <iframe title={previewRecord.fileName ?? "Medical document"} src={previewRecord.previewUrl} style={{ width: "100%", height: "100%", border: 0, background: "white" }} />
                : <p className="muted">This file type cannot be previewed here. Use “Open file” to view it.</p>}
            </div>
          </section>
        </div>
      )}

      {reviewingRecord && (
        <div role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setReviewingRecord(null); }} style={{ position: "fixed", inset: 0, zIndex: 151, background: "rgba(2,6,23,.78)", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
          <form onSubmit={submitReview} role="dialog" aria-modal="true" aria-labelledby="medical-review-title" style={{ background: "var(--bg-elevated, #0f172a)", border: "1px solid var(--border)", borderRadius: "16px", width: "min(520px, 96vw)", padding: "22px" }}>
            <h3 id="medical-review-title" style={{ margin: "0 0 6px", fontSize: "1.1rem" }}>
              {reviewAction === "approve" ? "Mark medical document as reviewed" : "Mark medical document as correction required"}
            </h3>
            <p className="muted" style={{ margin: "0 0 14px", fontSize: "0.86rem" }}>
              {reviewingRecord.driverName} — {reviewingRecord.fileName ?? "Medical certificate"}
            </p>
            {reviewAction === "approve" ? (
              <label style={{ display: "block", fontSize: "0.84rem", fontWeight: 600, marginBottom: "6px" }}>
                Medical certificate expiry date
                <input type="date" required value={expiryDate} onChange={(event) => setExpiryDate(event.target.value)} className={inputClass} />
              </label>
            ) : (
              <label style={{ display: "block", fontSize: "0.84rem", fontWeight: 600, marginBottom: "6px" }}>
                Correction reason
                <textarea required minLength={3} maxLength={1000} value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)} rows={4} className={inputClass} />
              </label>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "16px" }}>
              <button type="button" onClick={() => setReviewingRecord(null)} style={{ padding: "8px 14px", borderRadius: "8px", border: "1px solid var(--border)", background: "transparent", color: "inherit", cursor: "pointer" }}>Cancel</button>
              <button type="submit" disabled={processing !== null || (reviewAction === "approve" ? !expiryDate : rejectionReason.trim().length < 3)} style={{ padding: "8px 14px", borderRadius: "8px", border: "none", background: reviewAction === "approve" ? "#059669" : "#dc2626", color: "white", fontWeight: 700, cursor: "pointer", opacity: processing !== null || (reviewAction === "approve" ? !expiryDate : rejectionReason.trim().length < 3) ? 0.55 : 1 }}>
                {reviewAction === "approve" ? "Mark reviewed" : "Require correction"}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
